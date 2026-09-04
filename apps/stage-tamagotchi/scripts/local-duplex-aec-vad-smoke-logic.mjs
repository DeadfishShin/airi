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

export function classifyLevel3LocalDeviceVerdict({
  level2,
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
  const requiredFlags = [
    level2,
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
  if (typeof value === 'string' && /^[\w.:+-]+$/.test(value))
    return value
  return 'UNKNOWN'
}

export function serializeLocalDuplexReport(report) {
  const fieldOrder = [
    'SMOKE_STATUS',
    'HARNESS_READY',
    'VAD_RUNTIME',
    'PRODUCTION_VAD_ALIGNMENT',
    'PRODUCTION_VAD_MODEL_ID',
    'PRODUCTION_VAD_MODEL_REVISION',
    'PRODUCTION_VAD_MODEL_DTYPE',
    'PRODUCTION_VAD_BROWSER_INIT',
    'PRODUCTION_VAD_SYNTHETIC_INFERENCE',
    'ONNX_WASM_RESOLUTION',
    'PRODUCTION_VAD_ASSET',
    'PRODUCTION_VAD_AUDIO_PATH',
    'PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED',
    'ENVIRONMENT_INTERPRETABLE',
    'PHASE_ISOLATION',
    'PHASE_0_TRACK_INSPECTION',
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
    'PLAYBACK_PROFILE',
    'PLAYBACK_GAIN_MAX',
    'PLAYBACK_START_COUNT',
    'PLAYBACK_END_COUNT',
    'QUIET_VAD_START_COUNT',
    'QUIET_VAD_END_COUNT',
    'PLAYBACK_ONLY_VAD_START_COUNT',
    'PLAYBACK_ONLY_VAD_END_COUNT',
    'USER_ONLY_VAD_START_COUNT',
    'USER_ONLY_VAD_END_COUNT',
    'USER_ONLY_FIRST_ACTIVITY_LATENCY_MS',
    'USER_DURING_PLAYBACK_VAD_START_COUNT',
    'USER_DURING_PLAYBACK_VAD_END_COUNT',
    'USER_DURING_PLAYBACK_FIRST_ACTIVITY_LATENCY_MS',
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
