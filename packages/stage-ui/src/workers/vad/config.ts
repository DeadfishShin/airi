import type { BaseVADConfig } from '../../libs/audio/vad'

/**
 * Shared production VAD defaults. Keep this module free of Vue/store imports so
 * diagnostic and browser-only callers use the same configuration authority as
 * the normal hearing store.
 */
export const PRODUCTION_VAD_DEFAULTS = Object.freeze({
  threshold: 0.52,
  minSilenceDurationMs: 1200,
  speechPadMs: 360,
  minSpeechDurationMs: 300,
  sampleRate: 16000,
})

export function resolveProductionVADConfig(
  threshold?: number,
  minSilenceDurationMs?: number,
  speechPadMs?: number,
  minSpeechDurationMs?: number,
): Pick<BaseVADConfig, 'speechThreshold' | 'exitThreshold' | 'minSilenceDurationMs' | 'speechPadMs' | 'minSpeechDurationMs'> {
  const resolvedThreshold = threshold ?? PRODUCTION_VAD_DEFAULTS.threshold

  return {
    speechThreshold: resolvedThreshold,
    exitThreshold: resolvedThreshold * 0.3,
    minSilenceDurationMs: minSilenceDurationMs ?? PRODUCTION_VAD_DEFAULTS.minSilenceDurationMs,
    speechPadMs: speechPadMs ?? PRODUCTION_VAD_DEFAULTS.speechPadMs,
    minSpeechDurationMs: minSpeechDurationMs ?? PRODUCTION_VAD_DEFAULTS.minSpeechDurationMs,
  }
}
