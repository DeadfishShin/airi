import type { Buffer } from 'node:buffer'

import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  DeepSeekCredentialPublicProfile,
  DeepSeekCredentialSavePayload,
} from '@proj-airi/stage-ui/libs/providers/deepseek-credential-ipc'
import type { Lifecycle } from 'injeca'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  deepSeekCredentialClear,
  deepSeekCredentialGetProfile,
  deepSeekCredentialGetRuntime,
  deepSeekCredentialSave,
} from '@proj-airi/stage-ui/libs/providers/deepseek-credential-ipc'
import { app, ipcMain, safeStorage } from 'electron'

import { createDeepSeekCredentialStore } from './store'

type DeepSeekCredentialMainEventContext = ReturnType<typeof createContext>['context']

export interface DeepSeekCredentialServiceOptions {
  context: DeepSeekCredentialMainEventContext
  lifecycle?: Lifecycle
  store: ReturnType<typeof createDeepSeekCredentialStore>
}

function secureStorageBackend() {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value: string) => safeStorage.encryptString(value),
    decryptString: (value: Buffer) => safeStorage.decryptString(value),
  }
}

export function createDeepSeekCredentialService(options: DeepSeekCredentialServiceOptions) {
  const handlers = [
    defineInvokeHandler(options.context, deepSeekCredentialGetProfile, (): DeepSeekCredentialPublicProfile => options.store.getPublicProfile()),
    defineInvokeHandler(options.context, deepSeekCredentialSave, (payload: DeepSeekCredentialSavePayload): DeepSeekCredentialPublicProfile => options.store.save(payload)),
    defineInvokeHandler(options.context, deepSeekCredentialClear, (): DeepSeekCredentialPublicProfile => options.store.clear()),
    // Route A intentionally exposes the decrypted value only for the existing
    // renderer-side DeepSeek SDK. It is never persisted or returned as public state.
    defineInvokeHandler(options.context, deepSeekCredentialGetRuntime, (): string => options.store.getRuntimeCredential()),
  ]

  const dispose = async () => {
    for (const disposeHandler of handlers)
      disposeHandler()
  }

  options.lifecycle?.appHooks.onStop(dispose)

  return {
    clearCredential: options.store.clear,
    getPublicProfile: options.store.getPublicProfile,
    getRuntimeCredential: options.store.getRuntimeCredential,
    saveCredential: options.store.save,
    dispose,
  }
}

export function setupDeepSeekCredentials(options: { lifecycle?: Lifecycle, store?: ReturnType<typeof createDeepSeekCredentialStore> } = {}) {
  const eventa = createElectronContext(ipcMain)
  const store = options.store ?? createDeepSeekCredentialStore({
    filePath: `${app.getPath('userData')}/deepseek-credential.json`,
    secureStorage: secureStorageBackend(),
  })
  const service = createDeepSeekCredentialService({
    lifecycle: options.lifecycle,
    context: eventa.context,
    store,
  })

  return {
    ...service,
    dispose: async () => {
      await service.dispose()
      eventa.dispose()
    },
  }
}

export type DeepSeekCredentialService = ReturnType<typeof setupDeepSeekCredentials>
