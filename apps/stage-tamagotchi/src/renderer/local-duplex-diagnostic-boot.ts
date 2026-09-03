import vadWorkletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { createVAD, createVADStates } from '@proj-airi/stage-ui/workers/vad'
import { PRODUCTION_VAD_DEFAULTS, resolveProductionVADConfig } from '@proj-airi/stage-ui/workers/vad/config'
import {
  PRODUCTION_VAD_MODEL_DTYPE,
  PRODUCTION_VAD_MODEL_ID,
  PRODUCTION_VAD_MODEL_REVISION,
} from '@proj-airi/stage-ui/workers/vad/model-authority'

const productionVadGraphReady = typeof createVAD === 'function'
  && typeof createVADStates === 'function'
  && typeof vadWorkletUrl === 'string'

document.documentElement.dataset.hostRuntime = 'stage-tamagotchi-production-electron'
document.documentElement.dataset.diagnosticMode = 'boot-probe'
document.documentElement.dataset.productionVad = `${PRODUCTION_VAD_MODEL_ID}@${PRODUCTION_VAD_MODEL_REVISION}:${PRODUCTION_VAD_MODEL_DTYPE}`
document.documentElement.dataset.productionVadRuntime = productionVadGraphReady ? 'AIRI_PRODUCTION_VAD' : 'UNAVAILABLE'
document.documentElement.dataset.vadConfig = JSON.stringify({
  ...resolveProductionVADConfig(),
  sampleRate: PRODUCTION_VAD_DEFAULTS.sampleRate,
})

window.airiLocalDuplexDiagnostic?.notifyReady()
