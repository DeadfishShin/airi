import { env } from '@huggingface/transformers'
import { errorMessageFrom } from '@moeru/std'
import { createVAD } from '@proj-airi/stage-ui/workers/vad'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import {
  PRODUCTION_VAD_MODEL_DTYPE,
  PRODUCTION_VAD_MODEL_ID,
  PRODUCTION_VAD_MODEL_REVISION,
} from '@proj-airi/stage-ui/workers/vad/model-authority'

import { configureLocalDuplexChromiumRuntime } from './local-duplex-chromium-runtime'

const runtime = configureLocalDuplexChromiumRuntime()
const transformersEnv = env as typeof env & {
  backends: { onnx: { wasm?: { wasmPaths?: string | { wasm?: string } } } }
}

transformersEnv.allowRemoteModels = false
transformersEnv.allowLocalModels = true
transformersEnv.localModelPath = runtime.modelBaseUrl
transformersEnv.useBrowserCache = false
transformersEnv.useFSCache = false
transformersEnv.useCustomCache = false
if (transformersEnv.backends.onnx.wasm)
  transformersEnv.backends.onnx.wasm.wasmPaths = { wasm: runtime.ortWasmUrl }

function safeFailureCode(error: unknown) {
  const message = errorMessageFrom(error) ?? ''
  if (/wasm|webassembly/i.test(message))
    return 'onnx-wasm-init-failed'
  if (/local path|found locally|model/i.test(message))
    return 'production-vad-local-model-failed'
  if (/session|ort|tensor/i.test(message))
    return 'onnx-model-session-failed'
  if (/^[\w-]{1,96}$/.test(message))
    return message
  return 'production-vad-browser-init-failed'
}

async function sendBootReport(report: Record<string, string>) {
  try {
    await fetch('/__boot-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      keepalive: true,
    })
  }
  catch {
    // The host process owns the bounded failure timeout and will report a missing handshake.
  }
}

async function initializeProductionVAD() {
  const baseReport = {
    PRODUCTION_VAD_MODEL_ID,
    PRODUCTION_VAD_MODEL_REVISION,
    PRODUCTION_VAD_MODEL_DTYPE,
    PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED: 'NO',
    ONNX_WASM_RESOLUTION: 'bundled-local',
    CROSS_ORIGIN_ISOLATED: globalThis.crossOriginIsolated ? 'YES' : 'NO',
  }

  let wasmFetch: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
  let wasmCompile: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
  let wasmValidate: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
  try {
    const wasmResponse = await fetch(runtime.ortWasmUrl)
    if (!wasmResponse.ok)
      throw new Error('onnx-wasm-local-asset-fetch-failed')
    wasmFetch = 'PASS'
    try {
      const wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer())
      wasmValidate = WebAssembly.validate(wasmBytes) ? 'PASS' : 'FAIL'
      if (wasmValidate !== 'PASS')
        throw new Error('onnx-wasm-local-asset-validation-failed')
      await WebAssembly.compile(wasmBytes)
      wasmCompile = 'PASS'
    }
    catch {
      wasmCompile = 'FAIL'
      throw new Error('onnx-wasm-local-asset-compile-failed')
    }
    const vad = await createVAD({
      sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
      newBufferSize: 512,
      ...resolveProductionVADConfig(),
    })
    await vad.processAudio(new Float32Array(512))
    await sendBootReport({
      ...baseReport,
      PRODUCTION_VAD_WASM_FETCH: 'PASS',
      PRODUCTION_VAD_WASM_COMPILE: 'PASS',
      PRODUCTION_VAD_WASM_VALIDATE: 'PASS',
      PRODUCTION_VAD_BROWSER_INIT: 'PASS',
      PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'PASS',
      RENDERER_FAILURE_CODE: 'none',
    })
  }
  catch (error) {
    await sendBootReport({
      ...baseReport,
      PRODUCTION_VAD_WASM_FETCH: wasmFetch,
      PRODUCTION_VAD_WASM_COMPILE: wasmCompile,
      PRODUCTION_VAD_WASM_VALIDATE: wasmValidate,
      PRODUCTION_VAD_BROWSER_INIT: 'FAIL',
      PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'FAIL',
      RENDERER_FAILURE_CODE: safeFailureCode(error),
    })
  }
}

void initializeProductionVAD()
