import { existsSync } from 'node:fs'

// eslint-disable-next-line no-restricted-syntax
import { classifyLevel3CandidateVerdict } from './local-duplex-aec-vad-smoke-logic.mjs'

export const CHROMIUM_HOST_RUNTIME = 'SYSTEM_CHROMIUM'
export const LOCAL_SERVER_BIND_ADDRESS = '127.0.0.1'
export const LOCAL_SPEECH_PLAYBACK_PROFILE = 'macos-local-speech'
export const LOCAL_SPEECH_PLAYBACK_SOURCE = 'macos-system-say'
export const LOCAL_SPEECH_PLAYBACK_VOICE = 'Samantha'
export const LOCAL_SPEECH_PLAYBACK_RATE = 180
export const LOCAL_SPEECH_PLAYBACK_PHRASE = 'This is a local duplex audio diagnostic.'
export const PLAYBACK_GAIN_MAX = 0.25
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
  level2,
  productionElectronLevel2Evidence,
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
  return classifyLevel3CandidateVerdict({
    level2,
    productionElectronLevel2Evidence,
    environmentInterpretable,
    phaseIsolation,
    playbackProfile,
    playbackOnlyFalseTrigger,
    userOnlyDetected,
    userDuringPlaybackDetected,
    productionVadAlignment,
    cleanupCompleted,
    externalNetworkRequestCount,
  })
}

export function chromiumInteractiveExitCode({ smokeStatus, candidateVerdict }) {
  return smokeStatus === 'PASS' && candidateVerdict === 'PASS' ? 0 : 1
}
