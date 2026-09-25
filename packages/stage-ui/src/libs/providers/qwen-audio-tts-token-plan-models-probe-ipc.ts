import { defineInvokeEventa } from '@moeru/eventa'

export const QWEN_AUDIO_TTS_TOKEN_PLAN_MODELS_PROBE_ENDPOINT = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/models'

export type QwenAudioTtsTokenPlanModelsProbeResponseClass
  = | 'SUCCESS_OPENAI_MODEL_LIST'
    | 'SUCCESS_NON_MODEL_PAYLOAD'
    | 'SUCCESS_TEXT_ONLY_MODELS'
    | 'AUTH_401'
    | 'AUTH_403'
    | 'NOT_FOUND_404'
    | 'METHOD_NOT_ALLOWED_405'
    | 'MALFORMED_RESPONSE'
    | 'EMPTY_MODEL_LIST'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'REDIRECT_REJECTED'

export interface QwenAudioTtsTokenPlanModelsProbeResult {
  httpStatus?: number
  contentType?: string
  responseClass: QwenAudioTtsTokenPlanModelsProbeResponseClass
  modelIds: string[]
  ttsModelIds: string[]
  containsQwenAudioTtsPlus: boolean
  errorClass?: string
}

/** Renderer sends no payload. Main resolves the credential and returns this sanitized result. */
export const qwenAudioTtsTokenPlanProbeModels = defineInvokeEventa<QwenAudioTtsTokenPlanModelsProbeResult, void>('eventa:invoke:electron:qwen-audio-tts-token-plan:probe-models')
