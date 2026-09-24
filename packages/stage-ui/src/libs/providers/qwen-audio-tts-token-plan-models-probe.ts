import type { QwenAudioTtsTokenPlanModelsProbeResult } from './qwen-audio-tts-token-plan-models-probe-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import { qwenAudioTtsTokenPlanProbeModels } from './qwen-audio-tts-token-plan-models-probe-ipc'

function getContext() {
  const electron = (globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron
  if (!electron?.ipcRenderer)
    return undefined

  return createContext(electron.ipcRenderer as never).context
}

/** Starts one user-triggered main-process probe. The renderer does not provide credentials. */
export async function probeQwenAudioTtsTokenPlanModels(): Promise<QwenAudioTtsTokenPlanModelsProbeResult> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Audio Token Plan model probe bridge is unavailable.')
  return await defineInvoke(context, qwenAudioTtsTokenPlanProbeModels)(undefined)
}
