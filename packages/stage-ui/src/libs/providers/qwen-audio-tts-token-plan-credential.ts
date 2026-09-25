import type { QwenAudioTtsTokenPlanPublicProfile } from './qwen-audio-tts-token-plan-credential-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import {
  qwenAudioTtsTokenPlanClearProfile,
  qwenAudioTtsTokenPlanGetProfile,
  qwenAudioTtsTokenPlanSaveProfile,
} from './qwen-audio-tts-token-plan-credential-ipc'

function getContext() {
  const electron = (globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron
  if (!electron?.ipcRenderer)
    return undefined

  return createContext(electron.ipcRenderer as never).context
}

export function hasQwenAudioTtsTokenPlanCredentialBridge() {
  return !!getContext()
}

export async function getQwenAudioTtsTokenPlanCredentialProfile(): Promise<QwenAudioTtsTokenPlanPublicProfile | undefined> {
  const context = getContext()
  if (!context)
    return undefined
  return await defineInvoke(context, qwenAudioTtsTokenPlanGetProfile)(undefined)
}

export async function saveQwenAudioTtsTokenPlanCredential(apiKey: string): Promise<QwenAudioTtsTokenPlanPublicProfile> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Audio Token Plan secure credential bridge is unavailable.')
  return await defineInvoke(context, qwenAudioTtsTokenPlanSaveProfile)({ apiKey })
}

export async function clearQwenAudioTtsTokenPlanCredential(): Promise<QwenAudioTtsTokenPlanPublicProfile> {
  const context = getContext()
  if (!context)
    throw new Error('Qwen Audio Token Plan secure credential bridge is unavailable.')
  return await defineInvoke(context, qwenAudioTtsTokenPlanClearProfile)(undefined)
}
