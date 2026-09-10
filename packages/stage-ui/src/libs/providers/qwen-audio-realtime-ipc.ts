import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

import { QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL } from './qwen-audio-realtime-models'

/** Backwards-compatible protocol alias for the canonical model default. */
export const QWEN_AUDIO_REALTIME_ASR_MODEL = QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL
export type { QwenAudioRealtimeAsrModelId } from './qwen-audio-realtime-models'

export type QwenAudioRealtimeAsrLanguage = 'auto' | 'zh' | 'en'

export interface QwenAudioRealtimeSessionPayload {
  sessionId: string
}

export interface QwenAudioRealtimeSessionStartPayload extends QwenAudioRealtimeSessionPayload {
  language: QwenAudioRealtimeAsrLanguage
  /** Optional for legacy callers; main resolves missing values to the canonical default. */
  model?: import('./qwen-audio-realtime-models').QwenAudioRealtimeAsrModelId
}

export interface QwenAudioRealtimeAudioPayload extends QwenAudioRealtimeSessionPayload {
  /** Mono PCM16 bytes from AIRI's VAD stream. */
  audio: ArrayBuffer
}

export interface QwenAudioRealtimeTranscriptionPayload extends QwenAudioRealtimeSessionPayload {
  text: string
  sentenceId: number
  startMilliseconds: number
  durationMilliseconds: number
}

export interface QwenAudioRealtimeErrorPayload extends QwenAudioRealtimeSessionPayload {
  code: string
  message: string
}

export const qwenAudioRealtimeSessionStart = defineInvokeEventa<void, QwenAudioRealtimeSessionStartPayload>('eventa:invoke:electron:qwen-audio-realtime:session-start')
export const qwenAudioRealtimeAudioAppend = defineInvokeEventa<void, QwenAudioRealtimeAudioPayload>('eventa:invoke:electron:qwen-audio-realtime:audio-append')
export const qwenAudioRealtimeSessionFinish = defineInvokeEventa<void, QwenAudioRealtimeSessionPayload>('eventa:invoke:electron:qwen-audio-realtime:session-finish')
export const qwenAudioRealtimeSessionCancel = defineInvokeEventa<void, QwenAudioRealtimeSessionPayload>('eventa:invoke:electron:qwen-audio-realtime:session-cancel')

export const qwenAudioRealtimeSessionStarted = defineEventa<QwenAudioRealtimeSessionPayload>('eventa:event:electron:qwen-audio-realtime:session-started')
export const qwenAudioRealtimeTranscriptionPartial = defineEventa<QwenAudioRealtimeTranscriptionPayload>('eventa:event:electron:qwen-audio-realtime:transcription-partial')
export const qwenAudioRealtimeTranscriptionFinal = defineEventa<QwenAudioRealtimeTranscriptionPayload>('eventa:event:electron:qwen-audio-realtime:transcription-final')
export const qwenAudioRealtimeSessionFinished = defineEventa<QwenAudioRealtimeSessionPayload>('eventa:event:electron:qwen-audio-realtime:session-finished')
export const qwenAudioRealtimeSessionError = defineEventa<QwenAudioRealtimeErrorPayload>('eventa:event:electron:qwen-audio-realtime:session-error')
