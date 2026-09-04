import process, { argv, env, stdout } from 'node:process'

import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

// eslint-disable-next-line no-restricted-syntax
import {
  serializeLocalDuplexReport,
  stripCredentialEnvironment,
} from './local-duplex-aec-vad-smoke-logic.mjs'
// eslint-disable-next-line no-restricted-syntax
import {
  CHROMIUM_CSP,
  CHROMIUM_HOST_RUNTIME,
  countExternalAssetReferences,
  discoverSystemChromium,
  isLoopbackAddress,
  LOCAL_SERVER_BIND_ADDRESS,
  LOCAL_SPEECH_PLAYBACK_PHRASE,
  LOCAL_SPEECH_PLAYBACK_PROFILE,
  LOCAL_SPEECH_PLAYBACK_RATE,
  LOCAL_SPEECH_PLAYBACK_SOURCE,
  LOCAL_SPEECH_PLAYBACK_VOICE,
  PLAYBACK_GAIN_MAX,
} from './local-duplex-chromium-harness-logic.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIRECTORY, '..')
const RENDERER_ROOT = resolve(APP_ROOT, 'out/renderer')
const MODEL_ROOT = resolve(SCRIPT_DIRECTORY, 'assets/production-vad')
const INTERACTIVE_PAGE = '/local-duplex-chromium.html'
const PREFLIGHT_PAGE = '/local-duplex-chromium-boot.html'
const LOCAL_SPEECH_ASSET = '/local-speech.wav'
const MAX_REPORT_BYTES = 128 * 1024
const INTERACTIVE_TIMEOUT_MS = 180000
const execFileAsync = promisify(execFile)

const chromiumCandidates = [
  { name: 'Google-Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  { name: 'Google-Chrome', path: join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome') },
  { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
  { name: 'Chromium', path: join(homedir(), 'Applications/Chromium.app/Contents/MacOS/Chromium') },
]

function contentTypeFor(pathname) {
  if (pathname.endsWith('.html'))
    return 'text/html; charset=utf-8'
  if (pathname.endsWith('.js') || pathname.endsWith('.mjs') || pathname.endsWith('.ts'))
    return 'text/javascript; charset=utf-8'
  if (pathname.endsWith('.css'))
    return 'text/css; charset=utf-8'
  if (pathname.endsWith('.wasm'))
    return 'application/wasm'
  if (pathname.endsWith('.wav'))
    return 'audio/wav'
  if (pathname.endsWith('.onnx'))
    return 'application/octet-stream'
  if (pathname.endsWith('.json'))
    return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function readWavePcmMetadata(filePath) {
  const bytes = readFileSync(filePath)
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('local-speech-wave-invalid')

  let offset = 12
  let sampleRate
  let channels
  let bitsPerSample
  let dataOffset
  let dataSize
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString('ascii', offset, offset + 4)
    const chunkSize = bytes.readUInt32LE(offset + 4)
    const chunkOffset = offset + 8
    if (chunkOffset + chunkSize > bytes.length)
      throw new Error('local-speech-wave-invalid')
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      channels = bytes.readUInt16LE(chunkOffset + 2)
      sampleRate = bytes.readUInt32LE(chunkOffset + 4)
      bitsPerSample = bytes.readUInt16LE(chunkOffset + 14)
    }
    if (chunkId === 'data') {
      dataOffset = chunkOffset
      dataSize = chunkSize
    }
    offset = chunkOffset + chunkSize + (chunkSize % 2)
  }

  if (!sampleRate || !channels || bitsPerSample !== 16 || dataOffset === undefined || dataSize === undefined)
    throw new Error('local-speech-wave-format-unsupported')

  let peak = 0
  for (let index = dataOffset; index + 1 < dataOffset + dataSize; index += 2)
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(index) / 32768))
  if (peak <= 0.1)
    throw new Error('local-speech-wave-too-quiet')

  return {
    durationMs: Math.round(dataSize / (channels * (bitsPerSample / 8) * sampleRate) * 1000),
    normalizedPeak: Math.round(Math.min(1, peak) * 100) / 100,
  }
}

async function generateLocalSpeechAsset(directory) {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/say') || !existsSync('/usr/bin/afconvert'))
    throw new Error('macos-local-speech-unavailable')

  const aiffPath = join(directory, 'local-speech.aiff')
  const wavPath = join(directory, 'local-speech.wav')
  try {
    await execFileAsync('/usr/bin/say', [
      '-v',
      LOCAL_SPEECH_PLAYBACK_VOICE,
      '-r',
      String(LOCAL_SPEECH_PLAYBACK_RATE),
      '-o',
      aiffPath,
      LOCAL_SPEECH_PLAYBACK_PHRASE,
    ], { maxBuffer: 16 * 1024 })
    await execFileAsync('/usr/bin/afconvert', [
      '-f',
      'WAVE',
      '-d',
      'LEI16@24000',
      aiffPath,
      wavPath,
    ], { maxBuffer: 16 * 1024 })
    const metadata = readWavePcmMetadata(wavPath)
    return {
      path: wavPath,
      metadata: {
        PLAYBACK_PROFILE: LOCAL_SPEECH_PLAYBACK_PROFILE,
        PLAYBACK_SOURCE: LOCAL_SPEECH_PLAYBACK_SOURCE,
        PLAYBACK_VOICE: LOCAL_SPEECH_PLAYBACK_VOICE,
        PLAYBACK_RATE: String(LOCAL_SPEECH_PLAYBACK_RATE),
        PLAYBACK_DURATION_MS: String(metadata.durationMs),
        PLAYBACK_LOCAL_ASSET: 'YES',
        PLAYBACK_SOURCE_NORMALIZED_PEAK: String(metadata.normalizedPeak),
        PLAYBACK_GAIN_MAX: String(PLAYBACK_GAIN_MAX),
      },
    }
  }
  catch {
    throw new Error('local-speech-asset-generation-failed')
  }
}

function safeAssetPath(root, pathname) {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(pathname)
  }
  catch {
    return undefined
  }

  const candidate = resolve(root, decodedPath.replace(/^\/+/, ''))
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(rootWithSeparator) ? candidate : undefined
}

function readBoundedBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.byteLength
      if (bytes > MAX_REPORT_BYTES) {
        rejectBody(new Error('report-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectBody)
  })
}

function responseHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-security-policy': CHROMIUM_CSP,
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
  }
}

function requestPath(request) {
  try {
    return new URL(request.url || '/', 'http://127.0.0.1').pathname
  }
  catch {
    return '/invalid-request'
  }
}

function writeFileResponse(response, filePath, pathname) {
  let body
  try {
    body = readFileSync(filePath)
  }
  catch {
    response.writeHead(404, responseHeaders('text/plain; charset=utf-8'))
    response.end()
    return false
  }

  response.writeHead(200, {
    ...responseHeaders(contentTypeFor(pathname)),
    'content-length': body.byteLength,
  })
  response.end(body)
  return true
}

function addHostFields(report, { browser, address, externalAssetReferenceCount, localAssetRequestCount, localModelAssetRequestCount, localWasmAssetRequestCount, localRendererAssetRequestCount, localSpeechAssetRequestCount, externalNetworkRequestCount, credentialEnvStripped, playbackMetadata }) {
  return {
    ...report,
    HOST_RUNTIME: CHROMIUM_HOST_RUNTIME,
    DIAGNOSTIC_MODE: 'YES',
    CHROMIUM_HOST: browser.name,
    LOCAL_SERVER_BIND_ADDRESS,
    LOCAL_SERVER_EXTERNAL_BIND: 'NO',
    CSP_ENABLED: 'YES',
    CSP_EXTERNAL_CONNECT_ALLOWED: 'NO',
    EXTERNAL_ASSET_REFERENCE_COUNT: externalAssetReferenceCount,
    LOCAL_ASSET_REQUEST_COUNT: localAssetRequestCount,
    LOCAL_MODEL_ASSET_REQUEST_COUNT: localModelAssetRequestCount,
    LOCAL_WASM_ASSET_REQUEST_COUNT: localWasmAssetRequestCount,
    LOCAL_RENDERER_ASSET_REQUEST_COUNT: localRendererAssetRequestCount,
    LOCAL_SPEECH_ASSET_REQUEST_COUNT: localSpeechAssetRequestCount,
    EXTERNAL_NETWORK_REQUEST_COUNT: externalNetworkRequestCount,
    CREDENTIAL_ENV_STRIPPED: credentialEnvStripped ? 'YES' : 'NO',
    PRODUCTION_ELECTRON_LEVEL2_EVIDENCE: 'PASS',
    EXACT_ELECTRON_LEVEL3_EXECUTED: 'NO',
    OWNER_LEVEL3_AUTHORITY: 'MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE',
    MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE: report.AEC_LEVEL_3_LOCAL_DEVICE_CANDIDATE,
    NETWORK_GUARD_FAILURE: externalNetworkRequestCount > 0 ? 'YES' : 'NO',
    ...(address ? { LOCAL_SERVER_PORT: address.port } : {}),
    ...(playbackMetadata || {}),
  }
}

function printInteractiveReport(report, context) {
  const augmented = addHostFields(report, context)
  if (context.externalNetworkRequestCount > 0 || !context.credentialEnvStripped) {
    augmented.SMOKE_STATUS = 'FAIL'
    augmented.HARNESS_READY = 'UNKNOWN'
    augmented.FAILURE_CODE = context.externalNetworkRequestCount > 0
      ? 'external-network-blocked'
      : 'credential-strip-failed'
  }
  stdout.write(`${serializeLocalDuplexReport(augmented)}\n`)
}

function printPreflightReport(report, context) {
  const vadReady = report.PRODUCTION_VAD_BROWSER_INIT === 'PASS'
    && report.PRODUCTION_VAD_SYNTHETIC_INFERENCE === 'PASS'
  const playbackReady = report.PLAYBACK_PROFILE === 'macos-local-speech'
    && report.PLAYBACK_DECODE === 'PASS'
    && report.PLAYBACK_GRAPH === 'PASS'
    && context.localSpeechAssetRequestCount > 0
  const passed = vadReady
    && playbackReady
    && context.externalNetworkRequestCount === 0
    && context.credentialEnvStripped
    && context.blockedRequestCount === 0

  const augmented = addHostFields({
    ...report,
    SMOKE_STATUS: passed ? 'PASS' : 'FAIL',
    HARNESS_READY: passed ? 'YES' : 'UNKNOWN',
    PRODUCTION_VAD_ALIGNMENT: vadReady ? 'YES' : 'UNKNOWN',
    PRODUCTION_VAD_ASSET: 'vendored-local-offline',
    PRODUCTION_VAD_AUDIO_PATH: 'AudioWorklet-production',
    MEDIA_REQUESTED: 'NO',
    READY_FOR_OWNER_PHASE0: passed ? 'YES' : 'NO',
    PREFLIGHT_LOCAL_SERVER: 'PASS',
    PREFLIGHT_CHROMIUM_HOST: 'PASS',
    PREFLIGHT_ROOT_HTML: 'PASS',
    PREFLIGHT_RENDERER_GRAPH: 'PASS',
    EXTERNAL_ASSET_REFERENCE_COUNT: context.externalAssetReferenceCount,
    BLOCKED_REQUEST_COUNT: context.blockedRequestCount,
    FAILURE_CODE: passed ? 'none' : report.RENDERER_FAILURE_CODE || 'production-vad-browser-init-failed',
  }, context)

  stdout.write(`CHROMIUM_NO_MEDIA_PREFLIGHT=${passed ? 'PASS' : 'FAIL'}\n`)
  stdout.write(`${serializeLocalDuplexReport(augmented)}\n`)
  return passed
}

function createLocalServer({ interactiveHtml, preflightHtml, localSpeechAssetPath, playbackMetadata }) {
  let localAssetRequestCount = 0
  let externalNetworkRequestCount = 0
  let blockedRequestCount = 0
  const blockedRequestClasses = new Set()
  let localModelAssetRequestCount = 0
  let localWasmAssetRequestCount = 0
  let localRendererAssetRequestCount = 0
  let localSpeechAssetRequestCount = 0
  let lastReport
  let lastReportKind
  let address
  let resolveReport
  let rejectReport

  const reportPromise = new Promise((resolveResult, rejectResult) => {
    resolveReport = resolveResult
    rejectReport = rejectResult
  })

  const server = createServer(async (request, response) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      externalNetworkRequestCount++
      blockedRequestClasses.add('non-loopback-client')
      response.writeHead(403, responseHeaders('text/plain; charset=utf-8'))
      response.end('loopback-only')
      return
    }

    const pathname = requestPath(request)
    if (request.method === 'POST' && (pathname === '/__report' || pathname === '/__boot-report')) {
      try {
        const body = await readBoundedBody(request)
        const report = JSON.parse(body)
        lastReport = report
        lastReportKind = pathname === '/__boot-report' ? 'preflight' : 'interactive'
        response.writeHead(204, responseHeaders('text/plain; charset=utf-8'))
        response.end()
        resolveReport({ report, kind: lastReportKind })
      }
      catch (error) {
        blockedRequestCount++
        response.writeHead(400, responseHeaders('text/plain; charset=utf-8'))
        response.end()
        rejectReport(error)
      }
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, responseHeaders('text/plain; charset=utf-8'))
      response.end()
      return
    }

    if (pathname === '/') {
      localAssetRequestCount++
      const body = Buffer.from(interactiveHtml)
      response.writeHead(200, {
        ...responseHeaders('text/html; charset=utf-8'),
        'content-length': body.byteLength,
      })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    }

    if (pathname === PREFLIGHT_PAGE) {
      localAssetRequestCount++
      const body = Buffer.from(preflightHtml)
      response.writeHead(200, {
        ...responseHeaders('text/html; charset=utf-8'),
        'content-length': body.byteLength,
      })
      response.end(request.method === 'HEAD' ? undefined : body)
      return
    }

    // Chromium may request a favicon for an app page. The diagnostic page does
    // not ship one; answer locally so this browser housekeeping request cannot
    // masquerade as a missing production asset.
    if (pathname === '/favicon.ico') {
      localAssetRequestCount++
      response.writeHead(204, responseHeaders('image/x-icon'))
      response.end()
      return
    }

    if (pathname === LOCAL_SPEECH_ASSET) {
      localAssetRequestCount++
      localSpeechAssetRequestCount++
      writeFileResponse(response, localSpeechAssetPath, pathname)
      return
    }

    let root
    let relativePath
    if (pathname.startsWith('/production-vad/')) {
      root = MODEL_ROOT
      relativePath = pathname.slice('/production-vad/'.length)
    }
    else {
      root = RENDERER_ROOT
      relativePath = pathname.slice(1)
    }

    const filePath = safeAssetPath(root, relativePath)
    if (!filePath || !existsSync(filePath)) {
      blockedRequestCount++
      blockedRequestClasses.add(pathname.startsWith('/production-vad/') ? 'missing-local-model-asset' : 'missing-local-renderer-asset')
      response.writeHead(404, responseHeaders('text/plain; charset=utf-8'))
      response.end()
      return
    }

    localAssetRequestCount++
    if (pathname.startsWith('/production-vad/'))
      localModelAssetRequestCount++
    else if (pathname.endsWith('.wasm'))
      localWasmAssetRequestCount++
    else
      localRendererAssetRequestCount++
    writeFileResponse(response, filePath, pathname)
  })

  server.on('error', error => rejectReport(error))

  return {
    server,
    reportPromise,
    getStats: () => ({
      localAssetRequestCount,
      localModelAssetRequestCount,
      localWasmAssetRequestCount,
      localRendererAssetRequestCount,
      localSpeechAssetRequestCount,
      externalNetworkRequestCount,
      blockedRequestCount,
      blockedRequestClasses: [...blockedRequestClasses],
      lastReport,
      lastReportKind,
      address,
      playbackMetadata,
    }),
    setAddress: (value) => { address = value },
    externalAssetReferenceCount: countExternalAssetReferences(interactiveHtml) + countExternalAssetReferences(preflightHtml),
  }
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, LOCAL_SERVER_BIND_ADDRESS, () => {
      server.off('error', rejectListen)
      resolveListen(server.address())
    })
  })
}

function launchChromium(browser, url, profileDirectory, preflight) {
  const args = [
    ...(preflight ? [url] : [`--app=${url}`]),
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-domain-reliability',
    '--metrics-recording-only',
    '--no-pings',
  ]
  if (preflight)
    args.push('--headless=new')

  return spawn(browser.path, args, {
    cwd: APP_ROOT,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  })
}

async function run() {
  const preflight = argv.includes('--preflight')
  const browser = discoverSystemChromium(chromiumCandidates)
  if (!browser) {
    stdout.write('CHROMIUM_SMOKE_STATUS=FAIL\nFAILURE_CODE=CHROMIUM_HOST_UNAVAILABLE\n')
    process.exitCode = 1
    return
  }

  if (!existsSync(RENDERER_ROOT) || !existsSync(MODEL_ROOT)) {
    stdout.write('CHROMIUM_SMOKE_STATUS=FAIL\nFAILURE_CODE=local-renderer-or-model-assets-unavailable\n')
    process.exitCode = 1
    return
  }

  const credentialEnvironment = { ...env }
  const credentialEnvStripped = stripCredentialEnvironment(credentialEnvironment)
  const interactiveHtml = readFileSync(join(RENDERER_ROOT, INTERACTIVE_PAGE.slice(1)), 'utf8')
  const preflightHtml = readFileSync(join(RENDERER_ROOT, PREFLIGHT_PAGE.slice(1)), 'utf8')
  const profileDirectory = await mkdtemp(join(tmpdir(), 'airi-local-duplex-chromium-'))
  const speechAssetDirectory = await mkdtemp(join(tmpdir(), 'airi-local-duplex-speech-'))
  let localSpeechAsset
  try {
    localSpeechAsset = await generateLocalSpeechAsset(speechAssetDirectory)
  }
  catch (error) {
    await rm(speechAssetDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    stdout.write(`CHROMIUM_${preflight ? 'NO_MEDIA_PREFLIGHT' : 'SMOKE'}=FAIL\nFAILURE_CODE=${errorMessageFrom(error) ?? 'local-speech-asset-generation-failed'}\n`)
    process.exitCode = 1
    return
  }
  const harness = createLocalServer({
    interactiveHtml,
    preflightHtml,
    localSpeechAssetPath: localSpeechAsset.path,
    playbackMetadata: localSpeechAsset.metadata,
  })
  let child
  let timeout
  let settled = false
  let rejectHarness
  const harnessOutcome = Promise.race([
    harness.reportPromise,
    new Promise((_, reject) => { rejectHarness = reject }),
  ])

  const stopChild = () => {
    if (!child)
      return
    try {
      child.kill('SIGTERM')
    }
    catch { /* already exited */ }
    child = undefined
  }

  try {
    const address = await listen(harness.server)
    if (!address || typeof address === 'string' || address.address !== LOCAL_SERVER_BIND_ADDRESS)
      throw new Error('loopback-server-bind-failed')
    harness.setAddress(address)

    const externalAssetReferenceCount = harness.externalAssetReferenceCount
    if (externalAssetReferenceCount !== 0)
      throw new Error('external-asset-reference-detected')

    const url = `http://${LOCAL_SERVER_BIND_ADDRESS}:${address.port}${preflight ? PREFLIGHT_PAGE : '/'}`
    child = launchChromium(browser, url, profileDirectory, preflight)
    child.once('error', (error) => {
      if (!settled)
        rejectHarness(error)
    })
    child.once('close', (code, signal) => {
      if (!settled)
        rejectHarness(new Error(`chromium-exited-${signal || code || 'unknown'}`))
    })

    timeout = setTimeout(() => {
      if (settled)
        return
      settled = true
      stopChild()
      const stats = harness.getStats()
      stdout.write([
        `CHROMIUM_${preflight ? 'NO_MEDIA_PREFLIGHT' : 'SMOKE'}=FAIL`,
        'FAILURE_CODE=chromium-host-timeout',
        `LOCAL_ASSET_REQUEST_COUNT=${stats.localAssetRequestCount}`,
        `EXTERNAL_NETWORK_REQUEST_COUNT=${stats.externalNetworkRequestCount}`,
        `BLOCKED_REQUEST_COUNT=${stats.blockedRequestCount}`,
        `BLOCKED_REQUEST_CLASSES=${stats.blockedRequestClasses.join(',') || 'none'}`,
        '',
      ].join('\n'))
      process.exitCode = 1
      void harness.server.close()
    }, preflight ? 60000 : INTERACTIVE_TIMEOUT_MS)

    const result = await harnessOutcome
    if (settled)
      return
    settled = true
    clearTimeout(timeout)
    const stats = harness.getStats()
    const context = {
      browser,
      address,
      credentialEnvStripped,
      externalAssetReferenceCount,
      externalNetworkRequestCount: stats.externalNetworkRequestCount,
      blockedRequestCount: stats.blockedRequestCount,
      localAssetRequestCount: stats.localAssetRequestCount,
      localModelAssetRequestCount: stats.localModelAssetRequestCount,
      localWasmAssetRequestCount: stats.localWasmAssetRequestCount,
      localRendererAssetRequestCount: stats.localRendererAssetRequestCount,
      localSpeechAssetRequestCount: stats.localSpeechAssetRequestCount,
      playbackMetadata: localSpeechAsset.metadata,
    }

    if (result.kind === 'preflight') {
      const passed = printPreflightReport(result.report, context)
      if (!passed)
        process.exitCode = 1
    }
    else {
      const report = addHostFields(result.report, context)
      printInteractiveReport(report, context)
      if (report.SMOKE_STATUS !== 'PASS' || report.MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE !== 'PASS')
        process.exitCode = 1
    }
    stopChild()
  }
  catch (error) {
    if (!settled) {
      settled = true
      clearTimeout(timeout)
      stdout.write(`CHROMIUM_${preflight ? 'NO_MEDIA_PREFLIGHT' : 'SMOKE'}=FAIL\nFAILURE_CODE=${error instanceof Error ? error.message.replace(/[^\w.-]/g, '-') : 'chromium-harness-failed'}\n`)
      process.exitCode = 1
    }
    stopChild()
  }
  finally {
    clearTimeout(timeout)
    await new Promise(resolveClose => harness.server.close(() => resolveClose()))
    await rm(speechAssetDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

await run()
