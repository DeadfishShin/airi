import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { RealtimeVoiceE2eTurnTelemetryPayload } from '@proj-airi/stage-ui/libs/providers/realtime-voice-e2e-ipc'
import type { Lifecycle } from 'injeca'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronMainContext } from '@moeru/eventa/adapters/electron/main'
import { realtimeVoiceE2eTurnTelemetry } from '@proj-airi/stage-ui/libs/providers/realtime-voice-e2e-ipc'
import { ipcMain } from 'electron'

type RealtimeVoiceE2eMainEventContext = ReturnType<typeof createContext>['context']

export const MAX_REALTIME_VOICE_E2E_TURN_LOGS = 64

export interface RealtimeVoiceE2eTelemetryServiceOptions {
  context: RealtimeVoiceE2eMainEventContext
  lifecycle?: Lifecycle
}

function boundedTurnId(value: string): string {
  return value.trim().slice(-24)
}

function finiteMetric(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isBoundedPayload(payload: RealtimeVoiceE2eTurnTelemetryPayload): boolean {
  return typeof payload.turnId === 'string'
    && payload.turnId.trim().length > 0
    && payload.turnId.trim().length <= 128
}

/** Main-process sink for one content-free, renderer-clock voice-turn summary. */
export function createRealtimeVoiceE2eTelemetryService(options: RealtimeVoiceE2eTelemetryServiceOptions) {
  const loggedTurnIds = new Set<string>()

  const rememberTurn = (turnId: string) => {
    if (loggedTurnIds.has(turnId))
      return false

    loggedTurnIds.add(turnId)
    while (loggedTurnIds.size > MAX_REALTIME_VOICE_E2E_TURN_LOGS)
      loggedTurnIds.delete(loggedTurnIds.values().next().value as string)
    return true
  }

  const handler = defineInvokeHandler(options.context, realtimeVoiceE2eTurnTelemetry, (payload) => {
    if (!isBoundedPayload(payload))
      throw new Error('Realtime voice E2E telemetry turn ID is invalid.')

    const turnId = boundedTurnId(payload.turnId)
    if (!rememberTurn(turnId))
      return

    console.info('[Realtime Voice E2E] turn finished', {
      turnId,
      asrFinalToTranscriptFlushMs: finiteMetric(payload.asrFinalToTranscriptFlushMs),
      transcriptFlushToChatSubmissionMs: finiteMetric(payload.transcriptFlushToChatSubmissionMs),
      asrFinalToChatSubmissionMs: finiteMetric(payload.asrFinalToChatSubmissionMs),
      chatSubmissionToFirstLlmTextMs: finiteMetric(payload.chatSubmissionToFirstLlmTextMs),
      firstLlmTextToFirstTtsAppendMs: finiteMetric(payload.firstLlmTextToFirstTtsAppendMs),
      firstLlmTextToFirstTtsAudioEventMs: finiteMetric(payload.firstLlmTextToFirstTtsAudioEventMs),
      firstLlmTextToFirstTtsPlaybackScheduleMs: finiteMetric(payload.firstLlmTextToFirstTtsPlaybackScheduleMs),
      firstAudioEventRelativeToInputFinishMs: finiteMetric(payload.firstAudioEventRelativeToInputFinishMs),
      firstAudioScheduledRelativeToInputFinishMs: finiteMetric(payload.firstAudioScheduledRelativeToInputFinishMs),
      asrFinalToFirstTtsPlaybackScheduleMs: finiteMetric(payload.asrFinalToFirstTtsPlaybackScheduleMs),
      speechEndToFirstTtsPlaybackScheduleMs: finiteMetric(payload.speechEndToFirstTtsPlaybackScheduleMs),
    })
  })

  const dispose = () => {
    loggedTurnIds.clear()
    handler()
  }
  options.lifecycle?.appHooks.onStop(dispose)

  return {
    dispose,
    getLoggedTurnCount: () => loggedTurnIds.size,
  }
}

export function setupRealtimeVoiceE2eTelemetry(options: Omit<RealtimeVoiceE2eTelemetryServiceOptions, 'context'> = {}) {
  const eventa = createElectronMainContext(ipcMain)
  return createRealtimeVoiceE2eTelemetryService({ ...options, context: eventa.context })
}
