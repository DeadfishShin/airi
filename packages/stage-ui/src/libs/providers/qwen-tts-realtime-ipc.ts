import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const QWEN3_TTS_REALTIME_PROVIDER_ID = 'qwen3-tts-realtime'
export const QWEN3_TTS_REALTIME_MODEL = 'qwen3-tts-flash-realtime'

export type Qwen3TtsRealtimeMode = 'server_commit' | 'commit'
export type Qwen3TtsRealtimeLanguageType
  = | 'Auto'
    | 'Chinese'
    | 'English'
    | 'German'
    | 'Italian'
    | 'Portuguese'
    | 'Spanish'
    | 'Japanese'
    | 'Korean'
    | 'French'
    | 'Russian'

export interface Qwen3TtsRealtimeSessionPayload {
  sessionId: string
}

export interface Qwen3TtsRealtimeSessionStartPayload extends Qwen3TtsRealtimeSessionPayload {
  voice: string
  languageType: Qwen3TtsRealtimeLanguageType
  mode: Qwen3TtsRealtimeMode
}

export interface Qwen3TtsRealtimeTextAppendPayload extends Qwen3TtsRealtimeSessionPayload {
  text: string
}

export interface Qwen3TtsRealtimeAudioDeltaPayload extends Qwen3TtsRealtimeSessionPayload {
  /** Decoded mono PCM16 bytes. No credentials or wire-level base64 crosses IPC. */
  audio: ArrayBuffer
  sequence: number
}

export interface Qwen3TtsRealtimeErrorPayload extends Qwen3TtsRealtimeSessionPayload {
  code: string
  message: string
}

export const qwen3TtsRealtimeSessionStart = defineInvokeEventa<void, Qwen3TtsRealtimeSessionStartPayload>('eventa:invoke:electron:qwen3-tts-realtime:session-start')
export const qwen3TtsRealtimeTextAppend = defineInvokeEventa<void, Qwen3TtsRealtimeTextAppendPayload>('eventa:invoke:electron:qwen3-tts-realtime:text-append')
export const qwen3TtsRealtimeSessionFinish = defineInvokeEventa<void, Qwen3TtsRealtimeSessionPayload>('eventa:invoke:electron:qwen3-tts-realtime:session-finish')
export const qwen3TtsRealtimeSessionCancel = defineInvokeEventa<void, Qwen3TtsRealtimeSessionPayload>('eventa:invoke:electron:qwen3-tts-realtime:session-cancel')

export const qwen3TtsRealtimeSessionReady = defineEventa<Qwen3TtsRealtimeSessionPayload>('eventa:event:electron:qwen3-tts-realtime:session-ready')
export const qwen3TtsRealtimeAudioDelta = defineEventa<Qwen3TtsRealtimeAudioDeltaPayload>('eventa:event:electron:qwen3-tts-realtime:audio-delta')
export const qwen3TtsRealtimeResponseDone = defineEventa<Qwen3TtsRealtimeSessionPayload>('eventa:event:electron:qwen3-tts-realtime:response-done')
export const qwen3TtsRealtimeSessionFinished = defineEventa<Qwen3TtsRealtimeSessionPayload>('eventa:event:electron:qwen3-tts-realtime:session-finished')
export const qwen3TtsRealtimeSessionError = defineEventa<Qwen3TtsRealtimeErrorPayload>('eventa:event:electron:qwen3-tts-realtime:session-error')
