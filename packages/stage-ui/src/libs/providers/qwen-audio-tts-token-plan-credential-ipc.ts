import { defineInvokeEventa } from '@moeru/eventa'

export type QwenAudioTtsTokenPlanCredentialSource = 'secure-store' | 'environment' | 'none'

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
