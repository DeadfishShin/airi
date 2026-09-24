import type { QwenAudioTtsTokenPlanCredentialSource } from './qwen-audio-tts-token-plan-credential-ipc'

import { defineInvokeEventa } from '@moeru/eventa'

/**
 * Capability hypothesis only: current public docs do not map this model to
 * this compatible path. It must not be treated as the production ASR contract.
 */
export const QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
export const QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_MODEL = 'qwen-audio-3.0-asr-flash'
export const QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT_AUTHORITY = 'HYPOTHESIS_NOT_DOCUMENTED_FOR_QWEN_AUDIO_3_0_ASR_FLASH' as const
export const QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE = '/Users/mizukinamachi/Library/Application Support/ai.moeru.airi' as const

export type QwenAudioAsrTokenPlanRuntimeProfileAuthority = 'DAILY_PROFILE' | 'NON_DAILY_PROFILE'
export type QwenAudioAsrTokenPlanCredentialStatus = 'saved' | 'missing' | 'unavailable'

export interface QwenAudioAsrTokenPlanPreflightResult {
  userDataPath: string
  profileAuthority: QwenAudioAsrTokenPlanRuntimeProfileAuthority
  profileAuthorityMatch: boolean
  credentialConfigured: boolean
  credentialStatus: QwenAudioAsrTokenPlanCredentialStatus
  credentialSource: QwenAudioTtsTokenPlanCredentialSource
  fixtureReady: boolean
  probeReady: boolean
}

export type QwenAudioAsrTokenPlanProbeResponseClass
  = | 'SUCCESS_CHAT_COMPLETION_TRANSCRIPT'
    | 'SUCCESS_EMPTY_TRANSCRIPT'
    | 'SUCCESS_UNEXPECTED_SCHEMA'
    | 'BAD_REQUEST_400'
    | 'AUTH_401'
    | 'AUTH_403'
    | 'NOT_FOUND_404'
    | 'METHOD_NOT_ALLOWED_405'
    | 'UNPROCESSABLE_422'
    | 'RATE_LIMIT_429'
    | 'SERVER_ERROR_5XX'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'REDIRECT_REJECTED'
    | 'MALFORMED_RESPONSE'

export interface QwenAudioAsrTokenPlanProbeResult {
  httpStatus?: number
  contentType?: string
  responseClass: QwenAudioAsrTokenPlanProbeResponseClass
  providerErrorCode?: string
  sanitizedErrorMessage?: string
  responseSchema?: string
  transcript?: string
  transcriptPresent: boolean
}

/** Renderer sends no payload; main resolves the credential and fixture. */
export const qwenAudioAsrTokenPlanProbe = defineInvokeEventa<QwenAudioAsrTokenPlanProbeResult, void>('eventa:invoke:electron:qwen-audio-asr-token-plan:probe')
export const qwenAudioAsrTokenPlanGetPreflight = defineInvokeEventa<QwenAudioAsrTokenPlanPreflightResult, void>('eventa:invoke:electron:qwen-audio-asr-token-plan:get-preflight')
