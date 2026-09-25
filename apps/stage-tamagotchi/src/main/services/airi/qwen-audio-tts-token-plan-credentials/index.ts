import type { Buffer } from 'node:buffer'

import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { Lifecycle } from 'injeca'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  qwenAudioTtsTokenPlanClearProfile,
  qwenAudioTtsTokenPlanGetProfile,
  qwenAudioTtsTokenPlanSaveProfile,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-credential-ipc'
import { app, ipcMain, safeStorage } from 'electron'

import { createQwenAudioTtsTokenPlanCredentialStore } from './store'

type MainContext = ReturnType<typeof createContext>['context']

export interface QwenAudioTtsTokenPlanCredentialServiceOptions {
  context: MainContext
  lifecycle?: Lifecycle
  store: ReturnType<typeof createQwenAudioTtsTokenPlanCredentialStore>
}

function secureStorageBackend() {
  return {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value: string) => safeStorage.encryptString(value),
    decryptString: (value: Buffer) => safeStorage.decryptString(value),
  }
}

export function createQwenAudioTtsTokenPlanCredentialService(options: QwenAudioTtsTokenPlanCredentialServiceOptions) {
  const handlers = [
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanGetProfile, () => options.store.getPublicProfile()),
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanSaveProfile, payload => options.store.save(payload)),
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanClearProfile, () => options.store.clear()),
  ]

  const dispose = async () => {
    for (const disposeHandler of handlers)
      disposeHandler()
  }

  options.lifecycle?.appHooks.onStop(dispose)
  return {
    ...options.store,
    dispose,
  }
}

export function setupQwenAudioTtsTokenPlanCredentials(options: { lifecycle?: Lifecycle, store?: ReturnType<typeof createQwenAudioTtsTokenPlanCredentialStore> } = {}) {
  const eventa = createElectronContext(ipcMain)
  const store = options.store ?? createQwenAudioTtsTokenPlanCredentialStore({
    filePath: `${app.getPath('userData')}/qwen-audio-tts-token-plan-credential.json`,
    secureStorage: secureStorageBackend(),
  })
  const service = createQwenAudioTtsTokenPlanCredentialService({
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

export type QwenAudioTtsTokenPlanCredentialService = ReturnType<typeof setupQwenAudioTtsTokenPlanCredentials>
