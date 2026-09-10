import { defineInvokeEventa } from '@moeru/eventa'

export interface DeepSeekCredentialPublicProfile {
  hasCredential: boolean
  ready: boolean
}

export interface DeepSeekCredentialSavePayload {
  apiKey: string
}

export const deepSeekCredentialGetProfile = defineInvokeEventa<DeepSeekCredentialPublicProfile, void>('eventa:invoke:electron:deepseek-credentials:get-profile')
export const deepSeekCredentialSave = defineInvokeEventa<DeepSeekCredentialPublicProfile, DeepSeekCredentialSavePayload>('eventa:invoke:electron:deepseek-credentials:save')
export const deepSeekCredentialClear = defineInvokeEventa<DeepSeekCredentialPublicProfile, void>('eventa:invoke:electron:deepseek-credentials:clear')
export const deepSeekCredentialGetRuntime = defineInvokeEventa<string, void>('eventa:invoke:electron:deepseek-credentials:get-runtime')
