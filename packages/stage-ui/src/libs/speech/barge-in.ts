/**
 * Content-free counters for the renderer-local barge-in transaction.
 *
 * The state is intentionally bounded and in-memory. It is diagnostic
 * correlation only; transcript, prompt, audio, and provider payloads never
 * enter this module.
 */
export interface BargeInTelemetrySnapshot {
  localVadActiveDuringPlayback: boolean
  triggerCount: number
  duplicateTriggerSuppressedCount: number
  ttsCancelCount: number
  generationCancelOrInvalidateCount: number
  remoteAsrAuthorizeCount: number
  staleOutputSuppressedCount: number
  epoch: number
}

export interface BargeInTriggerResult {
  triggered: boolean
  duplicateSuppressed: boolean
  epoch: number
}

export interface BargeInControllerOptions {
  onBargeIn: (event: { epoch: number }) => void
}

let telemetry: BargeInTelemetrySnapshot = createEmptySnapshot()

function createEmptySnapshot(): BargeInTelemetrySnapshot {
  return {
    localVadActiveDuringPlayback: false,
    triggerCount: 0,
    duplicateTriggerSuppressedCount: 0,
    ttsCancelCount: 0,
    generationCancelOrInvalidateCount: 0,
    remoteAsrAuthorizeCount: 0,
    staleOutputSuppressedCount: 0,
    epoch: 0,
  }
}

export function resetBargeInTelemetry() {
  telemetry = createEmptySnapshot()
}

export function getBargeInTelemetry(): Readonly<BargeInTelemetrySnapshot> {
  return { ...telemetry }
}

export function recordBargeInTtsCancel() {
  telemetry.ttsCancelCount += 1
}

export function recordBargeInGenerationCancelOrInvalidate() {
  telemetry.generationCancelOrInvalidateCount += 1
}

export function recordBargeInRemoteAsrAuthorization() {
  telemetry.remoteAsrAuthorizeCount += 1
}

export function recordBargeInStaleOutputSuppressed() {
  telemetry.staleOutputSuppressedCount += 1
}

export function createBargeInController(options: BargeInControllerOptions) {
  let assistantPlaybackActive = false
  let triggerConsumedForPlayback = false
  let interruptionAuthorized = false
  let localVadActive = false
  let currentAssistantTurnId: string | undefined

  function setLocalVadActive(active: boolean) {
    localVadActive = active
    telemetry.localVadActiveDuringPlayback = assistantPlaybackActive && localVadActive
  }

  function assistantTurnStarted(turnId?: string) {
    if (turnId !== undefined && currentAssistantTurnId === turnId)
      return

    currentAssistantTurnId = turnId
    triggerConsumedForPlayback = false
    interruptionAuthorized = false
    telemetry.epoch += 1
  }

  function assistantPlaybackStarted() {
    if (assistantPlaybackActive)
      return

    assistantPlaybackActive = true
    telemetry.localVadActiveDuringPlayback = localVadActive
  }

  function assistantPlaybackEnded() {
    assistantPlaybackActive = false
    telemetry.localVadActiveDuringPlayback = false
  }

  function speechStart(): BargeInTriggerResult {
    if (!assistantPlaybackActive) {
      return {
        triggered: false,
        duplicateSuppressed: false,
        epoch: telemetry.epoch,
      }
    }

    telemetry.localVadActiveDuringPlayback = localVadActive
    if (triggerConsumedForPlayback) {
      telemetry.duplicateTriggerSuppressedCount += 1
      return {
        triggered: false,
        duplicateSuppressed: true,
        epoch: telemetry.epoch,
      }
    }

    triggerConsumedForPlayback = true
    interruptionAuthorized = true
    telemetry.triggerCount += 1
    options.onBargeIn({ epoch: telemetry.epoch })
    return {
      triggered: true,
      duplicateSuppressed: false,
      epoch: telemetry.epoch,
    }
  }

  function reset() {
    assistantPlaybackActive = false
    triggerConsumedForPlayback = false
    interruptionAuthorized = false
    localVadActive = false
    currentAssistantTurnId = undefined
    telemetry.localVadActiveDuringPlayback = false
  }

  return {
    assistantTurnStarted,
    assistantPlaybackStarted,
    assistantPlaybackEnded,
    speechStart,
    setLocalVadActive,
    reset,
    isAssistantPlaybackActive: () => assistantPlaybackActive,
    // TTS cancellation drops the speaking flag, but late ASR finals from the
    // interrupted user utterance still belong to the authorized new turn.
    isInterruptionActive: () => interruptionAuthorized,
    snapshot: getBargeInTelemetry,
  }
}
