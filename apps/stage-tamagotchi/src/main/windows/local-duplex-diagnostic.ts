import type { BrowserWindow, Session } from 'electron'

import type { LocalDuplexDiagnosticMode } from '../../shared/local-duplex-diagnostic'

import process, { env, stdout } from 'node:process'

import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { errorMessageFrom } from '@moeru/std'
import { app, BrowserWindow as ElectronBrowserWindow, ipcMain, session } from 'electron'

import icon from '../../../resources/icon.png?asset'

import {
  LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL,
  LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL,
  stripLocalDuplexDiagnosticCredentials,
} from '../../shared/local-duplex-diagnostic'
import { baseUrl, getElectronMainDirname, load } from '../libs/electron/location'

const DIAGNOSTIC_RENDERER_REPORT_MARKER = 'LOCAL_DUPLEX_AEC_VAD_REPORT_JSON:'
const HOST_BOOT_REPORT_MARKER = 'AIRI_LOCAL_DUPLEX_PRODUCTION_HOST_BOOT_REPORT:'
const BOOT_TIMEOUT_MS = 15000

const allowedLocalProtocols = new Set(['file:', 'data:', 'blob:', 'about:', 'devtools:', `${LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL}:`])

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

function safeReportValue(value: unknown) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : 'UNKNOWN'
  if (typeof value === 'boolean')
    return value ? 'YES' : 'NO'
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
    'FAILURE_CODE',
  ]

  return [
    '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    ...fields
      .filter(field => field in report)
      .map(field => `${field}=${safeReportValue(report[field])}`),
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

export interface LocalDuplexDiagnosticWindowOptions {
  mode: LocalDuplexDiagnosticMode
}

export async function setupLocalDuplexDiagnosticWindow({ mode }: LocalDuplexDiagnosticWindowOptions): Promise<BrowserWindow> {
  stripLocalDuplexDiagnosticCredentials(env)

  const diagnosticSession = session.fromPartition(`local-duplex-diagnostic-${process.pid}`)
  await registerLocalAssetProtocol(diagnosticSession)
  let externalNetworkRequestCount = 0
  let reportReceived = false
  let rendererReady = false
  let readyTimer: NodeJS.Timeout | undefined
  let readyListener: ((event: Electron.IpcMainEvent) => void) | undefined

  diagnosticSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (isAllowedLocalDuplexResource(details.url)) {
      callback({})
      return
    }

    externalNetworkRequestCount++
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
      reportHostBoot({
        HOST_RUNTIME: 'STAGE_TAMAGOTCHI_PRODUCTION_ELECTRON',
        DIAGNOSTIC_MODE: 'YES',
        CLOUD_PROVIDER_BOOTSTRAP: 'NO',
        WINDOW_CREATED: 'YES',
        DIAGNOSTIC_RENDERER_LOADED: 'YES',
        PRODUCTION_VAD_ALIGNMENT: 'YES',
        MEDIA_REQUESTED: 'NO',
        READY_FOR_OWNER_PHASE0: 'YES',
        EXTERNAL_NETWORK_REQUEST_COUNT: externalNetworkRequestCount,
      })
      resolveReady()
    }
    ipcMain.on(LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL, readyListener)
    readyTimer = setTimeout(() => rejectReady(new Error('diagnostic-renderer-readiness-timeout')), BOOT_TIMEOUT_MS)
  })

  window = createProductionHostWindow(preloadPath, mode, diagnosticSession)
  window.webContents.on('console-message', (_event, _level, message) => {
    if (!message.startsWith(DIAGNOSTIC_RENDERER_REPORT_MARKER))
      return

    try {
      const parsed = JSON.parse(message.slice(DIAGNOSTIC_RENDERER_REPORT_MARKER.length)) as Record<string, unknown>
      reportReceived = true
      if (externalNetworkRequestCount > 0) {
        parsed.SMOKE_STATUS = 'FAIL'
        parsed.HARNESS_READY = 'UNKNOWN'
        parsed.FAILURE_CODE = 'external-network-blocked'
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
  catch (error) {
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
      FAILURE_CODE: errorMessageFrom(error) ?? 'diagnostic-host-boot-failed',
    })
    window.close()
    throw error
  }

  return window
}
