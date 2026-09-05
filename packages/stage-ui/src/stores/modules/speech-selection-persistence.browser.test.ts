import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { PiniaColada } from '@pinia/colada'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { z } from 'zod'

import {
  providerQwenAudioRealtimeTranscription,
  QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID,
} from '../../libs/providers/providers/qwen-audio-realtime'
import { QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL } from '../../libs/providers/qwen-audio-realtime-models'
import { QWEN3_TTS_REALTIME_PROVIDER_ID } from '../../libs/providers/qwen-tts-realtime-ipc'
import { QWEN3_TTS_REALTIME_MODEL_CATALOG } from '../../libs/providers/qwen3-tts-realtime-models'
import { listQwen3TtsRealtimeVoices, QWEN3_TTS_REALTIME_DEFAULT_VOICE } from '../../libs/providers/qwen3-tts-realtime-voices'
import { useProviderConfigStore } from '../providers/config'
import { useSpeechStore } from './speech'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string) => key,
  }),
}))

interface SyncedContext {
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
}

const contexts: SyncedContext[] = []

function createSyncedContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  createApp({}).use(pinia).use(PiniaColada)
  const context = { pinia, runtime }
  contexts.push(context)
  return context
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.runtime.dispose()
    disposePinia(context.pinia)
  }
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('qwen model and voice persistence closure', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('recreates durable TTS selection from cold state without a provider call', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const first = useSpeechStore()
    const instruct = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    first.activeSpeechProvider = QWEN3_TTS_REALTIME_PROVIDER_ID
    await first.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    first.activeSpeechModel = instruct
    first.activeSpeechVoiceId = 'Serena'
    await first.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    await nextTick()

    expect(first.activeSpeechModel).toBe(instruct)
    expect(first.activeSpeechVoiceId).toBe('Serena')

    first.modelSearchQuery = 'flash'
    expect(first.activeSpeechModel).toBe(instruct)
    expect(first.activeSpeechVoiceId).toBe('Serena')

    disposePinia(pinia)

    const restartedPinia = createPinia()
    setActivePinia(restartedPinia)
    const restarted = useSpeechStore()
    await restarted.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    await nextTick()

    expect(restarted.activeSpeechModel).toBe(instruct)
    expect(restarted.activeSpeechVoiceId).toBe('Serena')
    expect(restarted.activeSpeechVoice?.id).toBe('Serena')
  })

  it('normalizes stale and incompatible durable voice state before a future session', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const speech = useSpeechStore()
    const instruct = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    speech.activeSpeechProvider = QWEN3_TTS_REALTIME_PROVIDER_ID
    speech.activeSpeechModel = instruct
    speech.activeSpeechVoiceId = 'Shanghai - Jada'
    await speech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    await nextTick()

    expect(speech.activeSpeechVoiceId).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)
    expect(speech.activeSpeechVoice?.id).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)
    expect(listQwen3TtsRealtimeVoices(instruct).some(voice => voice.id === 'Shanghai - Jada')).toBe(false)
  })

  it('does not resurrect an incompatible voice after switching back to Flash', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const speech = useSpeechStore()
    const flash = QWEN3_TTS_REALTIME_MODEL_CATALOG[0].id
    const instruct = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    speech.activeSpeechProvider = QWEN3_TTS_REALTIME_PROVIDER_ID
    speech.activeSpeechModel = flash
    await speech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, flash)
    speech.activeSpeechVoiceId = 'Jada'
    await nextTick()

    speech.activeSpeechModel = instruct
    await speech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    expect(speech.activeSpeechVoiceId).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)

    speech.activeSpeechModel = flash
    await speech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, flash)
    expect(speech.activeSpeechVoiceId).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)
  })
})

describe('qwen speech cross-window synchronization', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('replicates model and provider voice ID through the canonical Pinia sync seam', async () => {
    const namespace = `speech-selection:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderSpeech = useSpeechStore()
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerSpeech = useSpeechStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))

    const instruct = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    leaderSpeech.activeSpeechProvider = QWEN3_TTS_REALTIME_PROVIDER_ID
    leaderSpeech.activeSpeechModel = instruct
    await leaderSpeech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, instruct)
    leaderSpeech.activeSpeechVoiceId = 'Serena'
    await nextTick()

    await vi.waitFor(() => {
      expect(followerSpeech.activeSpeechProvider).toBe(QWEN3_TTS_REALTIME_PROVIDER_ID)
      expect(followerSpeech.activeSpeechModel).toBe(instruct)
      expect(followerSpeech.activeSpeechVoiceId).toBe('Serena')
    })
    expect(followerSpeech.activeSpeechVoice?.id).toBe('Serena')

    // A compatible model change preserves the selected voice in both windows.
    leaderSpeech.activeSpeechModel = QWEN3_TTS_REALTIME_MODEL_CATALOG[0].id
    await leaderSpeech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, leaderSpeech.activeSpeechModel)
    await vi.waitFor(() => expect(followerSpeech.activeSpeechModel).toBe(QWEN3_TTS_REALTIME_MODEL_CATALOG[0].id))
    expect(followerSpeech.activeSpeechVoiceId).toBe('Serena')
  })

  it('normalizes an incompatible model change identically without opening a provider session', async () => {
    const namespace = `speech-selection:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    setActivePinia(leader.pinia)
    const leaderSpeech = useSpeechStore()
    const follower = createSyncedContext(namespace, 'follower-only')
    setActivePinia(follower.pinia)
    const followerSpeech = useSpeechStore()
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))

    leaderSpeech.activeSpeechProvider = QWEN3_TTS_REALTIME_PROVIDER_ID
    leaderSpeech.activeSpeechModel = QWEN3_TTS_REALTIME_MODEL_CATALOG[0].id
    await leaderSpeech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, leaderSpeech.activeSpeechModel)
    leaderSpeech.activeSpeechVoiceId = 'Jada'
    await nextTick()

    leaderSpeech.activeSpeechModel = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    await leaderSpeech.loadVoicesForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID, leaderSpeech.activeSpeechModel)
    await vi.waitFor(() => {
      expect(followerSpeech.activeSpeechModel).toBe(QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id)
      expect(followerSpeech.activeSpeechVoiceId).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)
    })
    expect(leaderSpeech.activeSpeechVoiceId).toBe(QWEN3_TTS_REALTIME_DEFAULT_VOICE)
  })
})

describe('qwen ASR provider configuration persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('restores model and language from the provider-config durable snapshot', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const configStore = useProviderConfigStore()
    configStore.ensureProvider(QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID, QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID, {
      language: 'zh',
      model: QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
    })
    await nextTick()

    const restartedPinia = createPinia()
    setActivePinia(restartedPinia)
    const restartedConfigStore = useProviderConfigStore()
    const config = restartedConfigStore.getProviderConfig(QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID)
    const schema = await providerQwenAudioRealtimeTranscription.createProviderConfig({ t: input => input })
    const normalized = z.parse(schema, config)

    expect(normalized).toEqual({
      language: 'zh',
      model: QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
    })
  })
})
