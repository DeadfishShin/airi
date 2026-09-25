import { QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL } from './qwen-audio-realtime-token-plan-ipc'

export { QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL } from './qwen-audio-realtime-token-plan-ipc'

export const QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_IDS = [QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL] as const
export type QwenAudioRealtimeTokenPlanAsrModelId = typeof QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_IDS[number]

export const QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_CATALOG: ReadonlyArray<{
  description: string
  id: QwenAudioRealtimeTokenPlanAsrModelId
  name: string
}> = [{
  description: 'Token Plan realtime speech recognition with transcript-only output.',
  id: QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL,
  name: 'Qwen Audio 3.0 Realtime Plus — Token Plan',
}]

export function isQwenAudioRealtimeTokenPlanAsrModel(value: unknown): value is QwenAudioRealtimeTokenPlanAsrModelId {
  return value === QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL
}

export function normalizeQwenAudioRealtimeTokenPlanAsrModel(value: unknown): QwenAudioRealtimeTokenPlanAsrModelId {
  return isQwenAudioRealtimeTokenPlanAsrModel(value)
    ? value
    : QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL
}
