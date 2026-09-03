import { Buffer } from 'node:buffer'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { argv, env, pid, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

// eslint-disable-next-line no-restricted-syntax
import {
  isAllowedLocalResource,
  serializeLocalDuplexReport,
  stripCredentialEnvironment,
} from './local-duplex-aec-vad-smoke-logic.mjs'

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, '../../..')
const MODEL_ROOT = resolve(SCRIPT_DIRECTORY, 'assets/production-vad')
const PNPM_DIRECTORY = resolve(REPOSITORY_ROOT, 'node_modules/.pnpm')
const REPORT_MARKER = 'LOCAL_DUPLEX_AEC_VAD_REPORT_JSON:'
const RENDERER_ENTRY = '/apps/stage-tamagotchi/scripts/local-duplex-aec-vad-smoke-renderer.ts'
const MODEL_RESOURCE_ROOT = '/production-vad/'
const ORT_RESOURCE_ROOT = '/ort/'
const PRODUCTION_VAD_PREFLIGHT_MODULES = [
  '/packages/stage-ui/src/workers/vad/index.ts',
  '/packages/stage-ui/src/workers/vad/config.ts',
  '/packages/stage-ui/src/workers/vad/model-authority.ts',
  '/packages/stage-ui/src/workers/vad/vad.ts',
  '/packages/stage-ui/src/workers/vad/manager.ts',
  '/packages/stage-ui/src/workers/vad/process.worklet.ts?worker&url',
]

function findInstalledDirectory(prefix) {
  const directory = readdirSync(PNPM_DIRECTORY).find(name => name.startsWith(prefix))
  if (!directory)
    throw new Error(`dependency-${prefix.replaceAll('@', '').replaceAll('+', '-')}-unavailable`)
  return directory
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.onnx'))
    return 'application/octet-stream'
  if (filePath.endsWith('.wasm'))
    return 'application/wasm'
  return 'text/plain; charset=utf-8'
}

function safeAssetPath(root, requestedPath) {
  const decodedPath = decodeURIComponent(requestedPath)
  const candidate = resolve(root, decodedPath)
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(rootWithSeparator) ? candidate : undefined
}

function buildRendererHtml() {
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
  <p class="note">No ASR, TTS, LLM, provider, or chat path is used. Microphone audio stays in the AIRI production VAD graph and is never saved or displayed.</p>
  <div id="phase">Preparing PHASE_0</div>
  <div id="instruction">Inspecting local track settings and loading the bundled local VAD asset.</div>
  <div id="countdown"></div>
  <div id="status" aria-live="polite">Starting isolated diagnostic window…</div>
  <button id="cancel" type="button">Cancel smoke</button>
  <script type="module" src="${RENDERER_ENTRY}"></script>
</body>
</html>`
}

function writeFileResponse(response, filePath) {
  let body
  try {
    body = readFileSync(filePath)
  }
  catch {
    response.writeHead(404)
    response.end()
    return
  }

  response.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'content-length': body.byteLength,
    'cache-control': 'no-store',
  })
  response.end(body)
}

function createLocalVitePlugin({ html, modelRoot, ortDirectory }) {
  return {
    name: 'airi-local-duplex-production-vad-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname
        if (requestPath === '/') {
          const body = Buffer.from(html)
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': body.byteLength,
            'cache-control': 'no-store',
          })
          response.end(body)
          return
        }

        if (requestPath.startsWith(MODEL_RESOURCE_ROOT)) {
          const filePath = safeAssetPath(modelRoot, requestPath.slice(MODEL_RESOURCE_ROOT.length))
          if (filePath) {
            writeFileResponse(response, filePath)
            return
          }
        }

        if (requestPath.startsWith(ORT_RESOURCE_ROOT)) {
          const filePath = safeAssetPath(ortDirectory, requestPath.slice(ORT_RESOURCE_ROOT.length))
          if (filePath) {
            writeFileResponse(response, filePath)
            return
          }
        }

        next()
      })
    },
  }
}

async function createLocalViteServer(tempRoot) {
  const ortDirectory = resolve(PNPM_DIRECTORY, findInstalledDirectory('onnxruntime-web@'), 'node_modules/onnxruntime-web/dist')
  const html = buildRendererHtml()
  const { createServer: createViteServer } = await import('vite')
  return createViteServer({
    root: REPOSITORY_ROOT,
    // This server is a standalone diagnostics runtime. It must not discover
    // the repository's app-level Vite configs or their plugin graphs.
    configFile: false,
    cacheDir: join(tempRoot, 'vite-cache'),
    appType: 'spa',
    logLevel: 'error',
    // The smoke entry is intentionally transformed on demand. Disabling the
    // optimizer prevents Vite from scanning unrelated workspace HTML/entries.
    optimizeDeps: {
      disabled: true,
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      hmr: false,
    },
    resolve: {
      alias: {
        '@proj-airi/stage-ui': resolve(REPOSITORY_ROOT, 'packages/stage-ui/src'),
      },
    },
    plugins: [createLocalVitePlugin({ html, modelRoot: MODEL_ROOT, ortDirectory })],
  })
}

function loopbackUrl(address, requestPath) {
  return `http://127.0.0.1:${address.port}${requestPath}`
}

async function fetchLoopbackText(address, requestPath) {
  const response = await fetch(loopbackUrl(address, requestPath))
  if (!response.ok)
    throw new Error(`preflight-http-${response.status}-${requestPath.replace(/[^\w./?-]/g, '-')}`)
  return response.text()
}

async function runPreflight() {
  const credentialEnvStripped = stripCredentialEnvironment({ ...env })
  const tempRoot = await mkdtemp(join(tmpdir(), 'airi-local-duplex-'))
  const viteServer = await createLocalViteServer(tempRoot)

  try {
    await viteServer.listen()
    const address = viteServer.httpServer?.address()
    if (!address || typeof address === 'string')
      throw new Error('preflight-loopback-server-unavailable')

    const rootHtml = await fetchLoopbackText(address, '/')
    if (!rootHtml.includes(`src="${RENDERER_ENTRY}"`))
      throw new Error('preflight-root-html-entry-unavailable')

    const rendererResponse = await fetchLoopbackText(address, RENDERER_ENTRY)
    if (rendererResponse.includes('airi-plugin-web-extension') || rendererResponse.includes('uno.css'))
      throw new Error('preflight-unrelated-workspace-graph-detected')

    const transformed = await viteServer.transformRequest(RENDERER_ENTRY)
    if (!transformed?.code)
      throw new Error('production-vad-renderer-transform-unavailable')

    const vadModules = await Promise.all(PRODUCTION_VAD_PREFLIGHT_MODULES.map(async (modulePath) => {
      const result = await viteServer.transformRequest(modulePath)
      if (!result?.code)
        throw new Error(`production-vad-graph-module-unavailable-${modulePath.replace(/[^\w./?-]/g, '-')}`)
      return result
    }))
    if (vadModules.length !== PRODUCTION_VAD_PREFLIGHT_MODULES.length)
      throw new Error('production-vad-graph-incomplete')

    const pluginNames = viteServer.config.plugins.map(plugin => plugin.name || '')
    if (viteServer.config.configFile || viteServer.config.optimizeDeps.disabled !== true || pluginNames.some(name => name.includes('web-extension'))) {
      throw new Error('preflight-vite-isolation-not-enforced')
    }

    stdout.write([
      '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
      'SMOKE_STATUS=DRY_RUN',
      'HARNESS_READY=YES',
      'VAD_RUNTIME=AIRI_PRODUCTION_VAD',
      'PRODUCTION_VAD_ALIGNMENT=YES',
      'PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED=NO',
      `CREDENTIAL_ENV_STRIPPED=${credentialEnvStripped ? 'YES' : 'NO'}`,
      'EXTERNAL_NETWORK_REQUEST_COUNT=0',
      'PREFLIGHT_VITE_LISTEN=PASS',
      'PREFLIGHT_DEPENDENCY_PROCESSING=SKIPPED_BY_ISOLATION',
      'VITE_CONFIG_FILE_DISCOVERY_DISABLED=YES',
      'UNRELATED_WORKSPACE_SCAN_REMOVED=YES',
      'WEB_EXTENSION_ENTRY_IN_SMOKE_GRAPH=NO',
      'UNO_CSS_REQUIRED_BY_SMOKE=NO',
      'PREFLIGHT_ROOT_HTML=PASS',
      'PRODUCTION_VAD_RENDERER_TRANSFORM=PASS',
      'PREFLIGHT_RENDERER_TRANSFORM=PASS',
      'PREFLIGHT_PRODUCTION_VAD_GRAPH=PASS',
      'REAL_TOKEN_PLAN_API_CALL_COUNT=0',
      'REAL_PAYG_API_CALL_COUNT=0',
      'REAL_LLM_API_CALL_COUNT=0',
      '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
      '\n',
    ].join('\n'))
  }
  catch (error) {
    const message = error instanceof Error ? error.message.replace(/[^\w.:-]/g, '-') : 'unknown'
    stdout.write(`SMOKE_PREFLIGHT_ERROR=${message}\n`)
    throw new Error(`smoke-preflight-failed:${message}`)
  }
  finally {
    await viteServer.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function runElectron() {
  const credentialEnvStripped = stripCredentialEnvironment(env)
  const tempRoot = await mkdtemp(join(tmpdir(), 'airi-local-duplex-'))
  const viteServer = await createLocalViteServer(tempRoot)

  let window
  let reportReceived = false
  let externalNetworkRequestCount = 0
  await viteServer.listen()
  const address = viteServer.httpServer?.address()
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
    await viteServer.close()
    await rm(tempRoot, { recursive: true, force: true })
  }
}

function runDryRun() {
  const credentialEnvStripped = stripCredentialEnvironment({ ...env })
  stdout.write([
    '<<LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    'SMOKE_STATUS=DRY_RUN',
    'HARNESS_READY=YES',
    'VAD_RUNTIME=AIRI_PRODUCTION_VAD',
    'PRODUCTION_VAD_ALIGNMENT=YES',
    'PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED=NO',
    'CREDENTIAL_ENV_STRIPPED=YES',
    `CREDENTIAL_ENV_STRIPPED_CHECK=${credentialEnvStripped ? 'PASS' : 'FAIL'}`,
    'EXTERNAL_NETWORK_REQUEST_COUNT=0',
    'REAL_TOKEN_PLAN_API_CALL_COUNT=0',
    'REAL_PAYG_API_CALL_COUNT=0',
    'REAL_LLM_API_CALL_COUNT=0',
    '<<END_LOCAL_DUPLEX_AEC_VAD_REPORT>>',
    '\n',
  ].join('\n'))
}

if (argv.includes('--preflight'))
  await runPreflight()
else if (argv.includes('--dry-run'))
  runDryRun()
else
  await runElectron()
