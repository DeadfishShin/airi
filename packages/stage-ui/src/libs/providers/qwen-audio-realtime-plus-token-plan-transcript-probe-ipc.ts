import type {
  QwenAudioTtsTokenPlanCredentialDiagnosticReason,
  QwenAudioTtsTokenPlanCredentialSource,
} from './qwen-audio-tts-token-plan-credential-ipc'

import { defineInvokeEventa } from '@moeru/eventa'

/**
 * This is a documented-composite hypothesis, not a single-page Token Plan
 * native-WebSocket contract for qwen-audio-3.0-realtime-plus.
 */
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT = 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus'
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL = 'qwen-audio-3.0-realtime-plus' as const
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_ENDPOINT_AUTHORITY = 'DOCUMENTED_COMPOSITE_STRONGLY_INFERRED_LIVE_UNPROVEN' as const
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_EXPECTED_DAILY_PROFILE = '/Users/mizukinamachi/Library/Application Support/ai.moeru.airi' as const
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_FIXTURE_EXPECTED_TEXT = 'AIRI probe' as const
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PCM_CHUNK_SAMPLES = 512 as const
export const QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PCM_CHUNK_BYTES = QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PCM_CHUNK_SAMPLES * 2

export type QwenAudioRealtimePlusTokenPlanProbeProfileAuthority = 'DAILY_PROFILE' | 'NON_DAILY_PROFILE'
export type QwenAudioRealtimePlusTokenPlanProbeCredentialStatus = 'saved' | 'missing' | 'unavailable'

export interface QwenAudioRealtimePlusTokenPlanProbePreflight {
  userDataPath: string
  profileAuthority: QwenAudioRealtimePlusTokenPlanProbeProfileAuthority
  profileAuthorityMatch: boolean
  credentialConfigured: boolean
  credentialStatus: QwenAudioRealtimePlusTokenPlanProbeCredentialStatus
  credentialSource: QwenAudioTtsTokenPlanCredentialSource
  credentialDiagnosticReason: QwenAudioTtsTokenPlanCredentialDiagnosticReason
  fixtureReady: boolean
  fixtureFormat: 'pcm16-mono-16khz' | 'invalid'
  rawPcmBytes: number
  probeReady: boolean
}

export type QwenAudioRealtimePlusTokenPlanProbeResponseClass
  = | 'SUCCESS_TRANSCRIPT_ONLY'
    | 'HANDSHAKE_AUTH_401'
    | 'HANDSHAKE_AUTH_403'
    | 'HANDSHAKE_OTHER_HTTP_ERROR'
    | 'DNS_NETWORK_ERROR'
    | 'SESSION_CREATED_TIMEOUT'
    | 'SESSION_ERROR'
    | 'SESSION_UPDATED_TIMEOUT'
    | 'SESSION_UPDATE_REJECTED'
    | 'INVALID_MODEL'
    | 'AUDIO_APPEND_ERROR'
    | 'COMMIT_ERROR'
    | 'TRANSCRIPTION_FAILED'
    | 'TRANSCRIPT_TIMEOUT'
    | 'EMPTY_TRANSCRIPT'
    | 'UNEXPECTED_VENDOR_RESPONSE_GENERATION'
    | 'CONNECTION_CLOSED_BEFORE_TRANSCRIPT'
    | 'MALFORMED_EVENT'
    | 'PROBE_NOT_READY'

export interface QwenAudioRealtimePlusTokenPlanProbeResult {
  stage: 'preflight' | 'handshake' | 'session' | 'audio' | 'transcription' | 'closed' | 'complete'
  responseClass: QwenAudioRealtimePlusTokenPlanProbeResponseClass
  handshakeStatus?: 'opened' | 'failed'
  sessionCreated: boolean
  sessionUpdated: boolean
  audioChunksSent: number
  audioBytesSent: number
  commitSent: boolean
  commitAckReceived: boolean
  committedItemIdPresent: boolean
  userItemCreatedReceived: boolean
  userItemCorrelationMatch: boolean
  transcriptionDeltaEventCount: number
  validTextStashDeltaObserved: boolean
  malformedPartialEventCount: number
  responseCreateSent: false
  transcriptPresent: boolean
  transcript?: string
  providerErrorCode?: string
  sanitizedErrorMessage?: string
  closeCode?: number
  closeCategory?: string
}

/** Renderer sends only an empty manual intent; the main process resolves key and fixture. */
export const qwenAudioRealtimePlusTokenPlanProbe = defineInvokeEventa<QwenAudioRealtimePlusTokenPlanProbeResult, void>('eventa:invoke:electron:qwen-audio-realtime-plus-token-plan:probe')
export const qwenAudioRealtimePlusTokenPlanGetPreflight = defineInvokeEventa<QwenAudioRealtimePlusTokenPlanProbePreflight, void>('eventa:invoke:electron:qwen-audio-realtime-plus-token-plan:get-preflight')
