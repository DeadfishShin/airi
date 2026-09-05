import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenDashScopePaygPublicProfile,
  QwenDashScopePaygSavePayload,
} from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'
import type { Lifecycle } from 'injeca'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  qwenDashScopePaygClearProfile,
  qwenDashScopePaygGetProfile,
  qwenDashScopePaygSaveProfile,
} from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'
import { app, ipcMain, safeStorage } from 'electron'

import { createDashScopePaygCredentialStore, type DashScopePaygCredentialStoreOptions, type QwenDashScopePaygRuntimeProfile } from './store'

type DashScopePaygMainEventContext = ReturnType<typeof createContext>['context']

export interface DashScopePaygCredentialServiceOptions {
  context: DashScopePaygMainEventContext
  lifecycle?: Lifecycle
  store: ReturnType<typeof createDashScopePaygCredentialStore>
}

function secureStorageBackend() {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value: string) => safeStorage.encryptString(value),
    decryptString: (value: Buffer) => safeStorage.decryptString(value),
  }
}

export function createDashScopePaygCredentialService(options: DashScopePaygCredentialServiceOptions) {
  const handlers = [
    defineInvokeHandler(options.context, qwenDashScopePaygGetProfile, (): QwenDashScopePaygPublicProfile => options.store.getPublicProfile()),
    defineInvokeHandler(options.context, qwenDashScopePaygSaveProfile, (payload: QwenDashScopePaygSavePayload): QwenDashScopePaygPublicProfile => options.store.save(payload)),
    defineInvokeHandler(options.context, qwenDashScopePaygClearProfile, (): QwenDashScopePaygPublicProfile => options.store.clear()),
  ]

  const dispose = async () => {
    for (const disposeHandler of handlers)
      disposeHandler()
  }

  options.lifecycle?.appHooks.onStop(dispose)

  return {
    getPublicProfile: options.store.getPublicProfile,
    getRuntimeProfile: options.store.getRuntimeProfile as () => QwenDashScopePaygRuntimeProfile,
    saveProfile: options.store.save,
    clearProfile: options.store.clear,
    dispose,
  }
}

export function setupDashScopePaygCredentials(options: { lifecycle?: Lifecycle, store?: ReturnType<typeof createDashScopePaygCredentialStore> } = {}) {
  const eventa = createElectronContext(ipcMain)
  const storeOptions: DashScopePaygCredentialStoreOptions = {
    filePath: `${app.getPath('userData')}/qwen-dashscope-payg-credential.json`,
    secureStorage: secureStorageBackend(),
  }
  const store = options.store ?? createDashScopePaygCredentialStore(storeOptions)
  const service = createDashScopePaygCredentialService({
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

export type DashScopePaygCredentialService = ReturnType<typeof setupDashScopePaygCredentials>
