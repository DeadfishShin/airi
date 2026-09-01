import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/** Token Plan is a separate billing and credential route from the PAYG Qwen3 route. */
export const QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID = 'qwen-audio-tts-token-plan'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL = 'qwen-audio-3.0-tts-plus'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID = 'longanlingxin'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE = 24_000

export interface QwenAudioTtsTokenPlanSessionPayload {
  sessionId: string
}

export interface QwenAudioTtsTokenPlanSessionStartPayload extends QwenAudioTtsTokenPlanSessionPayload {
  voice: string
}

export interface QwenAudioTtsTokenPlanTextAppendPayload extends QwenAudioTtsTokenPlanSessionPayload {
  text: string
}

export interface QwenAudioTtsTokenPlanAudioDeltaPayload extends QwenAudioTtsTokenPlanSessionPayload {
  /** Decoded raw PCM16LE bytes; wire-level binary/base64 never crosses this IPC contract. */
  audio: ArrayBuffer
  sequence: number
}

export interface QwenAudioTtsTokenPlanErrorPayload extends QwenAudioTtsTokenPlanSessionPayload {
  code: string
  message: string
}

export const qwenAudioTtsTokenPlanSessionStart = defineInvokeEventa<void, QwenAudioTtsTokenPlanSessionStartPayload>('eventa:invoke:electron:qwen-audio-tts-token-plan:session-start')
export const qwenAudioTtsTokenPlanTextAppend = defineInvokeEventa<void, QwenAudioTtsTokenPlanTextAppendPayload>('eventa:invoke:electron:qwen-audio-tts-token-plan:text-append')
export const qwenAudioTtsTokenPlanSessionFinish = defineInvokeEventa<void, QwenAudioTtsTokenPlanSessionPayload>('eventa:invoke:electron:qwen-audio-tts-token-plan:session-finish')
export const qwenAudioTtsTokenPlanSessionCancel = defineInvokeEventa<void, QwenAudioTtsTokenPlanSessionPayload>('eventa:invoke:electron:qwen-audio-tts-token-plan:session-cancel')

export const qwenAudioTtsTokenPlanSessionReady = defineEventa<QwenAudioTtsTokenPlanSessionPayload>('eventa:event:electron:qwen-audio-tts-token-plan:session-ready')
export const qwenAudioTtsTokenPlanAudioDelta = defineEventa<QwenAudioTtsTokenPlanAudioDeltaPayload>('eventa:event:electron:qwen-audio-tts-token-plan:audio-delta')
export const qwenAudioTtsTokenPlanResponseDone = defineEventa<QwenAudioTtsTokenPlanSessionPayload>('eventa:event:electron:qwen-audio-tts-token-plan:response-done')
export const qwenAudioTtsTokenPlanSessionFinished = defineEventa<QwenAudioTtsTokenPlanSessionPayload>('eventa:event:electron:qwen-audio-tts-token-plan:session-finished')
export const qwenAudioTtsTokenPlanSessionError = defineEventa<QwenAudioTtsTokenPlanErrorPayload>('eventa:event:electron:qwen-audio-tts-token-plan:session-error')
