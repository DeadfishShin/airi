import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  providerQwen3TtsRealtime,
  QWEN3_TTS_REALTIME_MODEL,
  QWEN3_TTS_REALTIME_PROVIDER_ID,
} from './index'

describe('qwen3 realtime TTS provider', () => {
  it('exposes the static Electron canary catalog without renderer credentials', async () => {
    const config = z.parse(await providerQwen3TtsRealtime.createProviderConfig({ t: input => input }), {})
    const provider = await providerQwen3TtsRealtime.createProvider(config)
    const models = await providerQwen3TtsRealtime.extraMethods?.listModels?.(config, provider)
    const voices = await providerQwen3TtsRealtime.extraMethods?.listVoices?.(config, provider, QWEN3_TTS_REALTIME_MODEL)

    expect(config).toEqual({})
    expect(providerQwen3TtsRealtime.requiresCredentials).toBe(false)
    expect(providerQwen3TtsRealtime.capabilities?.speech).toEqual({ transport: 'bidirectional-ws' })
    expect(models?.map(model => model.id)).toEqual([QWEN3_TTS_REALTIME_MODEL])
    expect(voices?.map(voice => voice.id)).toEqual(['Cherry'])
    expect(voices?.[0]?.compatibleModels).toEqual([QWEN3_TTS_REALTIME_MODEL])
    expect(QWEN3_TTS_REALTIME_PROVIDER_ID).toBe('qwen3-tts-realtime')
  })

  it('fails closed instead of exposing a REST speech request', async () => {
    const provider = await providerQwen3TtsRealtime.createProvider({}) as SpeechProviderWithExtraOptions<string>

    expect(() => provider.speech(QWEN3_TTS_REALTIME_MODEL)).toThrow(
      'Qwen3 realtime TTS is streaming-only in the Electron canary.',
    )
  })
})
