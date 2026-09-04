import type { BrowserWindow, Session } from 'electron'

import type { LocalDuplexDiagnosticBlockedRequest, LocalDuplexDiagnosticMode } from '../../shared/local-duplex-diagnostic'

import process, { env, stdout } from 'node:process'

import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow as ElectronBrowserWindow, ipcMain, session } from 'electron'

import icon from '../../../resources/icon.png?asset'

import {
  classifyLocalDuplexBlockedRequest,
  isSafeDiagnosticModelId,
  LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL,
  LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL,
  LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER,
  stripLocalDuplexDiagnosticCredentials,
} from '../../shared/local-duplex-diagnostic'
import { baseUrl, getElectronMainDirname, load } from '../libs/electron/location'

const DIAGNOSTIC_RENDERER_REPORT_MARKER = 'LOCAL_DUPLEX_AEC_VAD_REPORT_JSON:'
const HOST_BOOT_REPORT_MARKER = 'AIRI_LOCAL_DUPLEX_PRODUCTION_HOST_BOOT_REPORT:'
const BOOT_TIMEOUT_MS = 15000

const allowedLocalProtocols = new Set(['file:', 'data:', 'blob:', 'about:', 'devtools:', `${LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL}:`])
const safePhaseTransitionStatuses = new Set(['IDLE', 'WAITING_FOR_VAD_QUIESCENCE', 'READY_FOR_NEXT_PHASE', 'FAILED', 'CANCELLED'])
const safePhaseQuiescenceResults = new Set(['NOT_STARTED', 'PASS', 'TIMEOUT', 'CANCELLED'])
const safePhaseTransitionPhases = new Set([
  'PHASE_0_TRACK_INSPECTION',
  'PHASE_1_QUIET_BASELINE',
  'PHASE_2_PLAYBACK_ONLY',
  'PHASE_3_USER_SPEECH_CONTROL',
  'PHASE_4_USER_SPEECH_DURING_PLAYBACK',
  'COMPLETE',
  'UNKNOWN',
])

export function isAllowedLocalDuplexResource(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    return false
  }

  if (allowedLocalProtocols.has(url.protocol))
    return true

  if (!['http:', 'https:'].includes(url.protocol))
    return false

  return url.hostname === '127.0.0.1'
    || url.hostname === 'localhost'
    || url.hostname === '::1'
}

function safeReportValue(field: string, value: unknown) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'UNKNOWN'
  if (typeof value === 'boolean')
    return value ? 'YES' : 'NO'
  if (field === 'PRODUCTION_VAD_MODEL_ID')
    return isSafeDiagnosticModelId(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_PROTOCOL')
    return typeof value === 'string' && /^(?:http|https):$/.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_HOST')
    return typeof value === 'string' && /^[a-z0-9.:[\]-]{1,128}$/i.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_CLASS')
    return typeof value === 'string' && /^(?:external-model-resource|external-onnx-wasm|external-renderer-resource|external-resource)$/.test(value) ? value : 'UNKNOWN'
  if (field === 'BLOCKED_REQUEST_RESOURCE_TYPE')
    return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/i.test(value) ? value : 'UNKNOWN'
  if (field === 'PHASE_TRANSITION_STATUS')
    return typeof value === 'string' && safePhaseTransitionStatuses.has(value) ? value : 'UNKNOWN'
  if (field === 'PHASE_TRANSITION_FROM' || field === 'PHASE_TRANSITION_TO')
    return typeof value === 'string' && safePhaseTransitionPhases.has(value) ? value : 'UNKNOWN'
  if (field === 'VAD_QUIESCENCE_RESULT')
    return typeof value === 'string' && safePhaseQuiescenceResults.has(value) ? value : 'UNKNOWN'
  if (typeof value === 'string' && /^[\w.:+-]+$/.test(value))
    return value
  return 'UNKNOWN'
}

function serializeDiagnosticReport(report: Record<string, unknown>) {
  const fields = [
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
    'USER_ONLY_VAD_ACTIVE_AT_PHASE_END',
    'USER_ONLY_VAD_LATE_END_AFTER_PHASE_COUNT',
    'USER_DURING_PLAYBACK_VAD_START_COUNT',
    'USER_DURING_PLAYBACK_VAD_END_COUNT',
    'USER_DURING_PLAYBACK_FIRST_ACTIVITY_LATENCY_MS',
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

  return [
    '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    ...fields
      .filter(field => field in report)
      .map(field => `${field}=${safeReportValue(field, report[field])}`),
    '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
  ].join('\n')
}

function createProductionHostWindow(preloadPath: string, mode: LocalDuplexDiagnosticMode, diagnosticSession: Session) {
  return new ElectronBrowserWindow({
    title: 'AIRI local duplex diagnostic',
    width: 820,
    height: 640,
    show: mode === 'interactive',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: preloadPath,
      session: diagnosticSession,
      contextIsolation: true,
      sandbox: false,
    },
  })
}

function safeAssetPath(root: string, requestPath: string) {
  const candidate = resolve(root, `.${requestPath}`)
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(rootWithSeparator) ? candidate : undefined
}

async function registerLocalAssetProtocol(diagnosticSession: Session) {
  const productionVadRoot = resolve(getElectronMainDirname(), '../../scripts/assets/production-vad')
  await diagnosticSession.protocol.handle(LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'production-vad')
      return new Response('Not found', { status: 404 })

    const filePath = safeAssetPath(productionVadRoot, decodeURIComponent(url.pathname))
    if (!filePath)
      return new Response('Not found', { status: 404 })

    try {
      const body = await readFile(filePath)
      return new Response(body, {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
        },
      })
    }
    catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function reportHostBoot(fields: Record<string, unknown>) {
  stdout.write(`${HOST_BOOT_REPORT_MARKER}${JSON.stringify(fields)}\n`)
}

function blockedRequestFields(count: number, request: LocalDuplexDiagnosticBlockedRequest | undefined) {
  return {
    BLOCKED_REQUEST_COUNT: count,
    BLOCKED_REQUEST_CLASS: request?.requestClass,
    BLOCKED_REQUEST_PROTOCOL: request?.protocol,
    BLOCKED_REQUEST_HOST: request?.host,
    BLOCKED_REQUEST_RESOURCE_TYPE: request?.resourceType,
    NETWORK_GUARD_FAILURE: count > 0 ? 'YES' : 'NO',
  }
}

export interface LocalDuplexDiagnosticWindowOptions {
  mode: LocalDuplexDiagnosticMode
}

export async function setupLocalDuplexDiagnosticWindow({ mode }: LocalDuplexDiagnosticWindowOptions): Promise<BrowserWindow> {
  stripLocalDuplexDiagnosticCredentials(env)

  const diagnosticSession = session.fromPartition(`local-duplex-diagnostic-${process.pid}`)
  await registerLocalAssetProtocol(diagnosticSession)
  let externalNetworkRequestCount = 0
  let firstBlockedRequest: LocalDuplexDiagnosticBlockedRequest | undefined
  let reportReceived = false
  let rendererReady = false
  let productionVadBootReport: Record<string, unknown> | undefined
  let readyTimer: NodeJS.Timeout | undefined
  let readyListener: ((event: Electron.IpcMainEvent) => void) | undefined

  diagnosticSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isAllowedLocalDuplexResource(details.url)) {
      callback({})
      return
    }

    externalNetworkRequestCount++
    if (!firstBlockedRequest)
      firstBlockedRequest = classifyLocalDuplexBlockedRequest(details.url, details.resourceType)
    callback({ cancel: true })
  })

  let window: BrowserWindow | undefined
  const preloadPath = join(resolve(getElectronMainDirname(), '..', 'preload'), 'index.mjs')
  const rendererFile = mode === 'boot-probe'
    ? 'local-duplex-diagnostic-boot.html'
    : 'local-duplex-diagnostic.html'

  const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
    readyListener = (event) => {
      if (!window || event.sender !== window.webContents || rendererReady)
        return

      rendererReady = true
      if (readyTimer)
        clearTimeout(readyTimer)
      const vadProbePassed = mode !== 'boot-probe'
        || (productionVadBootReport?.PRODUCTION_VAD_BROWSER_INIT === 'PASS'
          && productionVadBootReport?.PRODUCTION_VAD_SYNTHETIC_INFERENCE === 'PASS')
      const readyForOwnerPhase0 = vadProbePassed && externalNetworkRequestCount === 0
      reportHostBoot({
        HOST_RUNTIME: 'STAGE_TAMAGOTCHI_PRODUCTION_ELECTRON',
        DIAGNOSTIC_MODE: 'YES',
        CLOUD_PROVIDER_BOOTSTRAP: 'NO',
        WINDOW_CREATED: 'YES',
        DIAGNOSTIC_RENDERER_LOADED: 'YES',
        PRODUCTION_VAD_ALIGNMENT: 'YES',
        MEDIA_REQUESTED: 'NO',
        READY_FOR_OWNER_PHASE0: readyForOwnerPhase0 ? 'YES' : 'NO',
        EXTERNAL_NETWORK_REQUEST_COUNT: externalNetworkRequestCount,
        ...blockedRequestFields(externalNetworkRequestCount, firstBlockedRequest),
        ...(mode === 'boot-probe'
          ? {
              PRODUCTION_VAD_BROWSER_INIT: productionVadBootReport?.PRODUCTION_VAD_BROWSER_INIT ?? 'UNKNOWN',
              PRODUCTION_VAD_SYNTHETIC_INFERENCE: productionVadBootReport?.PRODUCTION_VAD_SYNTHETIC_INFERENCE ?? 'UNKNOWN',
              PRODUCTION_VAD_MODEL_ID: productionVadBootReport?.PRODUCTION_VAD_MODEL_ID,
              PRODUCTION_VAD_MODEL_REVISION: productionVadBootReport?.PRODUCTION_VAD_MODEL_REVISION,
              PRODUCTION_VAD_MODEL_DTYPE: productionVadBootReport?.PRODUCTION_VAD_MODEL_DTYPE,
              PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED: productionVadBootReport?.PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED,
              ONNX_WASM_RESOLUTION: productionVadBootReport?.ONNX_WASM_RESOLUTION,
              RENDERER_FAILURE_CODE: productionVadBootReport?.RENDERER_FAILURE_CODE,
            }
          : {}),
      })
      resolveReady()
    }
    ipcMain.on(LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL, readyListener)
    readyTimer = setTimeout(() => rejectReady(new Error('diagnostic-renderer-readiness-timeout')), BOOT_TIMEOUT_MS)
  })

  window = createProductionHostWindow(preloadPath, mode, diagnosticSession)
  window.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith(LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER)) {
      try {
        productionVadBootReport = JSON.parse(message.slice(LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER.length)) as Record<string, unknown>
      }
      catch {
        productionVadBootReport = {
          PRODUCTION_VAD_BROWSER_INIT: 'FAIL',
          PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'FAIL',
          RENDERER_FAILURE_CODE: 'production-vad-boot-report-invalid',
        }
      }
      return
    }

    if (!message.startsWith(DIAGNOSTIC_RENDERER_REPORT_MARKER))
      return

    try {
      const parsed = JSON.parse(message.slice(DIAGNOSTIC_RENDERER_REPORT_MARKER.length)) as Record<string, unknown>
      reportReceived = true
      parsed.RENDERER_FAILURE_CODE = typeof parsed.FAILURE_CODE === 'string' ? parsed.FAILURE_CODE : 'none'
      Object.assign(parsed, blockedRequestFields(externalNetworkRequestCount, firstBlockedRequest))
      if (externalNetworkRequestCount > 0) {
        parsed.SMOKE_STATUS = 'FAIL'
        parsed.HARNESS_READY = 'UNKNOWN'
      }
      stdout.write(`${serializeDiagnosticReport(parsed)}\n`)
      window?.close()
    }
    catch {
      reportHostBoot({
        HOST_RUNTIME: 'STAGE_TAMAGOTCHI_PRODUCTION_ELECTRON',
        DIAGNOSTIC_MODE: 'YES',
        WINDOW_CREATED: 'YES',
        DIAGNOSTIC_RENDERER_LOADED: 'YES',
        READY_FOR_OWNER_PHASE0: 'NO',
        ...blockedRequestFields(externalNetworkRequestCount, firstBlockedRequest),
        FAILURE_CODE: 'diagnostic-report-invalid',
      })
      window?.close()
    }
  })
  window.on('closed', () => {
    if (readyListener)
      ipcMain.removeListener(LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL, readyListener)
    if (readyTimer)
      clearTimeout(readyTimer)

    if (!reportReceived && mode === 'interactive') {
      stdout.write(`${serializeDiagnosticReport({
        SMOKE_STATUS: 'FAIL',
        HARNESS_READY: 'UNKNOWN',
        FAILURE_CODE: rendererReady ? 'renderer-no-report' : 'renderer-not-ready',
        RENDERER_FAILURE_CODE: rendererReady ? 'renderer-no-report' : 'renderer-not-ready',
        ...blockedRequestFields(externalNetworkRequestCount, firstBlockedRequest),
        CLEANUP_COMPLETED: 'UNKNOWN',
      })}\n`)
    }

    app.quit()
  })
  diagnosticSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(mode === 'interactive' && webContents === window?.webContents && permission === 'media')
  })

  if (is.dev || env.MAIN_APP_DEBUG || env.APP_DEBUG) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch {
      // Diagnostics remain usable if DevTools cannot open.
    }
  }

  try {
    await load(window, baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'), rendererFile))
    await readyPromise
  }
  catch {
    if (readyTimer)
      clearTimeout(readyTimer)
    if (readyListener)
      ipcMain.removeListener(LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL, readyListener)
    reportHostBoot({
      HOST_RUNTIME: 'STAGE_TAMAGOTCHI_PRODUCTION_ELECTRON',
      DIAGNOSTIC_MODE: 'YES',
      CLOUD_PROVIDER_BOOTSTRAP: 'NO',
      WINDOW_CREATED: 'YES',
      DIAGNOSTIC_RENDERER_LOADED: rendererReady ? 'YES' : 'NO',
      PRODUCTION_VAD_ALIGNMENT: 'YES',
      MEDIA_REQUESTED: 'NO',
      READY_FOR_OWNER_PHASE0: 'NO',
      EXTERNAL_NETWORK_REQUEST_COUNT: externalNetworkRequestCount,
      ...blockedRequestFields(externalNetworkRequestCount, firstBlockedRequest),
      FAILURE_CODE: 'diagnostic-host-boot-failed',
      RENDERER_FAILURE_CODE: 'diagnostic-host-boot-failed',
    })
    window.close()
    throw new Error('diagnostic-host-boot-failed')
  }

  return window
}
