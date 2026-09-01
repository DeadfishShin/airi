import type { EventContext } from '@moeru/eventa'

import type { RealtimeVoiceE2eTurnTelemetryPayload } from '../providers/realtime-voice-e2e-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'

import { realtimeVoiceE2eTurnTelemetry } from '../providers/realtime-voice-e2e-ipc'

export const MAX_REALTIME_VOICE_E2E_TURNS = 64
const MAX_TURN_ID_LENGTH = 64

type RealtimeVoiceTurnMilestone
  = | 'asrFinalReceivedAt'
    | 'transcriptFlushRequestedAt'
    | 'chatSubmissionAt'
    | 'firstLlmTextAt'
    | 'firstTtsAppendAt'
    | 'firstTtsAudioEventAt'
    | 'firstTtsPlaybackScheduleAt'

export interface RealtimeVoiceTurnState {
  turnId: string
  status: 'active' | 'completed' | 'cancelled' | 'failed'
  asrFinalReceivedAt?: number
  transcriptFlushRequestedAt?: number
  chatSubmissionAt?: number
  firstLlmTextAt?: number
  firstTtsAppendAt?: number
  firstTtsAudioEventAt?: number
  firstTtsPlaybackScheduleAt?: number
}

const turns = new Map<string, RealtimeVoiceTurnState>()
let fallbackTurnSequence = 0

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function finiteTimestamp(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function createOpaqueTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function')
    return `voice-${globalThis.crypto.randomUUID()}`

  fallbackTurnSequence += 1
  return `voice-${fallbackTurnSequence}`
}

function boundedTurnId(turnId: string): string {
  return turnId.length > MAX_TURN_ID_LENGTH ? turnId.slice(-MAX_TURN_ID_LENGTH) : turnId
}

function pruneTurns() {
  while (turns.size > MAX_REALTIME_VOICE_E2E_TURNS)
    turns.delete(turns.keys().next().value as string)
}

/** Creates a renderer-local voice-turn identity before chat creates its round id. */
export function createRealtimeVoiceTurn(options: { turnId?: string, at?: number } = {}): string {
  const turnId = boundedTurnId(options.turnId?.trim() || createOpaqueTurnId())
  turns.set(turnId, {
    turnId,
    status: 'active',
    ...(finiteTimestamp(options.at) === undefined ? {} : { asrFinalReceivedAt: options.at }),
  })
  pruneTurns()
  return turnId
}

/** Records a first-only renderer-clock milestone for an active voice turn. */
export function recordRealtimeVoiceTurnMilestone(turnId: string | undefined, milestone: RealtimeVoiceTurnMilestone, at = now()): void {
  if (!turnId)
    return

  const state = turns.get(turnId)
  const timestamp = finiteTimestamp(at)
  if (!state || state.status !== 'active' || timestamp === undefined)
    return

  state[milestone] ??= timestamp
}

export function cancelRealtimeVoiceTurn(turnId: string | undefined): void {
  if (!turnId)
    return
  const state = turns.get(turnId)
  if (state?.status === 'active')
    state.status = 'cancelled'
}

export function failRealtimeVoiceTurn(turnId: string | undefined): void {
  if (!turnId)
    return
  const state = turns.get(turnId)
  if (state?.status === 'active')
    state.status = 'failed'
}

function elapsed(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined)
    return undefined
  return end - start
}

/**
 * Completes one turn after local TTS drain. Missing required milestones do not
 * produce a successful report, which keeps non-voice and failed paths silent.
 */
export function completeRealtimeVoiceTurn(turnId: string | undefined): RealtimeVoiceE2eTurnTelemetryPayload | undefined {
  if (!turnId)
    return undefined

  const state = turns.get(turnId)
  if (!state || state.status !== 'active')
    return undefined

  if (state.chatSubmissionAt === undefined || state.firstLlmTextAt === undefined || state.firstTtsPlaybackScheduleAt === undefined)
    return undefined

  state.status = 'completed'

  return {
    turnId: boundedTurnId(state.turnId),
    asrFinalToTranscriptFlushMs: elapsed(state.asrFinalReceivedAt, state.transcriptFlushRequestedAt),
    transcriptFlushToChatSubmissionMs: elapsed(state.transcriptFlushRequestedAt, state.chatSubmissionAt),
    asrFinalToChatSubmissionMs: elapsed(state.asrFinalReceivedAt, state.chatSubmissionAt),
    chatSubmissionToFirstLlmTextMs: elapsed(state.chatSubmissionAt, state.firstLlmTextAt),
    firstLlmTextToFirstTtsAppendMs: elapsed(state.firstLlmTextAt, state.firstTtsAppendAt),
    firstLlmTextToFirstTtsAudioEventMs: elapsed(state.firstLlmTextAt, state.firstTtsAudioEventAt),
    firstLlmTextToFirstTtsPlaybackScheduleMs: elapsed(state.firstLlmTextAt, state.firstTtsPlaybackScheduleAt),
    asrFinalToFirstTtsPlaybackScheduleMs: elapsed(state.asrFinalReceivedAt, state.firstTtsPlaybackScheduleAt),
  }
}

/** Test/teardown seam; bounded state is renderer-local and never persisted. */
export function resetRealtimeVoiceE2eTelemetry(): void {
  turns.clear()
}

export function getRealtimeVoiceTurnTelemetry(turnId: string | undefined): Readonly<RealtimeVoiceTurnState> | undefined {
  return turnId ? turns.get(turnId) : undefined
}

/** Best-effort Electron-main sink; an unavailable diagnostic sink never affects speech completion. */
export async function reportRealtimeVoiceE2eTurnTelemetry(payload: RealtimeVoiceE2eTurnTelemetryPayload): Promise<void> {
  if (typeof window === 'undefined' || !isElectronWindow(window))
    return

  const eventa = createElectronRendererContext(window.electron.ipcRenderer)
  const report = defineInvoke(eventa.context as EventContext<any, any>, realtimeVoiceE2eTurnTelemetry)
  try {
    await report(payload)
  }
  finally {
    eventa.dispose()
  }
}
