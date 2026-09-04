import { readFileSync } from 'node:fs'

import { PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS } from '@proj-airi/stage-ui/composables/audio/microphone-constraints'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import { describe, expect, it } from 'vitest'

import {
  classifyLocalDuplexBlockedRequest,
  isSafeDiagnosticModelId,
} from '../src/shared/local-duplex-diagnostic'
// eslint-disable-next-line no-restricted-syntax
import {
  cancelPhaseState,
  classifyLevel3LocalDeviceVerdict,
  classifyPhaseQuiescence,
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
  it('defines a no-media production-host boot probe contract', () => {
    const probeSource = readFileSync(new URL('./local-duplex-production-host-boot-probe.mjs', import.meta.url), 'utf8')

    expect(probeSource).toContain('const ELECTRON = resolve(APP_ROOT, \'node_modules/.bin/electron\')')
    expect(probeSource).toContain('child = spawn(ELECTRON, [\'.\']')
    expect(probeSource).toContain('AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE: \'boot-probe\'')
    expect(probeSource).toContain('APP_USER_DATA_PATH: diagnosticUserDataPath')
    expect(probeSource).toContain('READY_FOR_OWNER_PHASE0')
    expect(probeSource).toContain('PRODUCTION_VAD_BROWSER_INIT')
    expect(probeSource).toContain('PRODUCTION_VAD_SYNTHETIC_INFERENCE')
    expect(probeSource).toContain('BLOCKED_REQUEST_COUNT')
    expect(probeSource).toContain('process.exitCode = 1')
    expect(probeSource).toContain('production-host-boot-timeout')
  })

  it('routes the owner command through the production Electron main entry', () => {
    const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
    const diagnosticWindowSource = readFileSync(new URL('../src/main/windows/local-duplex-diagnostic.ts', import.meta.url), 'utf8')

    expect(packageSource).toContain('AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE=interactive electron-vite build')
    expect(packageSource).toContain('AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE=interactive electron-vite preview --skipBuild')
    expect(packageSource).not.toContain('smoke:realtime-voice-local-duplex.mjs')
    expect(mainSource).toContain('app.whenReady()')
    expect(mainSource).toContain('setupLocalDuplexDiagnosticWindow')
    expect(diagnosticWindowSource).toContain('session: diagnosticSession')
    expect(diagnosticWindowSource).toContain('protocol.handle(LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL')
  })

  it('uses AIRI production VAD and AudioWorklet rather than the compatibility detector', () => {
    const launcherSource = readFileSync(new URL('./local-duplex-aec-vad-smoke.mjs', import.meta.url), 'utf8')
    const rendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')

    expect(launcherSource).toContain('configFile: false')
    expect(launcherSource).toContain('disabled: true')
    expect(rendererSource).toContain('from \'../../../packages/stage-ui/src/workers/vad\'')
    expect(rendererSource).toContain('createVAD(')
    expect(rendererSource).toContain('createVADStates(')
    expect(rendererSource).toContain('process.worklet?worker&url')
    expect(rendererSource).not.toContain('@ricky0123/vad-web')
    expect(rendererSource).not.toContain('ScriptProcessor')
  })

  it('keeps the production-host diagnostic renderer on the production VAD graph', () => {
    const bootSource = readFileSync(new URL('../src/renderer/local-duplex-diagnostic-boot.ts', import.meta.url), 'utf8')
    const rendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')
    const diagnosticWindowSource = readFileSync(new URL('../src/main/windows/local-duplex-diagnostic.ts', import.meta.url), 'utf8')

    expect(bootSource).toContain('createVAD')
    expect(bootSource).toContain('createVADStates')
    expect(bootSource).toContain('process.worklet?worker&url')
    expect(bootSource).toContain('createVAD({')
    expect(bootSource).toContain('processAudio(new Float32Array(512))')
    expect(bootSource).toContain('allowRemoteModels = false')
    expect(bootSource).toContain('wasmPaths = { wasm: ortWasmUrl }')
    expect(bootSource).toContain('PRODUCTION_VAD_SYNTHETIC_INFERENCE')
    expect(rendererSource).toContain('LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL')
    expect(rendererSource).toContain('allowRemoteModels = false')
    expect(rendererSource).toContain('localModelPath =')
    expect(rendererSource).toContain('LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL}://production-vad/')
    expect(rendererSource).not.toContain('@ricky0123/vad-web')
    expect(rendererSource).not.toContain('ScriptProcessor')
    expect(diagnosticWindowSource).toContain('classifyLocalDuplexBlockedRequest')
    expect(diagnosticWindowSource).toContain('parsed.RENDERER_FAILURE_CODE')
    expect(diagnosticWindowSource).toContain('NETWORK_GUARD_FAILURE')
    expect(diagnosticWindowSource).not.toContain('parsed.FAILURE_CODE = \'external-network-blocked\'')
  })

  it('binds the browser ONNX runtime to a local wasm asset', () => {
    const bootSource = readFileSync(new URL('../src/renderer/local-duplex-diagnostic-boot.ts', import.meta.url), 'utf8')
    const onnxSource = readFileSync(new URL('../../../node_modules/.pnpm/@huggingface+transformers@3.8.1/node_modules/@huggingface/transformers/src/backends/onnx.js', import.meta.url), 'utf8')

    expect(onnxSource).toContain('https://cdn.jsdelivr.net/npm/@huggingface/transformers@')
    expect(onnxSource).toContain('/dist/')
    expect(bootSource).toContain('onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url')
    expect(bootSource).toContain('wasmPaths = { wasm: ortWasmUrl }')
    expect(bootSource).toContain('allowRemoteModels = false')
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

  it('turns phase quiescence outcomes into explicit terminal-safe decisions', () => {
    expect(classifyPhaseQuiescence({ activeSpeech: false, cancelled: false })).toBe('PASS')
    // A late speech-end before the deadline leaves the detector idle and lets
    // the next phase proceed without adding a product-level delay.
    expect(classifyPhaseQuiescence({ activeSpeech: false, cancelled: false })).toBe('PASS')
    expect(classifyPhaseQuiescence({ activeSpeech: true, cancelled: false })).toBe('TIMEOUT')
    expect(classifyPhaseQuiescence({ activeSpeech: true, cancelled: true })).toBe('CANCELLED')
  })

  it('regresses the former P3 to P4 silent-return path as a bounded failure', () => {
    const rendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')
    expect(rendererSource).toContain('PHASE_TRANSITION_STATUS')
    expect(rendererSource).toContain('PHASE_SETTLE_TIMEOUT_MS')
    expect(rendererSource).toContain('phaseTransitionFailureCode = \'phase-settle-timeout\'')
    expect(rendererSource).toContain('await finish(\'FAIL\', phaseTransitionFailureCode || \'phase-transition-failed\')')
    expect(rendererSource).toContain('settlePhase(previousPhase, \'COMPLETE\')')
    expect(rendererSource).not.toContain('if (!await runPhase(definition))\n        return')
  })

  it('preserves a completed P4 pass terminal path and cancellation semantics', () => {
    const rendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')
    expect(rendererSource).toContain('await finish(\'PASS\')')
    expect(rendererSource).toContain('await finish(\'CANCELLED\', \'owner-cancel\')')
    expect(rendererSource).toContain('VAD_RESET_API_AVAILABLE: \'NO\'')
    expect(rendererSource).toContain('VAD_RESET_API_USED: \'NO\'')
  })

  it('routes phase transition telemetry through the production-host serializer', () => {
    const hostSource = readFileSync(new URL('../src/main/windows/local-duplex-diagnostic.ts', import.meta.url), 'utf8')
    for (const field of [
      'PHASE_TRANSITION_STATUS',
      'PHASE_TRANSITION_FROM',
      'PHASE_TRANSITION_TO',
      'VAD_ACTIVE_AT_TRANSITION_START',
      'VAD_QUIESCENCE_WAIT_MS',
      'VAD_QUIESCENCE_RESULT',
      'VAD_LATE_SPEECH_END_COUNT',
      'USER_ONLY_VAD_ACTIVE_AT_PHASE_END',
      'USER_ONLY_VAD_LATE_END_AFTER_PHASE_COUNT',
    ]) {
      expect(hostSource).toContain(`'${field}'`)
    }
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

  it('classifies blocked requests without retaining query, fragment, or content', () => {
    expect(classifyLocalDuplexBlockedRequest(
      'https://huggingface.co/onnx-community/silero-vad/resolve/ddc9a7e/onnx/model.onnx?token=secret#fragment',
      'xhr',
    )).toEqual({
      protocol: 'https:',
      host: 'huggingface.co',
      requestClass: 'external-model-resource',
      resourceType: 'xhr',
    })
    expect(classifyLocalDuplexBlockedRequest(
      'https://cdn.example.test/onnxruntime/ort-wasm-simd-threaded.jsep.wasm?secret=value',
      'script',
    )).toMatchObject({
      protocol: 'https:',
      host: 'cdn.example.test',
      requestClass: 'external-onnx-wasm',
      resourceType: 'script',
    })
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

  it('serializes the production model identifier without allowing arbitrary paths', () => {
    const serialized = serializeLocalDuplexReport({
      PRODUCTION_VAD_MODEL_ID: 'onnx-community/silero-vad',
      BLOCKED_REQUEST_HOST: 'huggingface.co',
      BLOCKED_REQUEST_CLASS: 'external-model-resource',
      BLOCKED_REQUEST_PROTOCOL: 'https:',
    })
    expect(isSafeDiagnosticModelId('onnx-community/silero-vad')).toBe(true)
    expect(isSafeDiagnosticModelId('https://example.test/model')).toBe(false)
    expect(serialized).toContain('PRODUCTION_VAD_MODEL_ID=onnx-community/silero-vad')
    expect(serialized).toContain('BLOCKED_REQUEST_CLASS=external-model-resource')
    expect(serialized).not.toContain('https://')
  })

  it('serializes bounded phase transition telemetry without content', () => {
    const report = serializeLocalDuplexReport({
      PHASE_TRANSITION_STATUS: 'FAILED',
      PHASE_TRANSITION_FROM: 'PHASE_3_USER_SPEECH_CONTROL',
      PHASE_TRANSITION_TO: 'PHASE_4_USER_SPEECH_DURING_PLAYBACK',
      VAD_ACTIVE_AT_TRANSITION_START: true,
      VAD_QUIESCENCE_WAIT_MS: 3200,
      VAD_QUIESCENCE_RESULT: 'TIMEOUT',
      VAD_LATE_SPEECH_END_COUNT: 0,
      USER_ONLY_VAD_ACTIVE_AT_PHASE_END: 'YES',
      USER_ONLY_VAD_LATE_END_AFTER_PHASE_COUNT: 1,
      transcript: 'must not appear',
    })
    expect(report).toContain('PHASE_TRANSITION_STATUS=FAILED')
    expect(report).toContain('PHASE_TRANSITION_FROM=PHASE_3_USER_SPEECH_CONTROL')
    expect(report).toContain('PHASE_TRANSITION_TO=PHASE_4_USER_SPEECH_DURING_PLAYBACK')
    expect(report).toContain('VAD_QUIESCENCE_RESULT=TIMEOUT')
    expect(report).not.toContain('must not appear')
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
