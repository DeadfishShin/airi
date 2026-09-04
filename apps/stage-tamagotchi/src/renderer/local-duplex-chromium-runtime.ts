import type { LocalDuplexChromiumRuntime } from '../shared/local-duplex-diagnostic'

import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'

export function configureLocalDuplexChromiumRuntime(): LocalDuplexChromiumRuntime {
  const runtime: LocalDuplexChromiumRuntime = {
    modelBaseUrl: `${window.location.origin}/production-vad/`,
    ortWasmUrl: new URL(ortWasmUrl, import.meta.url).href,
    playbackAssetUrl: `${window.location.origin}/local-speech.wav`,
    reportEndpoint: '/__report',
  }
  window.airiLocalDuplexChromium = runtime
  return runtime
}

// This module is evaluated before the Chromium renderer entry imports the
// production VAD renderer. Configure the marker at module evaluation time so
// that renderer initialization can remain explicitly click-gated.
if (typeof window !== 'undefined')
  configureLocalDuplexChromiumRuntime()
