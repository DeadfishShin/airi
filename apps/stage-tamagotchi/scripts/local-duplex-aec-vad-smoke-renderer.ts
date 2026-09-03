// eslint-disable-next-line no-restricted-syntax
import type {
  LOCAL_DUPLEX_SMOKE_PHASES,
} from './local-duplex-aec-vad-smoke-logic.mjs'

import { env } from '@huggingface/transformers'

import vadWorkletUrl from '../../../packages/stage-ui/src/workers/vad/process.worklet?worker&url'

import { PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS } from '../../../packages/stage-ui/src/composables/audio/microphone-constraints'
import { createVAD, createVADStates } from '../../../packages/stage-ui/src/workers/vad'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '../../../packages/stage-ui/src/workers/vad/config'
import {
  PRODUCTION_VAD_MODEL_DTYPE,
  PRODUCTION_VAD_MODEL_ID,
  PRODUCTION_VAD_MODEL_REVISION,
} from '../../../packages/stage-ui/src/workers/vad/model-authority'
import { LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL } from '../src/shared/local-duplex-diagnostic'
// eslint-disable-next-line no-restricted-syntax
import {
  classifyLevel3LocalDeviceVerdict,
  classifyPlaybackOnlyFalseTrigger,
  level2TrackVerdict,
  normalizeFiniteMetric,
  normalizeTrackBoolean,
} from './local-duplex-aec-vad-smoke-logic.mjs'

const REPORT_MARKER = 'LOCAL_DUPLEX_AEC_VAD_REPORT_JSON:'
const PLAYBACK_GAIN_MAX = 0.25
const PLAYBACK_PROFILE = 'synthetic-compatibility'
const PHASE_SETTLE_MS = PRODUCTION_VAD_DEFAULTS.minSilenceDurationMs + 300
const PHASE_OBSERVATION_PADDING_MS = 350

type PhaseKey = Exclude<typeof LOCAL_DUPLEX_SMOKE_PHASES[number], 'PHASE_0_TRACK_INSPECTION'>
type PhaseDefinition = readonly [PhaseKey, string, string, number, boolean]

const phaseDefinitions: readonly PhaseDefinition[] = [
  ['PHASE_1_QUIET_BASELINE', 'PHASE_1 — quiet baseline', 'Please remain quiet while the microphone baseline is measured.', 3500, false],
  ['PHASE_2_PLAYBACK_ONLY', 'PHASE_2 — playback only', 'A local deterministic assistant-like signal will play. Please remain quiet.', 4500, true],
  ['PHASE_3_USER_SPEECH_CONTROL', 'PHASE_3 — user speech control', 'When the countdown ends, say one short sentence. No audio is saved or transcribed.', 5500, false],
  ['PHASE_4_USER_SPEECH_DURING_PLAYBACK', 'PHASE_4 — user speech during playback', 'When the countdown ends, speak one short sentence while the local signal plays.', 5500, true],
]

const elements = {
  phase: document.getElementById('phase') as HTMLDivElement,
  instruction: document.getElementById('instruction') as HTMLDivElement,
  countdown: document.getElementById('countdown') as HTMLDivElement,
  status: document.getElementById('status') as HTMLDivElement,
  cancel: document.getElementById('cancel') as HTMLButtonElement,
}

// The production-host main process uses this content-free handshake to prove that
// the diagnostic renderer reached its pre-PHASE_0 boundary before media is requested.
window.airiLocalDuplexDiagnostic?.notifyReady()

interface PhaseResult {
  starts: number
  ends: number
  firstStartAt?: number
  startedAt?: number
}

const phaseState = {
  current: undefined as PhaseKey | undefined,
  cancelled: false,
  finished: false,
  completed: [] as PhaseKey[],
}
const phaseResults: Record<PhaseKey, PhaseResult> = Object.fromEntries(
  phaseDefinitions.map(([key]) => [key, { starts: 0, ends: 0 }]),
) as Record<PhaseKey, PhaseResult>
const waiters = new Set<{ resolve: () => void, timer: number }>()

let audioContext: AudioContext | undefined
let microphoneStream: MediaStream | undefined
let microphoneTrack: MediaStreamTrack | undefined
let vad: Awaited<ReturnType<typeof createVAD>> | undefined
let vadManager: ReturnType<typeof createVADStates> | undefined
let playbackGain: GainNode | undefined
let playbackSource: AudioBufferSourceNode | undefined
let playbackStartCount = 0
let playbackEndCount = 0
let trackSnapshot: Record<string, string | number> = {}
let trackInspectionComplete = false
let vadRuntimeReady = false
let activeSpeech = false
let phaseIsolationReady = true

const browserTransformersEnv = env as typeof env & {
  backends: { onnx: { wasm?: { wasmPaths?: string } } }
}

browserTransformersEnv.allowRemoteModels = false
browserTransformersEnv.allowLocalModels = true
browserTransformersEnv.localModelPath = `${LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL}://production-vad/`
browserTransformersEnv.useBrowserCache = false
browserTransformersEnv.useFSCache = false
browserTransformersEnv.useCustomCache = false
// The production Electron build includes the ONNX Runtime wasm asset next to
// this renderer bundle. Leave its URL resolution to Transformers.js/Vite so
// the diagnostic host does not need a second wasm server or path convention.

function updateStatus(message: string) {
  elements.status.textContent = message
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const waiter = {
      resolve,
      timer: window.setTimeout(() => {
        waiters.delete(waiter)
        resolve()
      }, milliseconds),
    }
    waiters.add(waiter)
  })
}

function abortWaiters() {
  for (const waiter of waiters) {
    window.clearTimeout(waiter.timer)
    waiter.resolve()
  }
  waiters.clear()
}

function safeTrackValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 'UNKNOWN'
}

function safeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function trackField(source: unknown, field: string) {
  return source && typeof source === 'object' ? (source as Record<string, unknown>)[field] : undefined
}

function readTrackMethod(method: 'getConstraints' | 'getCapabilities' | 'getSettings') {
  try {
    return typeof microphoneTrack?.[method] === 'function' ? microphoneTrack[method]() : undefined
  }
  catch {
    return undefined
  }
}

function inspectTrack() {
  const constraints = readTrackMethod('getConstraints')
  const capabilities = readTrackMethod('getCapabilities')
  const settings = readTrackMethod('getSettings')
  trackSnapshot = {
    TRACK_CONSTRAINTS_SUPPORTED: constraints ? 'YES' : 'NO',
    TRACK_CAPABILITIES_SUPPORTED: capabilities ? 'YES' : 'NO',
    TRACK_SETTINGS_SUPPORTED: settings ? 'YES' : 'NO',
    AEC_REQUESTED: 'YES',
    AEC_CAPABILITY: normalizeTrackBoolean(trackField(capabilities, 'echoCancellation')),
    AEC_SETTING: normalizeTrackBoolean(trackField(settings, 'echoCancellation')),
    AEC_LEVEL_2_PASS: level2TrackVerdict(safeBoolean(trackField(settings, 'echoCancellation'))),
    NS_REQUESTED: 'YES',
    NS_CAPABILITY: normalizeTrackBoolean(trackField(capabilities, 'noiseSuppression')),
    NS_SETTING: normalizeTrackBoolean(trackField(settings, 'noiseSuppression')),
    NS_LEVEL_2_PASS: level2TrackVerdict(safeBoolean(trackField(settings, 'noiseSuppression'))),
    AGC_REQUESTED: 'YES',
    AGC_CAPABILITY: normalizeTrackBoolean(trackField(capabilities, 'autoGainControl')),
    AGC_SETTING: normalizeTrackBoolean(trackField(settings, 'autoGainControl')),
    AGC_LEVEL_2_PASS: level2TrackVerdict(safeBoolean(trackField(settings, 'autoGainControl'))),
    MIC_SAMPLE_RATE: safeTrackValue(trackField(settings, 'sampleRate')),
    MIC_CHANNEL_COUNT: safeTrackValue(trackField(settings, 'channelCount')),
  }
  trackInspectionComplete = true
}

function recordVadEvent(kind: 'start' | 'end') {
  activeSpeech = kind === 'start'
  const phase = phaseState.current
  if (!phase)
    return
  const result = phaseResults[phase]
  if (kind === 'start') {
    result.starts++
    result.firstStartAt ??= performance.now()
  }
  else {
    result.ends++
  }
}

function createLocalPlaybackBuffer(durationSeconds: number) {
  if (!audioContext)
    throw new Error('playback-audio-context-unavailable')
  const sampleRate = audioContext.sampleRate
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds))
  const buffer = audioContext.createBuffer(1, frameCount, sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate
    const attack = Math.min(1, time / 0.12)
    const release = Math.min(1, (durationSeconds - time) / 0.28)
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.1 * time)
    const carrier = Math.sin(2 * Math.PI * 180 * time) + 0.24 * Math.sin(2 * Math.PI * 360 * time)
    samples[index] = 0.055 * attack * Math.max(0, release) * (0.68 + 0.32 * syllable) * carrier
  }
  return buffer
}

function startLocalPlayback(durationSeconds: number) {
  if (!audioContext || !playbackGain)
    throw new Error('playback-audio-system-unavailable')
  const source = audioContext.createBufferSource()
  source.buffer = createLocalPlaybackBuffer(durationSeconds)
  source.connect(playbackGain)
  source.onended = () => {
    playbackEndCount++
    if (playbackSource === source)
      playbackSource = undefined
  }
  playbackSource = source
  playbackStartCount++
  source.start()
}

function stopLocalPlayback() {
  const source = playbackSource
  playbackSource = undefined
  if (!source)
    return
  try {
    source.stop()
  }
  catch { /* already ended */ }
  try {
    source.disconnect()
  }
  catch { /* already disconnected */ }
}

async function countdown(label: string, instruction: string) {
  elements.phase.textContent = label
  elements.instruction.textContent = instruction
  for (const number of [3, 2, 1]) {
    if (phaseState.cancelled)
      return false
    elements.countdown.textContent = String(number)
    await wait(1000)
  }
  elements.countdown.textContent = 'START'
  return !phaseState.cancelled
}

async function settlePhase() {
  stopLocalPlayback()
  phaseState.current = undefined
  updateStatus('Settling the production VAD state before the next observation window.')
  await wait(PHASE_SETTLE_MS)
  const settled = !activeSpeech && !phaseState.cancelled
  if (!settled)
    phaseIsolationReady = false
  return settled
}

async function runPhase([key, label, instruction, durationMs, withPlayback]: PhaseDefinition) {
  if (!await settlePhase())
    return false
  if (!await countdown(label, instruction))
    return false
  phaseState.current = key
  phaseResults[key].startedAt = performance.now()
  updateStatus('Observation window running. Only production VAD event counts are collected.')
  if (withPlayback)
    startLocalPlayback(Math.min(3.8, Math.max(1.5, durationMs / 1000 - 0.3)))
  await wait(durationMs)
  stopLocalPlayback()
  phaseState.current = undefined
  phaseState.completed.push(key)
  elements.countdown.textContent = 'END'
  updateStatus('Phase complete. Preparing the next bounded observation window.')
  await wait(PHASE_OBSERVATION_PADDING_MS)
  return !phaseState.cancelled
}

function phaseMetric(key: PhaseKey, field: keyof PhaseResult) {
  return phaseResults[key]?.[field]
}

function phaseLatency(key: PhaseKey) {
  const result = phaseResults[key]
  if (result.firstStartAt === undefined || result.startedAt === undefined)
    return 'UNKNOWN'
  return normalizeFiniteMetric(result.firstStartAt - result.startedAt)
}

function detected(key: PhaseKey) {
  return phaseMetric(key, 'starts')! > 0 ? 'YES' : 'NO'
}

function buildReport(status: string, failureCode?: string): Record<string, unknown> {
  const quietBaselineComplete = phaseState.completed.includes('PHASE_1_QUIET_BASELINE')
  const environmentInterpretable = !quietBaselineComplete
    ? 'UNKNOWN'
    : phaseMetric('PHASE_1_QUIET_BASELINE', 'starts')! > 0 ? 'NO' : 'YES'
  const playbackOnlyFalseTrigger = classifyPlaybackOnlyFalseTrigger({
    credibleSpeechStartCount: phaseMetric('PHASE_2_PLAYBACK_ONLY', 'starts')!,
    observationWindowComplete: phaseState.completed.includes('PHASE_2_PLAYBACK_ONLY'),
    environmentInterpretable: environmentInterpretable === 'YES',
  })
  const userOnlyDetected = detected('PHASE_3_USER_SPEECH_CONTROL')
  const userDuringPlaybackDetected = detected('PHASE_4_USER_SPEECH_DURING_PLAYBACK')
  const level2 = trackSnapshot.AEC_LEVEL_2_PASS
  const level3 = classifyLevel3LocalDeviceVerdict({
    level2,
    playbackOnlyFalseTrigger,
    userOnlyDetected,
    userDuringPlaybackDetected,
    productionVadAlignment: vadRuntimeReady ? 'YES' : 'UNKNOWN',
    phaseIsolation: phaseIsolationReady && phaseState.completed.length === phaseDefinitions.length ? 'YES' : 'INCONCLUSIVE',
    environmentInterpretable,
    playbackProfile: PLAYBACK_PROFILE,
    cleanupCompleted: status === 'PASS' ? 'YES' : 'UNKNOWN',
  })

  return {
    SMOKE_STATUS: status,
    HARNESS_READY: status === 'PASS' ? 'YES' : 'UNKNOWN',
    VAD_RUNTIME: vadRuntimeReady ? 'AIRI_PRODUCTION_VAD' : 'UNAVAILABLE',
    PRODUCTION_VAD_ALIGNMENT: vadRuntimeReady ? 'YES' : 'UNKNOWN',
    PRODUCTION_VAD_MODEL_ID,
    PRODUCTION_VAD_MODEL_REVISION,
    PRODUCTION_VAD_MODEL_DTYPE,
    PRODUCTION_VAD_ASSET: 'vendored-local-offline',
    PRODUCTION_VAD_AUDIO_PATH: 'AudioWorklet-production',
    PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED: 'NO',
    ENVIRONMENT_INTERPRETABLE: environmentInterpretable,
    PHASE_ISOLATION: phaseIsolationReady && phaseState.completed.length === phaseDefinitions.length ? 'YES' : 'INCONCLUSIVE',
    PHASE_0_TRACK_INSPECTION: trackInspectionComplete ? 'YES' : 'UNKNOWN',
    ...trackSnapshot,
    VAD_THRESHOLD: PRODUCTION_VAD_DEFAULTS.threshold,
    VAD_EXIT_THRESHOLD: PRODUCTION_VAD_DEFAULTS.threshold * 0.3,
    VAD_MIN_SILENCE_DURATION_MS: PRODUCTION_VAD_DEFAULTS.minSilenceDurationMs,
    VAD_SPEECH_PAD_MS: PRODUCTION_VAD_DEFAULTS.speechPadMs,
    VAD_MIN_SPEECH_DURATION_MS: PRODUCTION_VAD_DEFAULTS.minSpeechDurationMs,
    VAD_SAMPLE_RATE: PRODUCTION_VAD_DEFAULTS.sampleRate,
    PHASE_SETTLE_MS,
    PLAYBACK_PROFILE,
    PLAYBACK_GAIN_MAX,
    PLAYBACK_START_COUNT: playbackStartCount,
    PLAYBACK_END_COUNT: playbackEndCount,
    QUIET_VAD_START_COUNT: phaseMetric('PHASE_1_QUIET_BASELINE', 'starts'),
    QUIET_VAD_END_COUNT: phaseMetric('PHASE_1_QUIET_BASELINE', 'ends'),
    PLAYBACK_ONLY_VAD_START_COUNT: phaseMetric('PHASE_2_PLAYBACK_ONLY', 'starts'),
    PLAYBACK_ONLY_VAD_END_COUNT: phaseMetric('PHASE_2_PLAYBACK_ONLY', 'ends'),
    USER_ONLY_VAD_START_COUNT: phaseMetric('PHASE_3_USER_SPEECH_CONTROL', 'starts'),
    USER_ONLY_VAD_END_COUNT: phaseMetric('PHASE_3_USER_SPEECH_CONTROL', 'ends'),
    USER_ONLY_FIRST_ACTIVITY_LATENCY_MS: phaseLatency('PHASE_3_USER_SPEECH_CONTROL'),
    USER_DURING_PLAYBACK_VAD_START_COUNT: phaseMetric('PHASE_4_USER_SPEECH_DURING_PLAYBACK', 'starts'),
    USER_DURING_PLAYBACK_VAD_END_COUNT: phaseMetric('PHASE_4_USER_SPEECH_DURING_PLAYBACK', 'ends'),
    USER_DURING_PLAYBACK_FIRST_ACTIVITY_LATENCY_MS: phaseLatency('PHASE_4_USER_SPEECH_DURING_PLAYBACK'),
    PLAYBACK_ONLY_FALSE_TRIGGER: playbackOnlyFalseTrigger,
    USER_ONLY_DETECTED: userOnlyDetected,
    USER_DURING_PLAYBACK_DETECTED: userDuringPlaybackDetected,
    AEC_LEVEL_3_LOCAL_DEVICE_CANDIDATE: level3,
    PHASES_COMPLETED_COUNT: phaseState.completed.length,
    CLEANUP_COMPLETED: 'UNKNOWN',
    FAILURE_CODE: failureCode || 'none',
  }
}

async function cleanup() {
  phaseState.current = undefined
  stopLocalPlayback()
  vadManager?.stop()
  vadManager?.dispose()
  vadManager = undefined
  vad = undefined
  if (microphoneStream) {
    for (const track of microphoneStream.getTracks())
      track.stop()
    microphoneStream = undefined
    microphoneTrack = undefined
  }
  if (playbackGain) {
    try {
      playbackGain.disconnect()
    }
    catch { /* already disconnected */ }
    playbackGain = undefined
  }
  if (audioContext && audioContext.state !== 'closed') {
    try {
      await audioContext.close()
    }
    catch { /* cleanup continues */ }
  }
  audioContext = undefined
  elements.cancel.removeEventListener('click', handleCancel)
  window.removeEventListener('keydown', handleKeydown)
  elements.cancel.disabled = true
}

async function finish(status: 'PASS' | 'FAIL' | 'CANCELLED', failureCode?: string) {
  if (phaseState.finished)
    return
  phaseState.finished = true
  phaseState.cancelled = status === 'CANCELLED'
  abortWaiters()
  await cleanup()
  const report = buildReport(status, failureCode)
  report.CLEANUP_COMPLETED = 'YES'
  console.info(`${REPORT_MARKER}${JSON.stringify(report)}`)
  elements.phase.textContent = status === 'PASS' ? 'Smoke complete' : status === 'CANCELLED' ? 'Smoke cancelled' : 'Smoke failed'
  elements.instruction.textContent = 'A bounded report was sent to the terminal. You may close this window.'
  elements.countdown.textContent = ''
  updateStatus('Cleanup completed. No microphone track or audio context remains active.')
  elements.cancel.disabled = true
  window.setTimeout(() => window.close(), 250)
}

async function initialize() {
  try {
    updateStatus('PHASE_0: requesting microphone with production-equivalent AEC/NS/AGC constraints.')
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS })
    if (phaseState.finished) {
      await cleanup()
      return
    }
    microphoneTrack = microphoneStream.getAudioTracks()[0]
    if (!microphoneTrack)
      throw new Error('microphone-track-unavailable')
    inspectTrack()
    audioContext = new AudioContext({ sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate, latencyHint: 'interactive' })
    await audioContext.resume()
    if (phaseState.finished) {
      await cleanup()
      return
    }
    playbackGain = audioContext.createGain()
    playbackGain.gain.value = PLAYBACK_GAIN_MAX
    playbackGain.connect(audioContext.destination)

    const vadConfig = resolveProductionVADConfig()
    vad = await createVAD({
      sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
      newBufferSize: 512,
      ...vadConfig,
    })
    vad.on('speech-start', () => recordVadEvent('start'))
    vad.on('speech-end', () => recordVadEvent('end'))
    vad.on('speech-cancel', () => {
      activeSpeech = false
    })
    vadManager = createVADStates(vad, vadWorkletUrl, {
      minChunkSize: 512,
      audioContextOptions: {
        sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
        latencyHint: 'interactive',
      },
    })
    await vadManager.initialize()
    await vadManager.start(microphoneStream)
    if (phaseState.finished) {
      await cleanup()
      return
    }
    vadRuntimeReady = true
    elements.phase.textContent = 'PHASE_0 — track inspection complete'
    elements.instruction.textContent = 'The four local observation phases will now run with a countdown before each window.'
    updateStatus('AIRI production VAD ready. No cloud or AIRI provider path is active.')
    for (const definition of phaseDefinitions) {
      if (!await runPhase(definition))
        return
    }
    await finish('PASS')
  }
  catch (error) {
    const failureCode = error instanceof Error && /^[\w-]+$/.test(error.message) ? error.message : 'local-initialization-failed'
    await finish('FAIL', failureCode)
  }
}

function handleCancel() {
  void finish('CANCELLED', 'owner-cancel')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape')
    void finish('CANCELLED', 'owner-cancel')
}

elements.cancel.addEventListener('click', handleCancel)
window.addEventListener('keydown', handleKeydown)
void initialize()
