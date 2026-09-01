import { readFileSync } from 'node:fs'

import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import {
  QWEN3_TTS_REALTIME_MODEL,
  QWEN3_TTS_REALTIME_PROVIDER_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { describe, expect, it, vi } from 'vitest'

import { ensureQwenTtsModelCatalog, shouldEnsureQwenTtsModelCatalog } from './speech-model-catalog'

function createCatalogStore() {
  let models: Array<{ id: string }> = []
  const initializeProvider = vi.fn(async () => {})
  const fetchModelsForProvider = vi.fn(async (providerId: string) => {
    models = [{
      id: providerId === QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID
        ? QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL
        : QWEN3_TTS_REALTIME_MODEL,
    }]
  })

  return {
    getModelsForProvider: vi.fn((_providerId: string) => models),
    initializeProvider,
    fetchModelsForProvider,
  }
}

describe('speech settings Qwen model catalog lifecycle', () => {
  it('reproduces the pre-fix empty persisted Token Plan catalog and repairs it on startup', async () => {
    const store = createCatalogStore()
    const persistedProvider = QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID

    expect(store.getModelsForProvider(persistedProvider)).toEqual([])
    expect(shouldEnsureQwenTtsModelCatalog(persistedProvider, 0)).toBe(true)

    await ensureQwenTtsModelCatalog(store, persistedProvider)

    expect(store.initializeProvider).toHaveBeenCalledWith(persistedProvider)
    expect(store.fetchModelsForProvider).toHaveBeenCalledWith(persistedProvider)
    expect(store.getModelsForProvider(persistedProvider)).toEqual([{ id: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL }])
  })

  it('loads the Token Plan catalog after a Qwen provider switch and remains idempotent', async () => {
    const store = createCatalogStore()

    await ensureQwenTtsModelCatalog(store, QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID)
    await ensureQwenTtsModelCatalog(store, QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID)

    expect(store.fetchModelsForProvider).toHaveBeenCalledTimes(1)
    expect(store.getModelsForProvider(QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID)).toEqual([{ id: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL }])
  })

  it('keeps the PAYG Qwen catalog route scoped and does not show Token Plan as empty', async () => {
    const store = createCatalogStore()

    await ensureQwenTtsModelCatalog(store, QWEN3_TTS_REALTIME_PROVIDER_ID)

    expect(store.getModelsForProvider(QWEN3_TTS_REALTIME_PROVIDER_ID)).toEqual([{ id: QWEN3_TTS_REALTIME_MODEL }])
    expect(shouldEnsureQwenTtsModelCatalog('another-provider', 0)).toBe(false)
  })

  it('leaves a genuinely empty unrelated provider eligible for the existing empty state', () => {
    expect(shouldEnsureQwenTtsModelCatalog('empty-provider', 0)).toBe(false)
    expect(shouldEnsureQwenTtsModelCatalog(QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID, 1)).toBe(false)
  })

  it('wires the helper into both Speech settings startup and provider-switch lifecycles', () => {
    const source = readFileSync(new URL('./speech.vue', import.meta.url), 'utf8')

    expect(source).toContain('ensureQwenTtsModelCatalog(providersStore, activeSpeechProvider.value)')
    expect(source).toContain('ensureQwenTtsModelCatalog(providersStore, newProvider)')
  })
})
