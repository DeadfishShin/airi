export const LOCAL_DUPLEX_SMOKE_PHASES = Object.freeze([
  'PHASE_0_TRACK_INSPECTION',
  'PHASE_1_QUIET_BASELINE',
  'PHASE_2_PLAYBACK_ONLY',
  'PHASE_3_USER_SPEECH_CONTROL',
  'PHASE_4_USER_SPEECH_DURING_PLAYBACK',
])

export const LOCAL_DUPLEX_SMOKE_CREDENTIAL_NAMES = Object.freeze([
  'TOKEN_PLAN_API_KEY',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_WORKSPACE_ID',
  'DASHSCOPE_REGION',
])

export function stripCredentialEnvironment(environment) {
  for (const name of LOCAL_DUPLEX_SMOKE_CREDENTIAL_NAMES)
    delete environment[name]

  return LOCAL_DUPLEX_SMOKE_CREDENTIAL_NAMES.every(name => !(name in environment) || environment[name] === undefined)
}

export function isAllowedLocalResource(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  }
  catch {
    return false
  }

  if (['file:', 'data:', 'blob:', 'about:', 'devtools:'].includes(url.protocol))
    return true

  if (!['http:', 'https:'].includes(url.protocol))
    return false

  return url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '::1'
}

export function normalizeTrackBoolean(value) {
  if (typeof value === 'boolean')
    return value ? 'YES' : 'NO'

  if (Array.isArray(value) && value.every(item => typeof item === 'boolean')) {
    if (value.includes(true))
      return 'YES'
    if (value.length > 0)
      return 'NO'
  }

  return 'UNKNOWN'
}

export function level2TrackVerdict(value) {
  return value === true ? 'YES' : value === false ? 'NO' : 'UNKNOWN'
}

export function classifyPlaybackOnlyFalseTrigger({ credibleSpeechStartCount, observationWindowComplete = true, environmentInterpretable = true }) {
  if (!observationWindowComplete || !environmentInterpretable)
    return 'INCONCLUSIVE'

  return credibleSpeechStartCount > 0 ? 'YES' : 'NO'
}

export function classifyVadPipelineDiagnosis({
  probabilitySampleCount,
  aboveSpeechThresholdCount,
  speechStartCount,
  observed = true,
}) {
  if (!observed)
    return 'NOT_OBSERVED'
  if (probabilitySampleCount === 0)
    return 'NO_VAD_FRAMES'
  if (speechStartCount > 0)
    return 'USER_SPEECH_DETECTED'
  if (aboveSpeechThresholdCount > 0)
    return 'PROBABILITY_ABOVE_THRESHOLD_BUT_NO_SPEECH_START'
  return 'VAD_FRAMES_PRESENT_BUT_LOW_PROBABILITY'
}

export function classifyLevel3CandidateVerdict({
  level2,
  productionElectronLevel2Evidence,
  playbackOnlyFalseTrigger,
  userOnlyDetected,
  userDuringPlaybackDetected,
  productionVadAlignment = 'UNKNOWN',
  phaseIsolation = 'UNKNOWN',
  environmentInterpretable = 'UNKNOWN',
  playbackProfile = 'UNKNOWN',
  cleanupCompleted = 'UNKNOWN',
  externalNetworkRequestCount = undefined,
}) {
  const normalizedProductionElectronLevel2Evidence = productionElectronLevel2Evidence === 'PASS'
    ? 'YES'
    : productionElectronLevel2Evidence
  const requiredFlags = [
    level2,
    ...(normalizedProductionElectronLevel2Evidence === undefined ? [] : [normalizedProductionElectronLevel2Evidence]),
    playbackOnlyFalseTrigger,
    userOnlyDetected,
    userDuringPlaybackDetected,
    productionVadAlignment,
    phaseIsolation,
    environmentInterpretable,
    cleanupCompleted,
  ]
  if (requiredFlags.some(value => value === 'INCONCLUSIVE' || value === 'UNKNOWN'))
    return 'INCONCLUSIVE'

  if (requiredFlags.every(value => value === 'YES' || value === 'NO') && externalNetworkRequestCount === 0 && playbackProfile === 'macos-local-speech') {
    return level2 === 'YES'
      && playbackOnlyFalseTrigger === 'NO'
      && userOnlyDetected === 'YES'
      && userDuringPlaybackDetected === 'YES'
      && productionVadAlignment === 'YES'
      && phaseIsolation === 'YES'
      && environmentInterpretable === 'YES'
      && cleanupCompleted === 'YES'
      ? 'PASS'
      : 'FAIL'
  }

  return 'INCONCLUSIVE'
}

// Renderer-local callers retain the legacy name, but share the host classifier
// implementation. The renderer intentionally omits host-only network authority.
export function classifyLevel3LocalDeviceVerdict(input) {
  return classifyLevel3CandidateVerdict(input)
}

export function normalizeFiniteMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : 'UNKNOWN'
}

export function createPhaseState() {
  return {
    current: undefined,
    completed: [],
    cancelled: false,
  }
}

export function startPhase(state, phase) {
  if (state.cancelled || !LOCAL_DUPLEX_SMOKE_PHASES.includes(phase))
    return false

  state.current = phase
  return true
}

export function completePhase(state, phase) {
  if (state.current !== phase || state.cancelled)
    return false

  state.completed.push(phase)
  state.current = undefined
  return true
}

export function cancelPhaseState(state) {
  state.cancelled = true
  state.current = undefined
}

export function classifyPhaseQuiescence({ activeSpeech, cancelled }) {
  if (cancelled)
    return 'CANCELLED'
  if (activeSpeech)
    return 'TIMEOUT'
  return 'PASS'
}

const safeInitializationStages = new Set([
  'WAITING_FOR_USER_START',
  'AUDIO_CONTEXT_CREATED',
  'AUDIO_CONTEXT_RESUMED',
  'MICROPHONE_REQUESTING',
  'MICROPHONE_READY',
  'TRACK_INSPECTION_COMPLETE',
  'PRODUCTION_VAD_LOADING',
  'PRODUCTION_VAD_READY',
  'PHASE_1_READY',
])

const safeInitializationFailureStages = new Set(['none', ...safeInitializationStages])
const safeAudioContextStates = new Set(['suspended', 'running', 'closed', 'interrupted', 'UNKNOWN'])
const safeAudioContextResumeResults = new Set(['PASS', 'FAIL', 'TIMEOUT', 'UNKNOWN'])
const safePhaseTransitionStatuses = new Set(['IDLE', 'WAITING_FOR_VAD_QUIESCENCE', 'READY_FOR_NEXT_PHASE', 'FAILED', 'CANCELLED'])
const safePhaseQuiescenceResults = new Set(['NOT_STARTED', 'PASS', 'TIMEOUT', 'CANCELLED'])
const safePhaseTransitionPhases = new Set([...LOCAL_DUPLEX_SMOKE_PHASES, 'COMPLETE', 'UNKNOWN'])
const safeVadPipelineDiagnoses = new Set([
  'NOT_OBSERVED',
  'NO_VAD_FRAMES',
  'VAD_FRAMES_PRESENT_BUT_LOW_PROBABILITY',
  'PROBABILITY_ABOVE_THRESHOLD_BUT_NO_SPEECH_START',
  'USER_SPEECH_DETECTED',
])

function safeReportValue(field, value) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'UNKNOWN'
  if (typeof value === 'boolean')
    return value ? 'YES' : 'NO'
  if (field === 'PRODUCTION_VAD_MODEL_ID')
    return typeof value === 'string' && /^[A-Z0-9][\w.-]{0,63}\/[A-Z0-9][\w.-]{0,63}$/i.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_PROTOCOL')
    return typeof value === 'string' && /^(?:http|https):$/.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_HOST')
    return typeof value === 'string' && /^[a-z0-9.:[\]-]{1,128}$/i.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_CLASS')
    return typeof value === 'string' && /^(?:external-model-resource|external-onnx-wasm|external-renderer-resource|external-resource)$/.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_RESOURCE_TYPE')
    return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/i.test(value) ? value : 'UNKNOWN'
  if (field === 'INITIALIZATION_STAGE') {
    if (typeof value === 'string' && safeInitializationStages.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'INITIALIZATION_FAILURE_STAGE') {
    if (typeof value === 'string' && safeInitializationFailureStages.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'AUDIO_CONTEXT_STATE_AFTER_CREATE' || field === 'AUDIO_CONTEXT_STATE_AFTER_RESUME') {
    if (typeof value === 'string' && safeAudioContextStates.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'AUDIO_CONTEXT_RESUME_RESULT') {
    if (typeof value === 'string' && safeAudioContextResumeResults.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'PHASE_TRANSITION_STATUS') {
    if (typeof value === 'string' && safePhaseTransitionStatuses.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'PHASE_TRANSITION_FROM' || field === 'PHASE_TRANSITION_TO') {
    if (typeof value === 'string' && safePhaseTransitionPhases.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field === 'VAD_QUIESCENCE_RESULT') {
    if (typeof value === 'string' && safePhaseQuiescenceResults.has(value))
      return value
    return 'UNKNOWN'
  }
  if (field.endsWith('_VAD_PIPELINE_DIAGNOSIS')) {
    if (typeof value === 'string' && safeVadPipelineDiagnoses.has(value))
      return value
    return 'UNKNOWN'
  }
  if (typeof value === 'string' && /^[\w.:+-]+$/.test(value))
    return value
  return 'UNKNOWN'
}

export function serializeLocalDuplexReport(report) {
  const fieldOrder = [
    'SMOKE_STATUS',
    'HARNESS_READY',
    'HOST_RUNTIME',
    'DIAGNOSTIC_MODE',
    'CHROMIUM_HOST',
    'LOCAL_SERVER_BIND_ADDRESS',
    'LOCAL_SERVER_EXTERNAL_BIND',
    'CSP_ENABLED',
    'CSP_EXTERNAL_CONNECT_ALLOWED',
    'EXTERNAL_ASSET_REFERENCE_COUNT',
    'LOCAL_ASSET_REQUEST_COUNT',
    'LOCAL_MODEL_ASSET_REQUEST_COUNT',
    'LOCAL_WASM_ASSET_REQUEST_COUNT',
    'LOCAL_RENDERER_ASSET_REQUEST_COUNT',
    'LOCAL_SPEECH_ASSET_REQUEST_COUNT',
    'CREDENTIAL_ENV_STRIPPED',
    'PRODUCTION_ELECTRON_LEVEL2_EVIDENCE',
    'EXACT_ELECTRON_LEVEL3_EXECUTED',
    'OWNER_LEVEL3_AUTHORITY',
    'LEVEL3_VERDICT_AUTHORITY',
    'RENDERER_LEVEL3_VERDICT',
    'MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE',
    'EXTERNAL_NETWORK_REQUEST_COUNT',
    'VAD_RUNTIME',
    'PRODUCTION_VAD_ALIGNMENT',
    'PRODUCTION_VAD_MODEL_ID',
    'PRODUCTION_VAD_MODEL_REVISION',
    'PRODUCTION_VAD_MODEL_DTYPE',
    'PRODUCTION_VAD_BROWSER_INIT',
    'PRODUCTION_VAD_SYNTHETIC_INFERENCE',
    'PRODUCTION_VAD_WASM_FETCH',
    'PRODUCTION_VAD_WASM_COMPILE',
    'PRODUCTION_VAD_WASM_VALIDATE',
    'ONNX_WASM_RESOLUTION',
    'CROSS_ORIGIN_ISOLATED',
    'PRODUCTION_VAD_ASSET',
    'PRODUCTION_VAD_AUDIO_PATH',
    'PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED',
    'MEDIA_REQUESTED',
    'READY_FOR_OWNER_PHASE0',
    'ENVIRONMENT_INTERPRETABLE',
    'PHASE_ISOLATION',
    'PHASE_0_TRACK_INSPECTION',
    'INITIALIZATION_STAGE',
    'INITIALIZATION_FAILURE_STAGE',
    'AUDIO_CONTEXT_STATE_AFTER_CREATE',
    'AUDIO_CONTEXT_STATE_AFTER_RESUME',
    'AUDIO_CONTEXT_RESUME_RESULT',
    'AUDIO_CONTEXT_RESUME_TIMEOUT_MS',
    'MICROPHONE_REQUEST_TIMEOUT_MS',
    'PRODUCTION_VAD_INIT_TIMEOUT_MS',
    'TRACK_CONSTRAINTS_SUPPORTED',
    'TRACK_CAPABILITIES_SUPPORTED',
    'TRACK_SETTINGS_SUPPORTED',
    'AEC_REQUESTED',
    'AEC_CAPABILITY',
    'AEC_SETTING',
    'AEC_LEVEL_2_PASS',
    'NS_REQUESTED',
    'NS_CAPABILITY',
    'NS_SETTING',
    'NS_LEVEL_2_PASS',
    'AGC_REQUESTED',
    'AGC_CAPABILITY',
    'AGC_SETTING',
    'AGC_LEVEL_2_PASS',
    'MIC_SAMPLE_RATE',
    'MIC_CHANNEL_COUNT',
    'VAD_THRESHOLD',
    'VAD_EXIT_THRESHOLD',
    'VAD_MIN_SILENCE_DURATION_MS',
    'VAD_SPEECH_PAD_MS',
    'VAD_MIN_SPEECH_DURATION_MS',
    'VAD_SAMPLE_RATE',
    'PHASE_SETTLE_MS',
    'PHASE_SETTLE_TIMEOUT_MS',
    'PHASE_TRANSITION_STATUS',
    'PHASE_TRANSITION_FROM',
    'PHASE_TRANSITION_TO',
    'VAD_ACTIVE_AT_TRANSITION_START',
    'VAD_QUIESCENCE_WAIT_MS',
    'VAD_QUIESCENCE_RESULT',
    'VAD_LATE_SPEECH_END_COUNT',
    'VAD_RESET_API_AVAILABLE',
    'VAD_RESET_API_USED',
    'PLAYBACK_PROFILE',
    'PLAYBACK_SOURCE',
    'PLAYBACK_VOICE',
    'PLAYBACK_RATE',
    'PLAYBACK_DURATION_MS',
    'PLAYBACK_LOCAL_ASSET',
    'PLAYBACK_DECODE',
    'PLAYBACK_GRAPH',
    'PLAYBACK_GAIN_MAX',
    'PLAYBACK_SOURCE_NORMALIZED_PEAK',
    'PLAYBACK_START_COUNT',
    'PLAYBACK_END_COUNT',
    'QUIET_VAD_START_COUNT',
    'QUIET_VAD_END_COUNT',
    'PLAYBACK_ONLY_VAD_START_COUNT',
    'PLAYBACK_ONLY_VAD_END_COUNT',
    'USER_ONLY_VAD_START_COUNT',
    'USER_ONLY_VAD_END_COUNT',
    'USER_ONLY_FIRST_ACTIVITY_LATENCY_MS',
    'QUIET_VAD_DEBUG_EVENT_COUNT',
    'QUIET_VAD_PROBABILITY_SAMPLE_COUNT',
    'QUIET_VAD_MAX_PROBABILITY',
    'QUIET_VAD_MEAN_PROBABILITY',
    'QUIET_VAD_ABOVE_THRESHOLD_COUNT',
    'QUIET_VAD_ABOVE_EXIT_THRESHOLD_COUNT',
    'USER_DURING_PLAYBACK_VAD_START_COUNT',
    'USER_DURING_PLAYBACK_VAD_END_COUNT',
    'USER_DURING_PLAYBACK_FIRST_ACTIVITY_LATENCY_MS',
    'PLAYBACK_ONLY_VAD_DEBUG_EVENT_COUNT',
    'PLAYBACK_ONLY_VAD_PROBABILITY_SAMPLE_COUNT',
    'PLAYBACK_ONLY_VAD_MAX_PROBABILITY',
    'PLAYBACK_ONLY_VAD_MEAN_PROBABILITY',
    'PLAYBACK_ONLY_VAD_ABOVE_THRESHOLD_COUNT',
    'PLAYBACK_ONLY_VAD_ABOVE_EXIT_THRESHOLD_COUNT',
    'USER_ONLY_VAD_DEBUG_EVENT_COUNT',
    'USER_ONLY_VAD_PROBABILITY_SAMPLE_COUNT',
    'USER_ONLY_VAD_MAX_PROBABILITY',
    'USER_ONLY_VAD_MEAN_PROBABILITY',
    'USER_ONLY_VAD_ABOVE_THRESHOLD_COUNT',
    'USER_ONLY_VAD_ABOVE_EXIT_THRESHOLD_COUNT',
    'USER_ONLY_VAD_PIPELINE_DIAGNOSIS',
    'USER_ONLY_VAD_ACTIVE_AT_PHASE_END',
    'USER_ONLY_VAD_LATE_END_AFTER_PHASE_COUNT',
    'USER_DURING_PLAYBACK_VAD_DEBUG_EVENT_COUNT',
    'USER_DURING_PLAYBACK_VAD_PROBABILITY_SAMPLE_COUNT',
    'USER_DURING_PLAYBACK_VAD_MAX_PROBABILITY',
    'USER_DURING_PLAYBACK_VAD_MEAN_PROBABILITY',
    'USER_DURING_PLAYBACK_VAD_ABOVE_THRESHOLD_COUNT',
    'USER_DURING_PLAYBACK_VAD_ABOVE_EXIT_THRESHOLD_COUNT',
    'USER_DURING_PLAYBACK_VAD_PIPELINE_DIAGNOSIS',
    'USER_DURING_PLAYBACK_VAD_ACTIVE_AT_PHASE_END',
    'USER_DURING_PLAYBACK_VAD_LATE_END_AFTER_PHASE_COUNT',
    'PLAYBACK_ONLY_FALSE_TRIGGER',
    'USER_ONLY_DETECTED',
    'USER_DURING_PLAYBACK_DETECTED',
    'AEC_LEVEL_3_LOCAL_DEVICE_CANDIDATE',
    'PHASES_COMPLETED_COUNT',
    'CLEANUP_COMPLETED',
    'RENDERER_FAILURE_CODE',
    'NETWORK_GUARD_FAILURE',
    'BLOCKED_REQUEST_COUNT',
    'BLOCKED_REQUEST_CLASS',
    'BLOCKED_REQUEST_PROTOCOL',
    'BLOCKED_REQUEST_HOST',
    'BLOCKED_REQUEST_RESOURCE_TYPE',
    'FAILURE_CODE',
  ]

  const lines = [
    '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    ...fieldOrder
      .filter(field => field in report)
      .map(field => `${field}=${safeReportValue(field, report[field])}`),
    '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
  ]

  return lines.join('\n')
}
