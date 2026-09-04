import process, { env, stdout } from 'node:process'

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(SCRIPT_DIRECTORY, '..')
const ELECTRON_VITE = resolve(APP_ROOT, 'node_modules/.bin/electron-vite')
const ELECTRON = resolve(APP_ROOT, 'node_modules/.bin/electron')
const READY_MARKER = 'AIRI_LOCAL_DUPLEX_PRODUCTION_HOST_BOOT_REPORT:'
const TIMEOUT_MS = 30000

const credentialNames = [
  'TOKEN_PLAN_API_KEY',
  'DASHSCOPE_API_KEY',
  'DASHSCOPE_WORKSPACE_ID',
  'DASHSCOPE_REGION',
]

function strippedEnvironment() {
  const result = { ...env }
  for (const name of credentialNames)
    delete result[name]
  return result
}

function safeOutput(record) {
  const fields = [
    'HOST_RUNTIME',
    'DIAGNOSTIC_MODE',
    'CLOUD_PROVIDER_BOOTSTRAP',
    'WINDOW_CREATED',
    'DIAGNOSTIC_RENDERER_LOADED',
    'PRODUCTION_VAD_ALIGNMENT',
    'PRODUCTION_VAD_BROWSER_INIT',
    'PRODUCTION_VAD_SYNTHETIC_INFERENCE',
    'PRODUCTION_VAD_MODEL_ID',
    'PRODUCTION_VAD_MODEL_REVISION',
    'PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED',
    'ONNX_WASM_RESOLUTION',
    'MEDIA_REQUESTED',
    'READY_FOR_OWNER_PHASE0',
    'EXTERNAL_NETWORK_REQUEST_COUNT',
    'BLOCKED_REQUEST_COUNT',
    'BLOCKED_REQUEST_CLASS',
    'BLOCKED_REQUEST_PROTOCOL',
    'BLOCKED_REQUEST_HOST',
    'BLOCKED_REQUEST_RESOURCE_TYPE',
    'NETWORK_GUARD_FAILURE',
    'RENDERER_FAILURE_CODE',
    'FAILURE_CODE',
  ]
  return fields
    .filter(field => field in record)
    .map(field => `${field}=${typeof record[field] === 'number' && Number.isFinite(record[field]) ? record[field] : String(record[field])}`)
    .join('\n')
}

function fail(code) {
  stdout.write(`HOST_BOOT_PROBE_STATUS=FAIL\nFAILURE_CODE=${code}\n`)
  process.exitCode = 1
}

function errorMessage(error) {
  if (error instanceof Error)
    return error.message
  return 'production-host-build-failed'
}

function runBuild() {
  return new Promise((resolveBuild, rejectBuild) => {
    const build = spawn(ELECTRON_VITE, ['build'], {
      cwd: APP_ROOT,
      env: {
        ...strippedEnvironment(),
        AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE: 'boot-probe',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    build.on('error', () => rejectBuild(new Error('electron-vite-build-spawn-failed')))
    build.on('close', code => code === 0 ? resolveBuild() : rejectBuild(new Error(`electron-vite-build-exited-${code}`)))
  })
}

let child
let diagnosticUserDataPath

let output = ''
let settled = false
let timeout

function stopChild() {
  if (!child)
    return

  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
    }
    catch { /* process may already have exited */ }
  }
  child.kill('SIGTERM')
  child.stdout?.destroy()
  child.stderr?.destroy()
  child.unref()
}

function finish(code, report) {
  if (settled)
    return
  settled = true
  clearTimeout(timeout)
  if (report) {
    stdout.write(`HOST_BOOT_PROBE_STATUS=${code ? 'FAIL' : 'PASS'}\n`)
    stdout.write(`${safeOutput(report)}\n`)
    if (code)
      process.exitCode = 1
  }
  else if (code) {
    fail(code)
  }

  stopChild()

  if (diagnosticUserDataPath) {
    void rm(diagnosticUserDataPath, { recursive: true, force: true })
  }
}

function inspect(chunk) {
  output += chunk.toString()
  if (output.length > 32768)
    output = output.slice(-32768)
  const markerIndex = output.indexOf(READY_MARKER)
  if (markerIndex === -1)
    return

  const line = output.slice(markerIndex + READY_MARKER.length).split('\n', 1)[0]
  try {
    const report = JSON.parse(line)
    if (report.READY_FOR_OWNER_PHASE0 !== 'YES') {
      finish('renderer-readiness-negative', report)
      return
    }
    finish(undefined, report)
  }
  catch {
    finish('boot-report-invalid')
  }
}

function attachChild(childProcess) {
  childProcess.stdout.on('data', inspect)
  childProcess.stderr.on('data', (chunk) => {
  // Preserve only a bounded diagnostic tail. Never echo environment or request data.
    const text = chunk.toString()
    if (text.includes('AIRI_LOCAL_DUPLEX_PRODUCTION_HOST_BOOT_REPORT:'))
      inspect(chunk)
  })
  childProcess.on('error', () => finish('electron-vite-spawn-failed'))
  childProcess.on('close', (code, signal) => {
    if (!settled)
      finish(code === 0 ? 'boot-report-missing' : `host-exited-${signal || code}`)
  })
}

timeout = setTimeout(() => {
  stopChild()
  finish('production-host-boot-timeout')
}, TIMEOUT_MS)

try {
  diagnosticUserDataPath = await mkdtemp(join(tmpdir(), 'airi-local-duplex-production-host-'))
  const diagnosticEnvironment = {
    ...strippedEnvironment(),
    AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE: 'boot-probe',
    APP_USER_DATA_PATH: diagnosticUserDataPath,
  }
  await runBuild()
  if (!settled) {
    child = spawn(ELECTRON, ['.'], {
      cwd: APP_ROOT,
      env: diagnosticEnvironment,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    attachChild(child)
  }
}
catch (error) {
  finish(errorMessage(error))
}
