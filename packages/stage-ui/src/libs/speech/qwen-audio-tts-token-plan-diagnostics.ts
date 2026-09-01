export type QwenAudioTtsTokenPlanStageMilestone
  = | 'STAGE_BEFORE_MESSAGE'
    | 'STAGE_PROVIDER_SELECTED'
    | 'STAGE_MODEL_SELECTED'
    | 'STAGE_VOICE_ID_SELECTED'
    | 'STAGE_VOICE_OBJECT_RESOLVED'
    | 'STAGE_MUTED'
    | 'STAGE_TRANSPORT_RESOLVED'
    | 'STAGE_AUDIO_CONTEXT_AVAILABLE'
    | 'STAGE_SNAPSHOT_READY'
    | 'STAGE_SESSION_CREATED'
    | 'STAGE_SESSION_CREATE_FAILED'
    | 'TOKEN_PLAN_RENDERER_START_REQUESTED'
    | 'TOKEN_PLAN_RENDERER_START_RESOLVED'
    | 'TOKEN_PLAN_FIRST_APPEND_REQUESTED'
    | 'TOKEN_PLAN_FINISH_REQUESTED'

export interface QwenAudioTtsTokenPlanStageDiagnosticDetails {
  sessionId?: string
  providerId?: string
  modelId?: string
  voiceId?: string
  transport?: string
  muted?: boolean
  available?: boolean
  resolved?: boolean
  ready?: boolean
}

const MAX_DIAGNOSTIC_ID_LENGTH = 32

function boundedId(value: string) {
  return value.slice(0, MAX_DIAGNOSTIC_ID_LENGTH)
}

/**
 * Creates a once-per-session, content-free diagnostic sink for the Token Plan
 * Stage entry path. The sink is deliberately injectable so the milestone
 * contract can be tested without relying on a renderer console.
 */
export function createQwenAudioTtsTokenPlanStageDiagnostics(
  initialSessionId: string,
  sink: (milestone: QwenAudioTtsTokenPlanStageMilestone, details: QwenAudioTtsTokenPlanStageDiagnosticDetails) => void = (milestone, details) => {
    console.info('[Qwen Audio Token Plan TTS stage] milestone', { milestone, ...details })
  },
) {
  const emitted = new Set<QwenAudioTtsTokenPlanStageMilestone>()
  let sessionId = boundedId(initialSessionId)

  return {
    setSessionId(nextSessionId: string) {
      sessionId = boundedId(nextSessionId)
    },
    emit(milestone: QwenAudioTtsTokenPlanStageMilestone, details: QwenAudioTtsTokenPlanStageDiagnosticDetails = {}) {
      if (emitted.has(milestone))
        return
      emitted.add(milestone)
      sink(milestone, { sessionId, ...details })
    },
  }
}
