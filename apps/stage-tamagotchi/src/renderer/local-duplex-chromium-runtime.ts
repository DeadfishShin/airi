import type { LocalDuplexChromiumRuntime } from '../shared/local-duplex-diagnostic'

import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

export function configureLocalDuplexChromiumRuntime(): LocalDuplexChromiumRuntime {
  const runtime: LocalDuplexChromiumRuntime = {
    modelBaseUrl: `${window.location.origin}/production-vad/`,
    ortWasmUrl: new URL(ortWasmUrl, import.meta.url).href,
    reportEndpoint: '/__report',
  }
  window.airiLocalDuplexChromium = runtime
  return runtime
}
