import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID = 'qwen-audio-realtime-token-plan-transcription'
export const QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL = 'qwen-audio-3.0-realtime-plus' as const

export type QwenAudioRealtimeTokenPlanAsrLanguage = 'auto' | 'zh' | 'en'

export interface QwenAudioRealtimeTokenPlanSessionPayload {
  sessionId: string
}

export interface QwenAudioRealtimeTokenPlanSessionStartPayload extends QwenAudioRealtimeTokenPlanSessionPayload {
  language: QwenAudioRealtimeTokenPlanAsrLanguage
  model?: typeof QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL
}

export interface QwenAudioRealtimeTokenPlanAudioPayload extends QwenAudioRealtimeTokenPlanSessionPayload {
  /** PCM16 little-endian mono samples at 16 kHz. */
  audio: ArrayBuffer
}

export interface QwenAudioRealtimeTokenPlanTranscriptionPayload extends QwenAudioRealtimeTokenPlanSessionPayload {
  text: string
  isFinal: boolean
}

export interface QwenAudioRealtimeTokenPlanErrorPayload extends QwenAudioRealtimeTokenPlanSessionPayload {
  code: string
  message: string
}

export const qwenAudioRealtimeTokenPlanSessionStart = defineInvokeEventa<void, QwenAudioRealtimeTokenPlanSessionStartPayload>('eventa:invoke:electron:qwen-audio-realtime-token-plan:session-start')
export const qwenAudioRealtimeTokenPlanAudioAppend = defineInvokeEventa<void, QwenAudioRealtimeTokenPlanAudioPayload>('eventa:invoke:electron:qwen-audio-realtime-token-plan:audio-append')
export const qwenAudioRealtimeTokenPlanSessionFinish = defineInvokeEventa<void, QwenAudioRealtimeTokenPlanSessionPayload>('eventa:invoke:electron:qwen-audio-realtime-token-plan:session-finish')
export const qwenAudioRealtimeTokenPlanSessionCancel = defineInvokeEventa<void, QwenAudioRealtimeTokenPlanSessionPayload>('eventa:invoke:electron:qwen-audio-realtime-token-plan:session-cancel')

export const qwenAudioRealtimeTokenPlanSessionStarted = defineEventa<QwenAudioRealtimeTokenPlanSessionPayload>('eventa:event:electron:qwen-audio-realtime-token-plan:session-started')
export const qwenAudioRealtimeTokenPlanTranscription = defineEventa<QwenAudioRealtimeTokenPlanTranscriptionPayload>('eventa:event:electron:qwen-audio-realtime-token-plan:transcription')
export const qwenAudioRealtimeTokenPlanSessionFinished = defineEventa<QwenAudioRealtimeTokenPlanSessionPayload>('eventa:event:electron:qwen-audio-realtime-token-plan:session-finished')
export const qwenAudioRealtimeTokenPlanSessionError = defineEventa<QwenAudioRealtimeTokenPlanErrorPayload>('eventa:event:electron:qwen-audio-realtime-token-plan:session-error')
