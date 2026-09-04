import { readFileSync } from 'node:fs'

import { PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS } from '@proj-airi/stage-ui/composables/audio/microphone-constraints'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import { describe, expect, it } from 'vitest'

// eslint-disable-next-line no-restricted-syntax
import { serializeLocalDuplexReport } from './local-duplex-aec-vad-smoke-logic.mjs'
// eslint-disable-next-line no-restricted-syntax
import {
  CHROMIUM_CSP,
  CHROMIUM_HOST_RUNTIME,
  classifyChromiumCandidateVerdict,
  countExternalAssetReferences,
  discoverSystemChromium,
  isLoopbackAddress,
  LOCAL_SERVER_BIND_ADDRESS,
} from './local-duplex-chromium-harness-logic.mjs'

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
const configSource = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')
const chromiumHarnessSource = readFileSync(new URL('./local-duplex-chromium-harness.mjs', import.meta.url), 'utf8')
const chromiumRendererSource = readFileSync(new URL('../src/renderer/local-duplex-chromium.ts', import.meta.url), 'utf8')
const chromiumRuntimeSource = readFileSync(new URL('../src/renderer/local-duplex-chromium-runtime.ts', import.meta.url), 'utf8')
const smokeRendererSource = readFileSync(new URL('./local-duplex-aec-vad-smoke-renderer.ts', import.meta.url), 'utf8')
const chromiumHtml = readFileSync(new URL('../src/renderer/local-duplex-chromium.html', import.meta.url), 'utf8')
const bootHtml = readFileSync(new URL('../src/renderer/local-duplex-chromium-boot.html', import.meta.url), 'utf8')

describe('system Chromium local duplex harness', () => {
  it('provides one command for interactive and no-media Chromium modes', () => {
    expect(packageSource).toContain('smoke:realtime-voice-local-duplex:chromium')
    expect(packageSource).toContain('AIRI_LOCAL_DUPLEX_CHROMIUM_BUILD=1 electron-vite build && node scripts/local-duplex-chromium-harness.mjs')
    expect(packageSource).toContain('smoke:realtime-voice-local-duplex:chromium:preflight')
    expect(packageSource).toContain('node scripts/local-duplex-chromium-harness.mjs --preflight')
  })

  it('discovers only an already-installed system Chrome/Chromium in preference order', () => {
    const candidates = [
      { name: 'Google-Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    ]
    expect(discoverSystemChromium(candidates, path => path.endsWith('Chromium'))).toEqual(candidates[1])
    expect(discoverSystemChromium(candidates, () => false)).toBeUndefined()
    expect(chromiumHarnessSource).toContain('CHROMIUM_HOST_UNAVAILABLE')
    expect(chromiumHarnessSource).not.toContain('download')
  })

  it('binds the local server to loopback and rejects non-loopback clients', () => {
    expect(LOCAL_SERVER_BIND_ADDRESS).toBe('127.0.0.1')
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.0.2.1')).toBe(false)
    expect(chromiumHarnessSource).toContain('server.listen(0, LOCAL_SERVER_BIND_ADDRESS')
    expect(chromiumHarnessSource).toContain('response.end(\'loopback-only\')')
  })

  it('uses a local-only CSP and contains no external HTML asset references', () => {
    expect(CHROMIUM_CSP).toContain('default-src \'self\'')
    expect(CHROMIUM_CSP).toContain('connect-src \'self\' blob: data:')
    expect(CHROMIUM_CSP).toContain('script-src \'self\' \'wasm-unsafe-eval\'')
    expect(CHROMIUM_CSP).not.toContain('https:')
    expect(countExternalAssetReferences(chromiumHtml)).toBe(0)
    expect(countExternalAssetReferences(bootHtml)).toBe(0)
    expect(chromiumHarnessSource).toContain('\'content-security-policy\': CHROMIUM_CSP')
    expect(chromiumHarnessSource).toContain('\'cross-origin-embedder-policy\': \'require-corp\'')
  })

  it('serves the system browser with local model and ONNX wasm assets only', () => {
    expect(chromiumHarnessSource).toContain('pathname.startsWith(\'/production-vad/\')')
    expect(chromiumHarnessSource).toContain('const MODEL_ROOT = resolve(SCRIPT_DIRECTORY, \'assets/production-vad\')')
    expect(chromiumHarnessSource).toContain('const RENDERER_ROOT = resolve(APP_ROOT, \'out/renderer\')')
    expect(chromiumHarnessSource).toContain('EXTERNAL_ASSET_REFERENCE_COUNT')
    expect(chromiumHarnessSource).toContain('EXTERNAL_NETWORK_REQUEST_COUNT')
    expect(chromiumRuntimeSource).toContain(['$', '{window.location.origin}/production-vad/'].join(''))
    expect(chromiumRuntimeSource).toContain('ortWasmUrl')
    expect(chromiumRuntimeSource).not.toContain('cdn.jsdelivr.net')
  })

  it('reuses the production VAD, AudioWorklet, and microphone authorities', () => {
    expect(chromiumRendererSource).toContain('local-duplex-aec-vad-smoke-renderer')
    expect(smokeRendererSource).toContain('createVAD(')
    expect(smokeRendererSource).toContain('createVADStates(')
    expect(smokeRendererSource).toContain('process.worklet?worker&url')
    expect(smokeRendererSource).toContain('PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS')
    expect(smokeRendererSource).not.toContain('@ricky0123/vad-web')
    expect(smokeRendererSource).not.toContain('MicVAD')
    expect(smokeRendererSource).not.toContain('ScriptProcessor')
    expect(chromiumRendererSource).not.toContain('@ricky0123/vad-web')
    expect(chromiumRendererSource).not.toContain('ScriptProcessor')
  })

  it('keeps the accepted model and VAD configuration unchanged', () => {
    expect(smokeRendererSource).toContain('PRODUCTION_VAD_MODEL_ID')
    expect(smokeRendererSource).toContain('PRODUCTION_VAD_MODEL_REVISION')
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

  it('keeps interactive phases out of the no-media boot probe', () => {
    expect(bootHtml).toContain('local-duplex-chromium-boot.ts')
    expect(chromiumHarnessSource).toContain('const PREFLIGHT_PAGE = \'/local-duplex-chromium-boot.html\'')
    expect(chromiumHarnessSource).toContain('args.push(\'--headless=new\')')
    expect(chromiumHarnessSource).toContain('pathname === \'/__boot-report\'')
    expect(chromiumHarnessSource).not.toContain('getUserMedia')
    expect(chromiumHarnessSource).not.toContain('AudioContext')
  })

  it('reports the browser route with the explicit Chromium Level3 authority', () => {
    const report = serializeLocalDuplexReport({
      HOST_RUNTIME: CHROMIUM_HOST_RUNTIME,
      DIAGNOSTIC_MODE: 'YES',
      CHROMIUM_HOST: 'Google-Chrome',
      MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE: 'INCONCLUSIVE',
      PRODUCTION_ELECTRON_LEVEL2_EVIDENCE: 'PASS',
      EXACT_ELECTRON_LEVEL3_EXECUTED: 'NO',
      OWNER_LEVEL3_AUTHORITY: 'MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE',
    })
    expect(report).toContain('HOST_RUNTIME=SYSTEM_CHROMIUM')
    expect(report).toContain('MACOS_CHROMIUM_LEVEL3_LOCAL_DEVICE_CANDIDATE=INCONCLUSIVE')
    expect(report).toContain('PRODUCTION_ELECTRON_LEVEL2_EVIDENCE=PASS')
    expect(report).toContain('EXACT_ELECTRON_LEVEL3_EXECUTED=NO')
  })

  it('classifies Chromium Level3 only from complete bounded phase evidence', () => {
    const complete = {
      environmentInterpretable: 'YES',
      phaseIsolation: 'YES',
      playbackProfile: 'macos-local-speech',
      playbackOnlyFalseTrigger: 'NO',
      userOnlyDetected: 'YES',
      userDuringPlaybackDetected: 'YES',
      productionVadAlignment: 'YES',
      cleanupCompleted: 'YES',
      externalNetworkRequestCount: 0,
    } as const
    expect(classifyChromiumCandidateVerdict(complete)).toBe('PASS')
    expect(classifyChromiumCandidateVerdict({ ...complete, playbackProfile: 'synthetic-compatibility' })).toBe('INCONCLUSIVE')
    expect(classifyChromiumCandidateVerdict({ ...complete, playbackOnlyFalseTrigger: 'YES' })).toBe('FAIL')
    expect(classifyChromiumCandidateVerdict({ ...complete, environmentInterpretable: 'INCONCLUSIVE' })).toBe('INCONCLUSIVE')
  })

  it('serializes only bounded content-free report fields', () => {
    const report = serializeLocalDuplexReport({
      HOST_RUNTIME: 'SYSTEM_CHROMIUM',
      PRODUCTION_VAD_MODEL_ID: 'onnx-community/silero-vad',
      FAILURE_CODE: 'none',
      TRANSCRIPT: 'user transcript must not appear',
      LLM_TEXT: 'assistant text must not appear',
      TOKEN_PLAN_API_KEY: 'credential must not appear',
      AUDIO_BASE64: 'audio must not appear',
    })
    expect(report).toContain('PRODUCTION_VAD_MODEL_ID=onnx-community/silero-vad')
    expect(report).not.toContain('user transcript')
    expect(report).not.toContain('assistant text')
    expect(report).not.toContain('credential')
    expect(report).not.toContain('audio must')
  })

  it('keeps normal AIRI Electron renderer selection separate from Chromium diagnostic inputs', () => {
    expect(configSource).toContain('AIRI_LOCAL_DUPLEX_CHROMIUM_BUILD')
    expect(configSource).toContain('local-duplex-chromium.html')
    expect(configSource).toContain('local-duplex-chromium-boot.html')
    expect(configSource).toContain('\'main\': resolve(join(import.meta.dirname, \'src\', \'renderer\', \'index.html\'))')
  })
})
