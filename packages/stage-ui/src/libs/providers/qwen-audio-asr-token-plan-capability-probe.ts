import type { QwenAudioAsrTokenPlanProbeResult } from './qwen-audio-asr-token-plan-capability-probe-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import { qwenAudioAsrTokenPlanProbe } from './qwen-audio-asr-token-plan-capability-probe-ipc'

function getContext() {
  const electron = (globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron
  if (!electron?.ipcRenderer)
    return undefined

  return createContext(electron.ipcRenderer as never).context
}

/** Starts the explicit diagnostic action. No credential or audio payload crosses IPC. */
export async function probeQwenAudioAsrTokenPlan(): Promise<QwenAudioAsrTokenPlanProbeResult> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Audio Token Plan ASR probe bridge is unavailable.')
  return await defineInvoke(context, qwenAudioAsrTokenPlanProbe)(undefined)
}
