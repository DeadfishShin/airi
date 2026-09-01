import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { argv, env, pid, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

// eslint-disable-next-line no-restricted-syntax
import {
  isAllowedLocalResource,
  LOCAL_DUPLEX_SMOKE_MICROPHONE_CONSTRAINTS,
  LOCAL_DUPLEX_SMOKE_VAD_DEFAULTS,
  serializeLocalDuplexReport,
  stripCredentialEnvironment,
} from './local-duplex-aec-vad-smoke-logic.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const VAD_DIST_DIRECTORY = resolve(SCRIPT_DIRECTORY, '../../../packages/stage-ui/node_modules/@ricky0123/vad-web/dist')
const PNPM_DIRECTORY = resolve(SCRIPT_DIRECTORY, '../../../node_modules/.pnpm')
const ORT_DIST_DIRECTORY = resolve(PNPM_DIRECTORY, findDependencyDirectory('onnxruntime-web@'), 'node_modules/onnxruntime-web/dist')
const REPORT_MARKER = 'LOCAL_DUPLEX_AEC_VAD_REPORT_JSON:'

function findDependencyDirectory(prefix) {
  const dependencyDirectory = readdirSync(PNPM_DIRECTORY).find(name => name.startsWith(prefix))
  if (!dependencyDirectory)
    throw new Error(`dependency-${prefix.replaceAll('@', '').replaceAll('+', '-')}-unavailable`)
  return dependencyDirectory
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.onnx'))
    return 'application/octet-stream'
  if (filePath.endsWith('.wasm'))
    return 'application/wasm'
  return 'text/plain; charset=utf-8'
}

function escapeScriptContent(source) {
  return source.replaceAll('</script', '<\\/script')
}

function buildRendererHtml() {
  const ortCode = escapeScriptContent(readFileSync(join(ORT_DIST_DIRECTORY, 'ort.min.js'), 'utf8'))
  const vadCode = escapeScriptContent(readFileSync(join(VAD_DIST_DIRECTORY, 'bundle.min.js'), 'utf8'))
  const rendererCode = createRendererCode()

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Duplex AEC/VAD Smoke</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 28px; background: #15171a; color: #f1f3f5; }
    h1 { font-size: 22px; margin: 0 0 10px; }
    p { color: #b9c0c8; line-height: 1.45; }
    #phase { margin: 24px 0 8px; font-size: 20px; font-weight: 650; }
    #instruction { min-height: 48px; }
    #countdown { font-size: 36px; font-variant-numeric: tabular-nums; margin: 12px 0; }
    #status { min-height: 30px; color: #8bd5ca; }
    button { border: 0; border-radius: 8px; padding: 10px 16px; background: #d95f59; color: white; font-weight: 650; cursor: pointer; }
    button:disabled { opacity: .55; cursor: default; }
    .note { font-size: 13px; }
  </style>
</head>
<body>
  <h1>Local duplex / AEC / VAD diagnostic</h1>
  <p class="note">No ASR, TTS, LLM, provider, or chat path is used. Microphone audio stays in the local VAD graph and is never saved or displayed.</p>
  <div id="phase">Preparing PHASE_0</div>
  <div id="instruction">Inspecting local track settings and loading the bundled local VAD asset.</div>
  <div id="countdown"></div>
  <div id="status" aria-live="polite">Starting isolated diagnostic window…</div>
  <button id="cancel" type="button">Cancel smoke</button>
  <script>${ortCode}</script>
  <script>${vadCode}</script>
  <script>${rendererCode}</script>
</body>
</html>`
}

function createRendererCode() {
  const microphoneConstraints = JSON.stringify(LOCAL_DUPLEX_SMOKE_MICROPHONE_CONSTRAINTS)
  const vadDefaults = JSON.stringify(LOCAL_DUPLEX_SMOKE_VAD_DEFAULTS)

  return `(() => {
  'use strict'

  const MIC_CONSTRAINTS = ${microphoneConstraints}
  const VAD_DEFAULTS = ${vadDefaults}
  const PLAYBACK_GAIN_MAX = 0.25
  const phaseDefinitions = [
    ['PHASE_1_QUIET_BASELINE', 'PHASE_1 — quiet baseline', 'Please remain quiet while the microphone baseline is measured.', 3500, false],
    ['PHASE_2_PLAYBACK_ONLY', 'PHASE_2 — playback only', 'A local deterministic assistant-like signal will play. Please remain quiet.', 4500, true],
    ['PHASE_3_USER_SPEECH_CONTROL', 'PHASE_3 — user speech control', 'When the countdown ends, say one short sentence. No audio is saved or transcribed.', 5500, false],
    ['PHASE_4_USER_SPEECH_DURING_PLAYBACK', 'PHASE_4 — user speech during playback', 'When the countdown ends, speak one short sentence while the local signal plays.', 5500, true],
  ]

  const elements = {
    phase: document.getElementById('phase'),
    instruction: document.getElementById('instruction'),
    countdown: document.getElementById('countdown'),
    status: document.getElementById('status'),
    cancel: document.getElementById('cancel'),
  }
  const phaseState = { current: undefined, cancelled: false, finished: false, completed: [] }
  const phaseResults = Object.fromEntries(phaseDefinitions.map(([key]) => [key, { starts: 0, ends: 0, firstStartAt: undefined, startedAt: undefined }]))
  const waiters = new Set()
  let audioContext
  let microphoneStream
  let microphoneTrack
  let micVad
  let playbackGain
  let playbackSource
  let playbackStartCount = 0
  let playbackEndCount = 0
  let trackSnapshot = {}
  let trackInspectionComplete = false
  let vadRuntimeReady = false

  function updateStatus(message) {
    elements.status.textContent = message
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      const waiter = { resolve, timer: setTimeout(() => {
        waiters.delete(waiter)
        resolve()
      }, milliseconds) }
      waiters.add(waiter)
    })
  }

  function abortWaiters() {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
    waiters.clear()
  }

  function safeTrackValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 'UNKNOWN'
  }

  function safeBoolean(value) {
    return typeof value === 'boolean' ? value : undefined
  }

  function trackField(source, field) {
    return source && typeof source === 'object' ? source[field] : undefined
  }

  function readTrackMethod(method) {
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

  function normalizeTrackBoolean(value) {
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

  function level2TrackVerdict(value) {
    return value === true ? 'YES' : value === false ? 'NO' : 'UNKNOWN'
  }

  function normalizeFiniteMetric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : 'UNKNOWN'
  }

  function recordVadEvent(kind) {
    const phase = phaseState.current
    if (!phase || !phaseResults[phase])
      return
    const result = phaseResults[phase]
    if (kind === 'start') {
      result.starts++
      if (result.firstStartAt === undefined)
        result.firstStartAt = performance.now()
    }
    else {
      result.ends++
    }
  }

  function createLocalPlaybackBuffer(durationSeconds) {
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

  function startLocalPlayback(durationSeconds) {
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
    return source
  }

  function stopLocalPlayback() {
    const source = playbackSource
    playbackSource = undefined
    if (!source)
      return
    try { source.stop() }
    catch { /* already ended */ }
    try { source.disconnect() }
    catch { /* already disconnected */ }
  }

  async function countdown(phase, instruction) {
    elements.phase.textContent = phase
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

  async function runPhase([key, label, instruction, durationMs, withPlayback]) {
    if (!await countdown(label, instruction))
      return false
    phaseState.current = key
    phaseResults[key].startedAt = performance.now()
    updateStatus('Observation window running. Only VAD event counts are collected.')
    if (withPlayback)
      startLocalPlayback(Math.min(3.8, Math.max(1.5, durationMs / 1000 - 0.3)))
    await wait(durationMs)
    stopLocalPlayback()
    phaseState.current = undefined
    phaseState.completed.push(key)
    elements.countdown.textContent = 'END'
    updateStatus('Phase complete. Preparing the next bounded observation window.')
    await wait(350)
    return !phaseState.cancelled
  }

  function phaseMetric(key, field) {
    const result = phaseResults[key]
    return result ? result[field] : undefined
  }

  function phaseLatency(key) {
    const result = phaseResults[key]
    if (!result || result.firstStartAt === undefined || result.startedAt === undefined)
      return 'UNKNOWN'
    return normalizeFiniteMetric(result.firstStartAt - result.startedAt)
  }

  function detected(key) {
    return phaseMetric(key, 'starts') > 0 ? 'YES' : 'NO'
  }

  function buildReport(status, failureCode) {
    const playbackOnlyFalseTrigger = phaseMetric('PHASE_2_PLAYBACK_ONLY', 'starts') > 0 ? 'YES' : 'NO'
    const userOnlyDetected = detected('PHASE_3_USER_SPEECH_CONTROL')
    const userDuringPlaybackDetected = detected('PHASE_4_USER_SPEECH_DURING_PLAYBACK')
    const level2 = trackSnapshot.AEC_LEVEL_2_PASS
    const level3 = [level2, playbackOnlyFalseTrigger, userOnlyDetected, userDuringPlaybackDetected].includes('UNKNOWN')
      || [level2, playbackOnlyFalseTrigger, userOnlyDetected, userDuringPlaybackDetected].includes('INCONCLUSIVE')
      ? 'INCONCLUSIVE'
      : level2 === 'YES' && playbackOnlyFalseTrigger === 'NO' && userOnlyDetected === 'YES' && userDuringPlaybackDetected === 'YES' ? 'PASS' : 'FAIL'

    return {
      SMOKE_STATUS: status,
      HARNESS_READY: status === 'PASS' ? 'YES' : 'UNKNOWN',
      VAD_RUNTIME: vadRuntimeReady ? 'READY' : 'UNAVAILABLE',
      PHASE_0_TRACK_INSPECTION: trackInspectionComplete ? 'YES' : 'UNKNOWN',
      ...trackSnapshot,
      VAD_THRESHOLD: VAD_DEFAULTS.threshold,
      VAD_MIN_SILENCE_DURATION_MS: VAD_DEFAULTS.minSilenceDurationMs,
      VAD_SPEECH_PAD_MS: VAD_DEFAULTS.speechPadMs,
      VAD_MIN_SPEECH_DURATION_MS: VAD_DEFAULTS.minSpeechDurationMs,
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
    if (micVad) {
      try { await micVad.destroy() }
      catch { /* cleanup continues */ }
      micVad = undefined
    }
    if (microphoneStream) {
      for (const track of microphoneStream.getTracks())
        track.stop()
      microphoneStream = undefined
      microphoneTrack = undefined
    }
    if (playbackGain) {
      try { playbackGain.disconnect() }
      catch { /* already disconnected */ }
      playbackGain = undefined
    }
    if (audioContext && audioContext.state !== 'closed') {
      try { await audioContext.close() }
      catch { /* cleanup continues */ }
    }
    audioContext = undefined
    elements.cancel.removeEventListener('click', handleCancel)
    window.removeEventListener('keydown', handleKeydown)
    elements.cancel.disabled = true
  }

  async function finish(status, failureCode) {
    if (phaseState.finished)
      return
    phaseState.finished = true
    phaseState.cancelled = status === 'CANCELLED'
    abortWaiters()
    await cleanup()
    const report = buildReport(status, failureCode)
    report.CLEANUP_COMPLETED = 'YES'
    console.info('${REPORT_MARKER}' + JSON.stringify(report))
    elements.phase.textContent = status === 'PASS' ? 'Smoke complete' : status === 'CANCELLED' ? 'Smoke cancelled' : 'Smoke failed'
    elements.instruction.textContent = 'A bounded report was sent to the terminal. You may close this window.'
    elements.countdown.textContent = ''
    updateStatus('Cleanup completed. No microphone track or audio context remains active.')
    elements.cancel.disabled = true
    setTimeout(() => window.close(), 250)
  }

  async function initialize() {
    try {
      updateStatus('PHASE_0: requesting microphone with production-equivalent AEC/NS/AGC constraints.')
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      if (phaseState.finished) {
        await cleanup()
        return
      }
      microphoneTrack = microphoneStream.getAudioTracks()[0]
      if (!microphoneTrack)
        throw new Error('microphone-track-unavailable')
      inspectTrack()
      audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
      await audioContext.resume()
      if (phaseState.finished) {
        await cleanup()
        return
      }
      playbackGain = audioContext.createGain()
      playbackGain.gain.value = PLAYBACK_GAIN_MAX
      playbackGain.connect(audioContext.destination)
      const vadAssetError = !window.vad || !window.vad.MicVAD ? 'local-vad-runtime-unavailable' : undefined
      if (vadAssetError)
        throw new Error(vadAssetError)
      micVad = await window.vad.MicVAD.new({
        model: 'v5',
        processorType: 'ScriptProcessor',
        startOnLoad: false,
        audioContext,
        baseAssetPath: '/vad/',
        onnxWASMBasePath: '/ort/',
        positiveSpeechThreshold: VAD_DEFAULTS.threshold,
        negativeSpeechThreshold: VAD_DEFAULTS.threshold * 0.3,
        redemptionMs: VAD_DEFAULTS.minSilenceDurationMs,
        preSpeechPadMs: VAD_DEFAULTS.speechPadMs,
        minSpeechMs: VAD_DEFAULTS.minSpeechDurationMs,
        submitUserSpeechOnPause: false,
        getStream: async () => microphoneStream,
        pauseStream: async () => {},
        resumeStream: async () => microphoneStream,
        ortConfig: (ort) => {
          ort.env.logLevel = 'error'
          ort.env.wasm.wasmPaths = '/ort/'
        },
        onSpeechStart: () => recordVadEvent('start'),
        onSpeechEnd: () => recordVadEvent('end'),
        onVADMisfire: () => {},
        onSpeechRealStart: () => {},
        onFrameProcessed: () => {},
      })
      if (phaseState.finished) {
        await cleanup()
        return
      }
      await micVad.start()
      if (phaseState.finished) {
        await cleanup()
        return
      }
      vadRuntimeReady = true
      elements.phase.textContent = 'PHASE_0 — track inspection complete'
      elements.instruction.textContent = 'The four local observation phases will now run with a countdown before each window.'
      updateStatus('Local VAD ready. No cloud or AIRI provider path is active.')
      for (const definition of phaseDefinitions) {
        if (!await runPhase(definition))
          return
      }
      await finish('PASS')
    }
    catch (error) {
      const failureCode = error instanceof Error && /^[A-Za-z0-9_-]+$/.test(error.message) ? error.message : 'local-initialization-failed'
      await finish('FAIL', failureCode)
    }
  }

  function handleCancel() {
    void finish('CANCELLED', 'owner-cancel')
  }

  function handleKeydown(event) {
    if (event.key === 'Escape')
      void finish('CANCELLED', 'owner-cancel')
  }

  elements.cancel.addEventListener('click', handleCancel)
  window.addEventListener('keydown', handleKeydown)
  void initialize()
})()`
}

function findWasmFiles() {
  return readdirSync(ORT_DIST_DIRECTORY)
    .filter(name => name.startsWith('ort-wasm') && name.endsWith('.wasm'))
    .map(name => [name, join(ORT_DIST_DIRECTORY, name)])
}

function createLocalServer(html) {
  const files = new Map([
    ['/vad/silero_vad_v5.onnx', join(VAD_DIST_DIRECTORY, 'silero_vad_v5.onnx')],
    ...findWasmFiles().map(([name, filePath]) => [`/ort/${name}`, filePath]),
  ])

  return createServer((request, response) => {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (requestPath === '/') {
      const body = Buffer.from(html)
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.byteLength, 'cache-control': 'no-store' })
      response.end(body)
      return
    }

    const filePath = files.get(requestPath)
    if (!filePath) {
      response.writeHead(404)
      response.end()
      return
    }

    const body = readFileSync(filePath)
    response.writeHead(200, { 'content-type': contentTypeFor(filePath), 'content-length': body.byteLength, 'cache-control': 'no-store' })
    response.end(body)
  })
}

async function runElectron() {
  const credentialEnvStripped = stripCredentialEnvironment(env)
  const html = buildRendererHtml()
  const server = createLocalServer(html)
  let window
  let reportReceived = false
  let externalNetworkRequestCount = 0

  await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('loopback-server-unavailable')

  try {
    const { app, BrowserWindow, session } = await import('electron')
    await app.whenReady()
    const partition = `smoke-local-duplex-${pid}`
    const smokeSession = session.fromPartition(partition)
    smokeSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (isAllowedLocalResource(details.url)) {
        callback({})
        return
      }
      externalNetworkRequestCount++
      callback({ cancel: true })
    })

    window = new BrowserWindow({
      width: 820,
      height: 640,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        sandbox: true,
      },
    })
    smokeSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(webContents === window?.webContents && permission === 'media')
    })
    window.webContents.on('console-message', (_event, _level, message) => {
      if (!message.startsWith(REPORT_MARKER))
        return
      try {
        const report = JSON.parse(message.slice(REPORT_MARKER.length))
        reportReceived = true
        if (externalNetworkRequestCount > 0 || !credentialEnvStripped) {
          report.SMOKE_STATUS = 'FAIL'
          report.HARNESS_READY = 'UNKNOWN'
          report.FAILURE_CODE = externalNetworkRequestCount > 0 ? 'external-network-blocked' : 'credential-strip-failed'
        }
        let output = serializeLocalDuplexReport(report)
        output = output.replace('<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>', [
          `CREDENTIAL_ENV_STRIPPED=${credentialEnvStripped ? 'YES' : 'NO'}`,
          `EXTERNAL_NETWORK_REQUEST_COUNT=${externalNetworkRequestCount}`,
          '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
        ].join('\n'))
        stdout.write(`${output}\n`)
        setTimeout(() => window?.close(), 50)
      }
      catch {
        stdout.write('SMOKE_REPORT_PARSE_ERROR=YES\n')
      }
    })
    window.on('closed', () => {
      if (!reportReceived) {
        let output = serializeLocalDuplexReport({
          SMOKE_STATUS: 'FAIL',
          HARNESS_READY: 'UNKNOWN',
          FAILURE_CODE: 'renderer-no-report',
          CLEANUP_COMPLETED: 'UNKNOWN',
        })
        output = output.replace('<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>', [
          `CREDENTIAL_ENV_STRIPPED=${credentialEnvStripped ? 'YES' : 'NO'}`,
          `EXTERNAL_NETWORK_REQUEST_COUNT=${externalNetworkRequestCount}`,
          '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
        ].join('\n'))
        stdout.write(`${output}\n`)
      }
      app.quit()
    })
    await window.loadURL(`http://127.0.0.1:${address.port}/`)
    await new Promise(resolveWindow => window?.once('closed', resolveWindow))
  }
  finally {
    server.close()
  }
}

function runDryRun() {
  const credentialEnvStripped = stripCredentialEnvironment({ ...env })
  stdout.write([
    '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    'SMOKE_STATUS=DRY_RUN',
    'HARNESS_READY=YES',
    `CREDENTIAL_ENV_STRIPPED=${credentialEnvStripped ? 'YES' : 'NO'}`,
    'EXTERNAL_NETWORK_REQUEST_COUNT=0',
    'REAL_TOKEN_PLAN_API_CALL_COUNT=0',
    'REAL_PAYG_API_CALL_COUNT=0',
    'REAL_LLM_API_CALL_COUNT=0',
    '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    '\n',
  ].join('\n'))
}

if (argv.includes('--dry-run'))
  runDryRun()
else
  await runElectron()
