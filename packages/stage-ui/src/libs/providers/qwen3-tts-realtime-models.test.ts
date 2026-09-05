import { describe, expect, it } from 'vitest'

import {
  isQwen3TtsRealtimeModel,
  normalizeQwen3TtsRealtimeModel,
  QWEN3_TTS_REALTIME_DEFAULT_MODEL,
  QWEN3_TTS_REALTIME_MODEL_CATALOG,
  QWEN3_TTS_REALTIME_MODEL_IDS,
} from './qwen3-tts-realtime-models'

describe('qwen3 realtime TTS model authority', () => {
  it('exposes only the officially compatible stable models and keeps Flash as default', () => {
    expect(QWEN3_TTS_REALTIME_MODEL_IDS).toEqual([
      'qwen3-tts-flash-realtime',
      'qwen3-tts-instruct-flash-realtime',
    ])
    expect(QWEN3_TTS_REALTIME_DEFAULT_MODEL).toBe('qwen3-tts-flash-realtime')
    expect(QWEN3_TTS_REALTIME_MODEL_CATALOG.every(model => model.supportedRegions.includes('beijing') && model.supportedRegions.includes('singapore'))).toBe(true)
    expect(QWEN3_TTS_REALTIME_MODEL_CATALOG.every(model => model.compatibleVoiceIds.includes('Cherry'))).toBe(true)
  })

  it('normalizes missing and stale persisted state without accepting arbitrary IDs', () => {
    const instruct = QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id
    expect(normalizeQwen3TtsRealtimeModel(undefined)).toBe(QWEN3_TTS_REALTIME_DEFAULT_MODEL)
    expect(normalizeQwen3TtsRealtimeModel('stale-model')).toBe(QWEN3_TTS_REALTIME_DEFAULT_MODEL)
    expect(normalizeQwen3TtsRealtimeModel(instruct)).toBe(instruct)
    expect(isQwen3TtsRealtimeModel('qwen3-tts-vd-realtime')).toBe(false)
  })
})
