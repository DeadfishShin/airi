import type {
  QwenAudioRealtimePlusTokenPlanProbePreflight,
  QwenAudioRealtimePlusTokenPlanProbeResult,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_EXPECTED_DAILY_PROFILE,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

export const TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_ONCE_SWITCH = '--token-plan-realtime-transcript-probe-once'
export const TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_DRY_RUN_SWITCH = '--probe-dry-run'

const RESULT_FILE_PREFIX = 'AIRI-token-plan-realtime-transcript-probe-result-'

export type TokenPlanRealtimeTranscriptProbeMode = 'dry-run' | 'live'
export type TokenPlanRealtimeTranscriptProbeFinalState
  = | 'READY_FOR_LIVE_CONNECTION'
    | 'PROBE_SUCCESS'
    | 'PROBE_TERMINAL'
    | 'PREFLIGHT_BLOCKED'
    | 'RUNNER_ERROR'

export interface TokenPlanRealtimeTranscriptProbeArtifact {
  schemaVersion: 1
  runId: string
  mode: TokenPlanRealtimeTranscriptProbeMode
  createdAt: string
  endpoint: string
  model: string
  userDataPath?: string
  profileAuthority?: QwenAudioRealtimePlusTokenPlanProbePreflight['profileAuthority']
  credentialConfigured?: boolean
  credentialStatus?: QwenAudioRealtimePlusTokenPlanProbePreflight['credentialStatus']
  credentialSource?: QwenAudioRealtimePlusTokenPlanProbePreflight['credentialSource']
  credentialDiagnosticReason?: QwenAudioRealtimePlusTokenPlanProbePreflight['credentialDiagnosticReason']
  fixtureReady?: boolean
  fixtureFormat?: QwenAudioRealtimePlusTokenPlanProbePreflight['fixtureFormat']
  rawPcmBytes?: number
  probeReady?: boolean
  finalState: TokenPlanRealtimeTranscriptProbeFinalState
  result?: Omit<QwenAudioRealtimePlusTokenPlanProbeResult, 'transcript'> & { transcript?: string }
  errorMessage?: string
}

export interface TokenPlanRealtimeTranscriptProbeService {
  getPreflight: () => Promise<QwenAudioRealtimePlusTokenPlanProbePreflight>
  probe: () => Promise<QwenAudioRealtimePlusTokenPlanProbeResult>
}

export interface RunTokenPlanRealtimeTranscriptProbeOptions {
  mode: TokenPlanRealtimeTranscriptProbeMode
  service: TokenPlanRealtimeTranscriptProbeService
  resultDirectory?: string
  runId?: string
  now?: () => Date
  writeArtifact?: (artifact: TokenPlanRealtimeTranscriptProbeArtifact, path: string) => Promise<void>
}

export interface RunTokenPlanRealtimeTranscriptProbeResult {
  artifact: TokenPlanRealtimeTranscriptProbeArtifact
  artifactPath: string
  exitCode: number
}

export function resolveTokenPlanRealtimeTranscriptProbeMode(argv: readonly string[] = process.argv): TokenPlanRealtimeTranscriptProbeMode | undefined {
  if (!argv.includes(TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_ONCE_SWITCH))
    return undefined
  return argv.includes(TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_DRY_RUN_SWITCH) ? 'dry-run' : 'live'
}

function defaultResultDirectory() {
  return '/private/tmp'
}

function resultPath(resultDirectory: string, runId: string) {
  return join(resultDirectory, `${RESULT_FILE_PREFIX}${runId}.json`)
}

function safeResult(result: QwenAudioRealtimePlusTokenPlanProbeResult): TokenPlanRealtimeTranscriptProbeArtifact['result'] {
  return {
    stage: result.stage,
    responseClass: result.responseClass,
    handshakeStatus: result.handshakeStatus,
    sessionCreated: result.sessionCreated,
    sessionUpdated: result.sessionUpdated,
    audioChunksSent: result.audioChunksSent,
    audioBytesSent: result.audioBytesSent,
    commitSent: result.commitSent,
    commitAckReceived: result.commitAckReceived,
    committedItemIdPresent: result.committedItemIdPresent,
    userItemCreatedReceived: result.userItemCreatedReceived,
    userItemCorrelationMatch: result.userItemCorrelationMatch,
    transcriptionDeltaEventCount: result.transcriptionDeltaEventCount,
    validTextStashDeltaObserved: result.validTextStashDeltaObserved,
    malformedPartialEventCount: result.malformedPartialEventCount,
    responseCreateSent: false,
    transcriptPresent: result.transcriptPresent,
    transcript: result.transcript,
    providerErrorCode: result.providerErrorCode,
    sanitizedErrorMessage: result.sanitizedErrorMessage,
    closeCode: result.closeCode,
    closeCategory: result.closeCategory,
  }
}

export async function writeTokenPlanRealtimeTranscriptProbeArtifact(artifact: TokenPlanRealtimeTranscriptProbeArtifact, path: string) {
  const temporaryPath = `${path}.${artifact.runId}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
}

function preflightArtifactFields(preflight: QwenAudioRealtimePlusTokenPlanProbePreflight) {
  return {
    userDataPath: preflight.userDataPath,
    profileAuthority: preflight.profileAuthority,
    credentialConfigured: preflight.credentialConfigured,
    credentialStatus: preflight.credentialStatus,
    credentialSource: preflight.credentialSource,
    credentialDiagnosticReason: preflight.credentialDiagnosticReason,
    fixtureReady: preflight.fixtureReady,
    fixtureFormat: preflight.fixtureFormat,
    rawPcmBytes: preflight.rawPcmBytes,
    probeReady: preflight.probeReady,
  }
}

export async function runTokenPlanRealtimeTranscriptProbe(options: RunTokenPlanRealtimeTranscriptProbeOptions): Promise<RunTokenPlanRealtimeTranscriptProbeResult> {
  const runId = options.runId ?? randomUUID()
  const now = options.now ?? (() => new Date())
  const artifactPath = resultPath(options.resultDirectory ?? defaultResultDirectory(), runId)
  const writeArtifact = options.writeArtifact ?? writeTokenPlanRealtimeTranscriptProbeArtifact

  let preflight: QwenAudioRealtimePlusTokenPlanProbePreflight | undefined
  try {
    preflight = await options.service.getPreflight()
  }
  catch (error) {
    const artifact: TokenPlanRealtimeTranscriptProbeArtifact = {
      schemaVersion: 1,
      runId,
      mode: options.mode,
      createdAt: now().toISOString(),
      endpoint: QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
      model: QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL,
      finalState: 'RUNNER_ERROR',
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : 'Unable to read runtime preflight.',
    }
    await writeArtifact(artifact, artifactPath)
    return { artifact, artifactPath, exitCode: 2 }
  }

  const common: TokenPlanRealtimeTranscriptProbeArtifact = {
    schemaVersion: 1,
    runId,
    mode: options.mode,
    createdAt: now().toISOString(),
    endpoint: QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
    model: QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL,
    ...preflightArtifactFields(preflight),
    finalState: preflight.probeReady ? 'READY_FOR_LIVE_CONNECTION' : 'PREFLIGHT_BLOCKED',
  }

  if (options.mode === 'dry-run' || !preflight.probeReady) {
    await writeArtifact(common, artifactPath)
    return { artifact: common, artifactPath, exitCode: preflight.probeReady ? 0 : 2 }
  }

  try {
    const result = await options.service.probe()
    const artifact: TokenPlanRealtimeTranscriptProbeArtifact = {
      ...common,
      finalState: result.responseClass === 'SUCCESS_TRANSCRIPT_ONLY' ? 'PROBE_SUCCESS' : 'PROBE_TERMINAL',
      result: safeResult(result),
    }
    await writeArtifact(artifact, artifactPath)
    return { artifact, artifactPath, exitCode: result.responseClass === 'SUCCESS_TRANSCRIPT_ONLY' ? 0 : 3 }
  }
  catch (error) {
    const artifact: TokenPlanRealtimeTranscriptProbeArtifact = {
      ...common,
      finalState: 'RUNNER_ERROR',
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : 'Probe runner failed.',
    }
    await writeArtifact(artifact, artifactPath)
    return { artifact, artifactPath, exitCode: 3 }
  }
}

export const TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_DAILY_PROFILE = QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_EXPECTED_DAILY_PROFILE
