import { defineInvokeEventa } from '@moeru/eventa'

export type QwenAudioTtsTokenPlanCredentialSource = 'secure-store' | 'environment' | 'none'

export type QwenAudioTtsTokenPlanCredentialDiagnosticReason
  = | 'RECORD_ABSENT'
    | 'RECORD_PRESENT'
    | 'ENCRYPTION_UNAVAILABLE'
    | 'DECRYPT_FAILED'
    | 'PAYLOAD_PARSE_FAILED'
    | 'SCHEMA_INVALID'
    | 'PROFILE_NOT_FOUND'
    | 'PROFILE_PRESENT_CONFIGURED'
    | 'ENVIRONMENT_CONFIGURED'
    | 'UNKNOWN_ERROR'

export interface QwenAudioTtsTokenPlanCredentialDiagnostic {
  reason: QwenAudioTtsTokenPlanCredentialDiagnosticReason
  recordPresent: boolean
  recordSchema: 'absent' | 'valid' | 'invalid' | 'unreadable'
  decryption: 'not-attempted' | 'succeeded' | 'failed'
  profile: 'absent' | 'configured' | 'environment' | 'unavailable'
}

export interface QwenAudioTtsTokenPlanPublicProfile {
  hasApiKey: boolean
  ready: boolean
  source: QwenAudioTtsTokenPlanCredentialSource
  secureStorageAvailable: boolean
}

export interface QwenAudioTtsTokenPlanSavePayload {
  apiKey: string
}

export const qwenAudioTtsTokenPlanGetProfile = defineInvokeEventa<QwenAudioTtsTokenPlanPublicProfile, void>('eventa:invoke:electron:qwen-audio-tts-token-plan-credential:get-profile')
export const qwenAudioTtsTokenPlanSaveProfile = defineInvokeEventa<QwenAudioTtsTokenPlanPublicProfile, QwenAudioTtsTokenPlanSavePayload>('eventa:invoke:electron:qwen-audio-tts-token-plan-credential:save-profile')
export const qwenAudioTtsTokenPlanClearProfile = defineInvokeEventa<QwenAudioTtsTokenPlanPublicProfile, void>('eventa:invoke:electron:qwen-audio-tts-token-plan-credential:clear-profile')
