import { readFileSync } from 'node:fs'

import { PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS } from '@proj-airi/stage-ui/composables/audio/microphone-constraints'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line no-restricted-syntax
import {
  cancelPhaseState,
  classifyLevel3LocalDeviceVerdict,
  classifyPlaybackOnlyFalseTrigger,
  completePhase,
  createPhaseState,
  isAllowedLocalResource,
  level2TrackVerdict,
  LOCAL_DUPLEX_SMOKE_CREDENTIAL_NAMES,
  LOCAL_DUPLEX_SMOKE_PHASES,
  normalizeFiniteMetric,
  normalizeTrackBoolean,
  serializeLocalDuplexReport,
  startPhase,
  stripCredentialEnvironment,
} from './local-duplex-aec-vad-smoke-logic.mjs'

describe('local duplex AEC/VAD smoke diagnostics', () => {
  it('uses AIRI production VAD and AudioWorklet rather than the compatibility detector', () => {
    const rendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')

    expect(rendererSource).toContain('from \'../../../packages/stage-ui/src/workers/vad\'')
    expect(rendererSource).toContain('createVAD(')
    expect(rendererSource).toContain('createVADStates(')
    expect(rendererSource).toContain('process.worklet?worker&url')
    expect(rendererSource).not.toContain('@ricky0123/vad-web')
    expect(rendererSource).not.toContain('ScriptProcessor')
  })

  it('keeps the production-equivalent microphone constraints and VAD defaults', () => {
    expect(PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    })
    expect(PRODUCTION_VAD_DEFAULTS).toEqual({
      threshold: 0.52,
      minSilenceDurationMs: 1200,
      speechPadMs: 360,
      minSpeechDurationMs: 300,
      sampleRate: 16000,
    })
    expect(resolveProductionVADConfig()).toMatchObject({
      speechThreshold: 0.52,
      exitThreshold: 0.156,
      minSilenceDurationMs: 1200,
      speechPadMs: 360,
      minSpeechDurationMs: 300,
    })
  })

  it('models the bounded phase state machine and cancellation', () => {
    const state = createPhaseState()
    expect(LOCAL_DUPLEX_SMOKE_PHASES).toHaveLength(5)
    expect(startPhase(state, 'PHASE_1_QUIET_BASELINE')).toBe(true)
    expect(completePhase(state, 'PHASE_1_QUIET_BASELINE')).toBe(true)
    expect(state.completed).toEqual(['PHASE_1_QUIET_BASELINE'])
    cancelPhaseState(state)
    expect(startPhase(state, 'PHASE_2_PLAYBACK_ONLY')).toBe(false)
    expect(completePhase(state, 'PHASE_2_PLAYBACK_ONLY')).toBe(false)
  })

  it('requires effective track settings for Level 2', () => {
    expect(level2TrackVerdict(true)).toBe('YES')
    expect(level2TrackVerdict(false)).toBe('NO')
    expect(level2TrackVerdict(undefined)).toBe('UNKNOWN')
    expect(normalizeTrackBoolean([false, true])).toBe('YES')
    expect(normalizeTrackBoolean([])).toBe('UNKNOWN')
  })

  it('requires both playback isolation and speech controls for Level 3', () => {
    expect(classifyPlaybackOnlyFalseTrigger({ credibleSpeechStartCount: 0 })).toBe('NO')
    expect(classifyPlaybackOnlyFalseTrigger({ credibleSpeechStartCount: 1 })).toBe('YES')
    expect(classifyPlaybackOnlyFalseTrigger({ credibleSpeechStartCount: 0, environmentInterpretable: false })).toBe('INCONCLUSIVE')
    expect(classifyLevel3LocalDeviceVerdict({
      level2: 'YES',
      playbackOnlyFalseTrigger: 'NO',
      userOnlyDetected: 'YES',
      userDuringPlaybackDetected: 'YES',
      productionVadAlignment: 'YES',
      phaseIsolation: 'YES',
      environmentInterpretable: 'YES',
      playbackProfile: 'macos-local-speech',
      cleanupCompleted: 'YES',
      externalNetworkRequestCount: 0,
    })).toBe('PASS')
    expect(classifyLevel3LocalDeviceVerdict({
      level2: 'UNKNOWN',
      playbackOnlyFalseTrigger: 'NO',
      userOnlyDetected: 'YES',
      userDuringPlaybackDetected: 'YES',
    })).toBe('INCONCLUSIVE')
    expect(classifyLevel3LocalDeviceVerdict({
      level2: 'YES',
      playbackOnlyFalseTrigger: 'NO',
      userOnlyDetected: 'YES',
      userDuringPlaybackDetected: 'YES',
      productionVadAlignment: 'YES',
      phaseIsolation: 'YES',
      environmentInterpretable: 'YES',
      playbackProfile: 'synthetic-compatibility',
      cleanupCompleted: 'YES',
      externalNetworkRequestCount: 0,
    })).toBe('INCONCLUSIVE')
  })

  it('rejects non-local resources and permits loopback only', () => {
    expect(isAllowedLocalResource('http://127.0.0.1:3456/')).toBe(true)
    expect(isAllowedLocalResource('http://localhost:3456/')).toBe(true)
    expect(isAllowedLocalResource('file:///tmp/local.html')).toBe(true)
    expect(isAllowedLocalResource('https://example.com/')).toBe(false)
    expect(isAllowedLocalResource('wss://token-plan.cn-beijing.maas.aliyuncs.com/')).toBe(false)
  })

  it('strips all cloud credential names without exposing values', () => {
    const environment: Record<string, string> = Object.fromEntries(LOCAL_DUPLEX_SMOKE_CREDENTIAL_NAMES.map(name => [name, 'redacted-test-value']))
    environment.LOCAL_ONLY = 'yes'
    expect(stripCredentialEnvironment(environment)).toBe(true)
    expect(environment).toEqual({ LOCAL_ONLY: 'yes' })
  })

  it('normalizes non-finite metrics and serializes only bounded fields', () => {
    expect(normalizeFiniteMetric(12.345)).toBe(12.35)
    expect(normalizeFiniteMetric(Number.NaN)).toBe('UNKNOWN')
    const serialized = serializeLocalDuplexReport({
      SMOKE_STATUS: 'PASS',
      HARNESS_READY: 'YES',
      USER_ONLY_FIRST_ACTIVITY_LATENCY_MS: 23.4,
      FAILURE_CODE: 'none',
      transcript: 'must never appear',
      PCM: 'must never appear',
    })
    expect(serialized).toContain('SMOKE_STATUS=PASS')
    expect(serialized).toContain('USER_ONLY_FIRST_ACTIVITY_LATENCY_MS=23.4')
    expect(serialized).not.toContain('transcript')
    expect(serialized).not.toContain('PCM')
    expect(serialized).not.toContain('must never appear')
    expect(serialized).not.toContain('NaN')
  })

  it('defines a cleanup contract in the bounded report', () => {
    const serialized = serializeLocalDuplexReport({
      SMOKE_STATUS: 'CANCELLED',
      CLEANUP_COMPLETED: 'YES',
      PLAYBACK_GAIN_MAX: 0.25,
    })
    expect(serialized).toContain('SMOKE_STATUS=CANCELLED')
    expect(serialized).toContain('CLEANUP_COMPLETED=YES')
    expect(serialized).toContain('PLAYBACK_GAIN_MAX=0.25')
  })
})
