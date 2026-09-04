import { existsSync } from 'node:fs'

export const CHROMIUM_HOST_RUNTIME = 'SYSTEM_CHROMIUM'
export const LOCAL_SERVER_BIND_ADDRESS = '127.0.0.1'
export const CHROMIUM_CSP = [
  'default-src \'self\'',
  'base-uri \'none\'',
  'connect-src \'self\' blob: data:',
  'font-src \'self\' data:',
  'img-src \'self\' blob: data:',
  'media-src \'self\' blob: data:',
  'object-src \'none\'',
  // Transformers.js/ONNX Runtime compiles the bundled local wasm module in
  // the renderer. This keyword permits that local compilation without
  // permitting external scripts or network destinations.
  'script-src \'self\' \'wasm-unsafe-eval\'',
  'style-src \'self\' \'unsafe-inline\'',
  'worker-src \'self\' blob:',
  'frame-src \'none\'',
  'form-action \'none\'',
].join('; ')

export function isLoopbackAddress(address) {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address === 'localhost'
}

export function countExternalAssetReferences(html) {
  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
  return references.filter(([, value]) => /^https?:\/\//i.test(value) || value.startsWith('//')).length
}

export function discoverSystemChromium(candidates, fileExists = existsSync) {
  return candidates.find(candidate => fileExists(candidate.path))
}

export function classifyChromiumCandidateVerdict({
  environmentInterpretable,
  phaseIsolation,
  playbackProfile,
  playbackOnlyFalseTrigger,
  userOnlyDetected,
  userDuringPlaybackDetected,
  productionVadAlignment,
  cleanupCompleted,
  externalNetworkRequestCount,
}) {
  const prerequisites = [
    environmentInterpretable,
    phaseIsolation,
    playbackOnlyFalseTrigger,
    userOnlyDetected,
    userDuringPlaybackDetected,
    productionVadAlignment,
    cleanupCompleted,
  ]
  if (prerequisites.some(value => value === 'UNKNOWN' || value === 'INCONCLUSIVE'))
    return 'INCONCLUSIVE'
  if (externalNetworkRequestCount !== 0 || playbackProfile !== 'macos-local-speech')
    return 'INCONCLUSIVE'
  if (playbackOnlyFalseTrigger !== 'NO')
    return 'FAIL'
  return [
    environmentInterpretable,
    phaseIsolation,
    userOnlyDetected,
    userDuringPlaybackDetected,
    productionVadAlignment,
    cleanupCompleted,
  ].every(value => value === 'YES')
    ? 'PASS'
    : 'FAIL'
}
