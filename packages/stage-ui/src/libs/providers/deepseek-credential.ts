import type { DeepSeekCredentialPublicProfile } from './deepseek-credential-ipc'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

import {
  deepSeekCredentialClear,
  deepSeekCredentialGetProfile,
  deepSeekCredentialGetRuntime,
  deepSeekCredentialSave,
} from './deepseek-credential-ipc'

function getContext() {
  const electron = (globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron
  if (!electron?.ipcRenderer)
    return undefined

  return createContext(electron.ipcRenderer as never).context
}

export function hasDeepSeekCredentialBridge() {
  return !!getContext()
}

export async function getDeepSeekCredentialProfile(): Promise<DeepSeekCredentialPublicProfile | undefined> {
  const context = getContext()
  if (!context)
    return undefined

  return await defineInvoke(context, deepSeekCredentialGetProfile)(undefined)
}

export async function saveDeepSeekCredential(apiKey: string): Promise<DeepSeekCredentialPublicProfile> {
  const context = getContext()
  if (!context)
    throw new Error('DeepSeek secure credential bridge is unavailable.')

  return await defineInvoke(context, deepSeekCredentialSave)({ apiKey })
}

export async function clearDeepSeekCredential(): Promise<DeepSeekCredentialPublicProfile> {
  const context = getContext()
  if (!context)
    throw new Error('DeepSeek secure credential bridge is unavailable.')

  return await defineInvoke(context, deepSeekCredentialClear)(undefined)
}

export async function getDeepSeekRuntimeCredential(): Promise<string> {
  const context = getContext()
  if (!context)
    throw new Error('DeepSeek secure credential bridge is unavailable.')

  const apiKey = await defineInvoke(context, deepSeekCredentialGetRuntime)(undefined)
  if (!apiKey.trim())
    throw new Error('DeepSeek credential is not configured.')
  return apiKey
}

export async function resolveDeepSeekRuntimeConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof config.apiKey === 'string' && config.apiKey.trim())
    return config

  if (!hasDeepSeekCredentialBridge())
    return config

  return {
    ...config,
    apiKey: await getDeepSeekRuntimeCredential(),
  }
}

export function stripDeepSeekCredential(config: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...config }
  delete sanitized.apiKey
  return sanitized
}

export async function migrateLegacyDeepSeekCredential(options: {
  legacyApiKey: unknown
  getProfile: () => Promise<DeepSeekCredentialPublicProfile | undefined>
  save: (apiKey: string) => Promise<DeepSeekCredentialPublicProfile>
  removeLegacy: () => void
}): Promise<boolean> {
  const legacyApiKey = typeof options.legacyApiKey === 'string' ? options.legacyApiKey.trim() : ''
  if (!legacyApiKey)
    return false

  const currentProfile = await options.getProfile()
  if (!currentProfile?.ready)
    await options.save(legacyApiKey)

  // The plaintext source is removed only after the secure save has resolved.
  options.removeLegacy()
  return true
}
