import type {
  QwenAudioRealtimePlusTokenPlanProbePreflight,
  QwenAudioRealtimePlusTokenPlanProbeResult,
} from './qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import { qwenAudioRealtimePlusTokenPlanGetPreflight, qwenAudioRealtimePlusTokenPlanProbe } from './qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

function getContext() {
  const electron = (globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron
  if (!electron?.ipcRenderer)
    return undefined
  return createContext(electron.ipcRenderer as never).context
}

/** Explicit diagnostic only. No credential, headers, or audio payload crosses IPC. */
export async function probeQwenAudioRealtimePlusTokenPlanTranscriptOnly(): Promise<QwenAudioRealtimePlusTokenPlanProbeResult> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Token Plan realtime transcript probe bridge is unavailable.')
  return await defineInvoke(context, qwenAudioRealtimePlusTokenPlanProbe)(undefined)
}

export async function getQwenAudioRealtimePlusTokenPlanPreflight(): Promise<QwenAudioRealtimePlusTokenPlanProbePreflight> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Token Plan realtime transcript preflight bridge is unavailable.')
  return await defineInvoke(context, qwenAudioRealtimePlusTokenPlanGetPreflight)(undefined)
}
