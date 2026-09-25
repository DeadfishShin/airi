import type { QwenAudioRealtimePlusTokenPlanProbePreflight, QwenAudioRealtimePlusTokenPlanProbeResult } from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

import { describe, expect, it, vi } from 'vitest'

import {
  resolveTokenPlanRealtimeTranscriptProbeMode,
  runTokenPlanRealtimeTranscriptProbe,
  TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_DRY_RUN_SWITCH,
  TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_ONCE_SWITCH,
} from './one-shot-runner'

const preflight: QwenAudioRealtimePlusTokenPlanProbePreflight = {
  userDataPath: '/Users/mizukinamachi/Library/Application Support/ai.moeru.airi',
  profileAuthority: 'DAILY_PROFILE',
  profileAuthorityMatch: true,
  credentialConfigured: true,
  credentialStatus: 'saved',
  credentialSource: 'secure-store',
  credentialDiagnosticReason: 'PROFILE_PRESENT_CONFIGURED',
  fixtureReady: true,
  fixtureFormat: 'pcm16-mono-16khz',
  rawPcmBytes: 29_984,
  probeReady: true,
}

const success: QwenAudioRealtimePlusTokenPlanProbeResult = {
  stage: 'complete',
  responseClass: 'SUCCESS_TRANSCRIPT_ONLY',
  handshakeStatus: 'opened',
  sessionCreated: true,
  sessionUpdated: true,
  audioChunksSent: 30,
  audioBytesSent: 29_984,
  commitSent: true,
  commitAckReceived: true,
  committedItemIdPresent: true,
  userItemCreatedReceived: true,
  userItemCorrelationMatch: true,
  transcriptionDeltaEventCount: 1,
  validTextStashDeltaObserved: true,
  malformedPartialEventCount: 0,
  responseCreateSent: false,
  transcriptPresent: true,
  transcript: 'AIRI probe',
}

function service(overrides: Partial<{ preflight: QwenAudioRealtimePlusTokenPlanProbePreflight, result: QwenAudioRealtimePlusTokenPlanProbeResult }> = {}) {
  return {
    getPreflight: vi.fn(async () => overrides.preflight ?? preflight),
    probe: vi.fn(async () => overrides.result ?? success),
  }
}

describe('token Plan realtime transcript one-shot runner', () => {
  it('keeps normal launch disabled and resolves explicit modes only', () => {
    expect(resolveTokenPlanRealtimeTranscriptProbeMode(['airi'])).toBeUndefined()
    expect(resolveTokenPlanRealtimeTranscriptProbeMode(['airi', TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_ONCE_SWITCH])).toBe('live')
    expect(resolveTokenPlanRealtimeTranscriptProbeMode(['airi', TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_ONCE_SWITCH, TOKEN_PLAN_REALTIME_TRANSCRIPT_PROBE_DRY_RUN_SWITCH])).toBe('dry-run')
  })

  it('runs dry-run preflight without invoking the WebSocket probe', async () => {
    const probeService = service()
    const writeArtifact = vi.fn(async () => {})
    const run = await runTokenPlanRealtimeTranscriptProbe({ mode: 'dry-run', service: probeService, runId: 'dry-run-test', writeArtifact })

    expect(run.artifact.finalState).toBe('READY_FOR_LIVE_CONNECTION')
    expect(run.exitCode).toBe(0)
    expect(probeService.probe).not.toHaveBeenCalled()
    expect(writeArtifact).toHaveBeenCalledOnce()
  })

  it('runs live mode at most once after a ready preflight and writes only sanitized result fields', async () => {
    const probeService = service()
    let artifact: Awaited<ReturnType<typeof runTokenPlanRealtimeTranscriptProbe>>['artifact'] | undefined
    const run = await runTokenPlanRealtimeTranscriptProbe({
      mode: 'live',
      service: probeService,
      runId: 'live-run-test',
      writeArtifact: async (next) => { artifact = next },
    })

    expect(run.artifact.finalState).toBe('PROBE_SUCCESS')
    expect(probeService.probe).toHaveBeenCalledOnce()
    expect(JSON.stringify(artifact)).not.toContain('apiKey')
    expect(JSON.stringify(artifact)).not.toContain('Authorization')
    expect(JSON.stringify(artifact)).not.toContain('base64')
  })

  it('does not open the probe when preflight is blocked', async () => {
    const blocked = service({ preflight: { ...preflight, probeReady: false, credentialConfigured: false, credentialStatus: 'missing' } })
    const run = await runTokenPlanRealtimeTranscriptProbe({ mode: 'live', service: blocked, runId: 'blocked-test', writeArtifact: async () => {} })

    expect(run.artifact.finalState).toBe('PREFLIGHT_BLOCKED')
    expect(run.exitCode).toBe(2)
    expect(blocked.probe).not.toHaveBeenCalled()
  })
})
