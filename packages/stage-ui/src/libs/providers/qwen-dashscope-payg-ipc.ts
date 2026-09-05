import { defineInvokeEventa } from '@moeru/eventa'

export const QWEN_DASHSCOPE_PAYG_PROFILE = 'QWEN_DASHSCOPE_PAYG'

export type QwenDashScopeRegion = 'beijing' | 'singapore'

export interface QwenDashScopePaygPublicProfile {
  hasApiKey: boolean
  workspaceId: string
  workspaceIdValid: boolean
  region: QwenDashScopeRegion | null
  regionConfigured: boolean
  ready: boolean
}

export interface QwenDashScopePaygSavePayload {
  apiKey: string
  workspaceId: string
  region: QwenDashScopeRegion
}

export const qwenDashScopePaygGetProfile = defineInvokeEventa<QwenDashScopePaygPublicProfile, void>('eventa:invoke:electron:qwen-dashscope-payg:get-profile')
export const qwenDashScopePaygSaveProfile = defineInvokeEventa<QwenDashScopePaygPublicProfile, QwenDashScopePaygSavePayload>('eventa:invoke:electron:qwen-dashscope-payg:save-profile')
export const qwenDashScopePaygClearProfile = defineInvokeEventa<QwenDashScopePaygPublicProfile, void>('eventa:invoke:electron:qwen-dashscope-payg:clear-profile')
