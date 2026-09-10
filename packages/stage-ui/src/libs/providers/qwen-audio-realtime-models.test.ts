import { describe, expect, it } from 'vitest'

import {
  isQwenAudioRealtimeAsrModel,
  normalizeQwenAudioRealtimeAsrModel,
  QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
  QWEN_AUDIO_REALTIME_ASR_MODEL_CATALOG,
  QWEN_AUDIO_REALTIME_ASR_MODEL_IDS,
} from './qwen-audio-realtime-models'

describe('qwen Audio realtime ASR model authority', () => {
  it('exposes only the officially compatible current run-task model', () => {
    expect(QWEN_AUDIO_REALTIME_ASR_MODEL_IDS).toEqual(['qwen-audio-3.0-asr-flash-streaming'])
    expect(QWEN_AUDIO_REALTIME_ASR_MODEL_CATALOG.map(model => model.id)).toEqual([...QWEN_AUDIO_REALTIME_ASR_MODEL_IDS])
    expect(QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL).toBe('qwen-audio-3.0-asr-flash-streaming')
  })

  it('accepts the canonical model and normalizes missing or stale persisted values', () => {
    expect(isQwenAudioRealtimeAsrModel(QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL)).toBe(true)
    expect(isQwenAudioRealtimeAsrModel('qwen-audio-3.0-asr-flash')).toBe(false)
    expect(isQwenAudioRealtimeAsrModel('qwen3-asr-flash-realtime')).toBe(false)
    expect(normalizeQwenAudioRealtimeAsrModel(undefined)).toBe(QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL)
    expect(normalizeQwenAudioRealtimeAsrModel('stale-model')).toBe(QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL)
  })
})
