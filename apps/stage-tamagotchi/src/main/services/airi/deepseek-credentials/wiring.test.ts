import type { ElectronMainContextExtensions, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'

import { readFileSync } from 'node:fs'

import { createContext, defineInvoke } from '@moeru/eventa'
import { deepSeekCredentialGetProfile, deepSeekCredentialGetRuntime } from '@proj-airi/stage-ui/libs/providers/deepseek-credential-ipc'
import { describe, expect, it, vi } from 'vitest'

import { createDeepSeekCredentialService } from './index'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/airi-test-user-data' }, ipcMain: {}, safeStorage: {} }))

const mainSource = readFileSync(new URL('../../../index.ts', import.meta.url), 'utf8')

describe('deepseek Route A credential wiring', () => {
  it('registers a main-process service scoped to Electron userData', () => {
    expect(mainSource).toContain('setupDeepSeekCredentials({ lifecycle: dependsOn.lifecycle })')
    expect(mainSource).toContain('services:deepseek-credentials')
    expect(mainSource).toContain('deepSeekCredentials')
  })

  it('exposes public readiness separately from the transient runtime credential', async () => {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const store = {
      getPublicProfile: vi.fn(() => ({ hasCredential: true, ready: true })),
      getRuntimeCredential: vi.fn(() => 'test-provider-secret'),
      save: vi.fn(() => ({ hasCredential: true, ready: true })),
      clear: vi.fn(() => ({ hasCredential: false, ready: false })),
    }
    const service = createDeepSeekCredentialService({ context, store })

    try {
      expect(await defineInvoke(context, deepSeekCredentialGetProfile)(undefined)).toEqual({ hasCredential: true, ready: true })
      expect(await defineInvoke(context, deepSeekCredentialGetRuntime)(undefined)).toBe('test-provider-secret')
      expect(store.getPublicProfile).toHaveBeenCalledOnce()
      expect(store.getRuntimeCredential).toHaveBeenCalledOnce()
    }
    finally {
      await service.dispose()
    }
  })
})
