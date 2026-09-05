import type { ModelInfo } from './types'

/**
 * Stable Qwen3 realtime TTS models whose protocol and region support are
 * verified by the official Model Studio documentation. Snapshot IDs are
 * retained as provenance only; stable IDs are the user-facing authority.
 */
export const QWEN3_TTS_REALTIME_MODEL_CATALOG = [
  {
    id: 'qwen3-tts-flash-realtime',
    name: 'Qwen3 TTS Flash Realtime',
    description: 'Realtime text-to-speech through Alibaba Cloud Model Studio.',
    snapshotId: 'qwen3-tts-flash-realtime-2025-11-27',
    supportedRegions: ['beijing', 'singapore'],
  },
  {
    id: 'qwen3-tts-instruct-flash-realtime',
    name: 'Qwen3 TTS Instruct Flash Realtime',
    description: 'Realtime text-to-speech with the shared Qwen-TTS realtime protocol.',
    snapshotId: 'qwen3-tts-instruct-flash-realtime-2026-01-22',
    supportedRegions: ['beijing', 'singapore'],
  },
] as const

export type Qwen3TtsRealtimeModelId = typeof QWEN3_TTS_REALTIME_MODEL_CATALOG[number]['id']

export const QWEN3_TTS_REALTIME_DEFAULT_MODEL: Qwen3TtsRealtimeModelId = QWEN3_TTS_REALTIME_MODEL_CATALOG[0].id

export const QWEN3_TTS_REALTIME_MODEL_IDS = QWEN3_TTS_REALTIME_MODEL_CATALOG.map(model => model.id) as Qwen3TtsRealtimeModelId[]

export function isQwen3TtsRealtimeModel(value: unknown): value is Qwen3TtsRealtimeModelId {
  return typeof value === 'string' && QWEN3_TTS_REALTIME_MODEL_IDS.includes(value as Qwen3TtsRealtimeModelId)
}

/** Normalizes empty or stale persisted state to the validated default. */
export function normalizeQwen3TtsRealtimeModel(value: unknown): Qwen3TtsRealtimeModelId {
  return isQwen3TtsRealtimeModel(value) ? value : QWEN3_TTS_REALTIME_DEFAULT_MODEL
}

export function qwen3TtsRealtimeModelInfo(model: typeof QWEN3_TTS_REALTIME_MODEL_CATALOG[number]): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    provider: 'qwen3-tts-realtime',
    description: model.description,
    contextLength: 0,
    deprecated: false,
  }
}
