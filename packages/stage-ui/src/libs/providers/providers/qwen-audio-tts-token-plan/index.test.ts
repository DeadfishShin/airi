import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  providerQwenAudioTtsTokenPlan,
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from './index'

describe('qwen Audio Token Plan TTS provider', () => {
  it('exposes only the static model and longanlingxin catalog', async () => {
    const config = z.parse(await providerQwenAudioTtsTokenPlan.createProviderConfig({ t: input => input }), {})
    const provider = await providerQwenAudioTtsTokenPlan.createProvider(config)
    const models = await providerQwenAudioTtsTokenPlan.extraMethods?.listModels?.(config, provider)
    const voices = await providerQwenAudioTtsTokenPlan.extraMethods?.listVoices?.(config, provider, QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL)

    expect(config).toEqual({})
    expect(providerQwenAudioTtsTokenPlan.requiresCredentials).toBe(false)
    expect(providerQwenAudioTtsTokenPlan.capabilities?.speech).toEqual({ transport: 'bidirectional-ws' })
    expect(models?.map(model => model.id)).toEqual([QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL])
    expect(voices?.map(voice => voice.id)).toEqual([QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID])
    expect(QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID).toBe('qwen-audio-tts-token-plan')
  })

  it('fails closed instead of exposing a REST speech request', async () => {
    const provider = await providerQwenAudioTtsTokenPlan.createProvider({}) as SpeechProviderWithExtraOptions<string>

    expect(() => provider.speech(QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL)).toThrow(
      'Qwen Audio Token Plan TTS is streaming-only in the Electron canary.',
    )
  })
})
