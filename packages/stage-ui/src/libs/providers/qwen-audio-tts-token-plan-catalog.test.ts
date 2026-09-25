import { describe, expect, it } from 'vitest'

import {
  getQwenAudioTtsTokenPlanAccountModels,
  getQwenAudioTtsTokenPlanModels,
  getQwenAudioTtsTokenPlanVoices,
  QWEN_AUDIO_TTS_TOKEN_PLAN_ACCOUNT_CATALOG_SOURCE,
} from './qwen-audio-tts-token-plan-catalog'
import { QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL } from './qwen-audio-tts-token-plan-ipc'

describe('qwen Token Plan account model catalogue', () => {
  it('keeps only explicitly compatible TTS models from the sanitized account response', () => {
    const result = getQwenAudioTtsTokenPlanAccountModels({
      responseClass: 'SUCCESS_OPENAI_MODEL_LIST',
      modelIds: ['qwen-plus', 'qwen-audio-3.0-tts-plus', 'future-audio-model'],
      ttsModelIds: ['qwen-audio-3.0-tts-plus'],
      containsQwenAudioTtsPlus: true,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
      catalogSource: QWEN_AUDIO_TTS_TOKEN_PLAN_ACCOUNT_CATALOG_SOURCE,
    })
  })

  it('falls back without manufacturing an account catalogue for non-success responses', () => {
    expect(getQwenAudioTtsTokenPlanAccountModels({
      responseClass: 'SUCCESS_TEXT_ONLY_MODELS',
      modelIds: ['qwen-plus'],
      ttsModelIds: [],
      containsQwenAudioTtsPlus: false,
    })).toEqual([])
    expect(getQwenAudioTtsTokenPlanAccountModels({
      responseClass: 'MALFORMED_RESPONSE',
      modelIds: [],
      ttsModelIds: [],
      containsQwenAudioTtsPlus: false,
    })).toEqual([])
  })

  it('keeps the bundled official model source unchanged for fallback', () => {
    expect(getQwenAudioTtsTokenPlanModels()).toMatchObject([{
      id: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
      catalogSource: 'official-directory',
    }])
  })

  it('keeps every bundled voice on the official directory authority', () => {
    expect(getQwenAudioTtsTokenPlanVoices().length).toBe(599)
    expect(getQwenAudioTtsTokenPlanVoices().every(voice => voice.catalogSource === 'official-directory')).toBe(true)
  })
})
