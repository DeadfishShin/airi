/**
 * The browser-level microphone processing requests used by production voice
 * input. This is a request authority, not evidence that the browser/device
 * actually enabled each processor.
 */
export const PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS = Object.freeze({
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
})
