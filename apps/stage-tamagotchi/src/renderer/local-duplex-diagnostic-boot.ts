import vadWorkletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

import { env } from '@huggingface/transformers'
import { createVAD, createVADStates } from '@proj-airi/stage-ui/workers/vad'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import {
  PRODUCTION_VAD_MODEL_DTYPE,
  PRODUCTION_VAD_MODEL_ID,
  PRODUCTION_VAD_MODEL_REVISION,
} from '@proj-airi/stage-ui/workers/vad/model-authority'

import {
  LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL,
  LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER,
} from '../shared/local-duplex-diagnostic'

const productionVadGraphReady = typeof createVAD === 'function'
  && typeof createVADStates === 'function'
  && Boolean(vadWorkletUrl)

const browserTransformersEnv = env as typeof env & {
  backends: { onnx: { wasm?: { wasmPaths?: string | { wasm?: string } } } }
}
browserTransformersEnv.allowRemoteModels = false
browserTransformersEnv.allowLocalModels = true
browserTransformersEnv.localModelPath = `${LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL}://production-vad/`
browserTransformersEnv.useBrowserCache = false
browserTransformersEnv.useFSCache = false
browserTransformersEnv.useCustomCache = false
if (browserTransformersEnv.backends.onnx.wasm)
  browserTransformersEnv.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl }

document.documentElement.dataset.hostRuntime = 'stage-tamagotchi-production-electron'
document.documentElement.dataset.diagnosticMode = 'boot-probe'
document.documentElement.dataset.productionVad = `${PRODUCTION_VAD_MODEL_ID}@${PRODUCTION_VAD_MODEL_REVISION}:${PRODUCTION_VAD_MODEL_DTYPE}`
document.documentElement.dataset.productionVadRuntime = productionVadGraphReady ? 'AIRI_PRODUCTION_VAD' : 'UNAVAILABLE'
document.documentElement.dataset.vadConfig = JSON.stringify({
  ...resolveProductionVADConfig(),
  sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
})

function safeFailureCode(error: unknown) {
  if (error instanceof Error && /^[\w-]{1,96}$/.test(error.message))
    return error.message
  return 'production-vad-browser-init-failed'
}

async function initializeProductionVAD() {
  const baseReport = {
    PRODUCTION_VAD_MODEL_ID,
    PRODUCTION_VAD_MODEL_REVISION,
    PRODUCTION_VAD_MODEL_DTYPE,
    PRODUCTION_VAD_REMOTE_FALLBACK_ALLOWED: 'NO',
    ONNX_WASM_RESOLUTION: 'bundled-local',
  }

  if (!productionVadGraphReady) {
    console.info(`${LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER}${JSON.stringify({
      ...baseReport,
      PRODUCTION_VAD_BROWSER_INIT: 'FAIL',
      PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'FAIL',
      RENDERER_FAILURE_CODE: 'production-vad-graph-unavailable',
    })}`)
    window.airiLocalDuplexDiagnostic?.notifyReady()
    return
  }

  try {
    const vad = await createVAD({
      sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
      newBufferSize: 512,
      ...resolveProductionVADConfig(),
    })
    await vad.processAudio(new Float32Array(512))
    console.info(`${LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER}${JSON.stringify({
      ...baseReport,
      PRODUCTION_VAD_BROWSER_INIT: 'PASS',
      PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'PASS',
      RENDERER_FAILURE_CODE: 'none',
    })}`)
  }
  catch (error) {
    console.info(`${LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER}${JSON.stringify({
      ...baseReport,
      PRODUCTION_VAD_BROWSER_INIT: 'FAIL',
      PRODUCTION_VAD_SYNTHETIC_INFERENCE: 'FAIL',
      RENDERER_FAILURE_CODE: safeFailureCode(error),
    })}`)
  }

  window.airiLocalDuplexDiagnostic?.notifyReady()
}

void initializeProductionVAD()
