/**
 * Reproducible AIRI production VAD model authority.
 *
 * Keep this identity separate from the VAD thresholds and state machine. The
 * revision pins the exact upstream artifact used by the production loader.
 */
export const PRODUCTION_VAD_MODEL_ID = 'onnx-community/silero-vad'
export const PRODUCTION_VAD_MODEL_REVISION = 'ddc9a7e80d6758f6fc795a1e8a04b798eb929d3a'
export const PRODUCTION_VAD_MODEL_FILE = 'onnx/model.onnx'
export const PRODUCTION_VAD_MODEL_DTYPE = 'fp32'
export const PRODUCTION_VAD_MODEL_CONFIG = Object.freeze({
  model_type: 'custom',
})
