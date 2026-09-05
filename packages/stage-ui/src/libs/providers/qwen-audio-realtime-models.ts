/**
 * Models supported by AIRI's current Qwen Audio realtime run-task adapter.
 *
 * This intentionally contains one model. Other realtime Qwen ASR products
 * use a different endpoint/event protocol and are not selectable here.
 */
export const QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL = 'qwen-audio-3.0-asr-flash-streaming' as const

export const QWEN_AUDIO_REALTIME_ASR_MODEL_IDS = [QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL] as const

export type QwenAudioRealtimeAsrModelId = typeof QWEN_AUDIO_REALTIME_ASR_MODEL_IDS[number]

export interface QwenAudioRealtimeAsrModelAuthority {
  description: string
  id: QwenAudioRealtimeAsrModelId
  name: string
}

export const QWEN_AUDIO_REALTIME_ASR_MODEL_CATALOG: readonly QwenAudioRealtimeAsrModelAuthority[] = [{
  id: QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
  name: 'Qwen Audio 3.0 ASR Flash Streaming',
  description: 'Realtime streaming speech recognition through Alibaba Cloud Model Studio.',
}]

export function isQwenAudioRealtimeAsrModel(value: unknown): value is QwenAudioRealtimeAsrModelId {
  return typeof value === 'string'
    && (QWEN_AUDIO_REALTIME_ASR_MODEL_IDS as readonly string[]).includes(value)
}

/** Missing and stale persisted values resolve to the current safe default. */
export function normalizeQwenAudioRealtimeAsrModel(value: unknown): QwenAudioRealtimeAsrModelId {
  return isQwenAudioRealtimeAsrModel(value) ? value : QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL
}
