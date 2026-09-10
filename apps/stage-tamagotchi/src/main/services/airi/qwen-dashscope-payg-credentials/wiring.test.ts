import type { ElectronMainContextExtensions, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'

import { readFileSync } from 'node:fs'

import { createContext, defineInvoke } from '@moeru/eventa'
import { qwenAudioRealtimeSessionStart } from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-ipc'
import { qwen3TtsRealtimeSessionStart } from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { describe, expect, it, vi } from 'vitest'

import { createQwenAudioRealtimeAsrService } from '../qwen-audio-realtime'
import { createQwen3TtsRealtimeService } from '../qwen-tts-realtime'

vi.mock('electron', () => ({ ipcMain: {} }))

const mainSource = readFileSync(new URL('../../../index.ts', import.meta.url), 'utf8')
const asrSource = readFileSync(new URL('../qwen-audio-realtime/index.ts', import.meta.url), 'utf8')
const ttsSource = readFileSync(new URL('../qwen-tts-realtime/index.ts', import.meta.url), 'utf8')

describe('qwen PAYG credential authority wiring', () => {
  it('creates the secure main-process service from Electron userData', () => {
    expect(mainSource).toContain('setupDashScopePaygCredentials({ lifecycle: dependsOn.lifecycle })')
    expect(mainSource).toContain('services:qwen-dashscope-payg-credentials')
    expect(mainSource).toContain('qwenDashScopePaygCredentials')
  })

  it('uses the injected profile for both PAYG provider sessions', () => {
    expect(asrSource).toContain('options.credentialStore?.getRuntimeProfile()')
    expect(ttsSource).toContain('options.credentialStore?.getRuntimeProfile()')
    expect(mainSource).toContain('credentialStore: dependsOn.qwenDashScopePaygCredentials')
  })

  it('keeps shell environment resolution as explicit test/development injection only', () => {
    expect(asrSource).toContain('resolveQwenAudioRealtimeRuntimeConfig(options.environment)')
    expect(ttsSource).toContain('resolveQwenTtsRealtimeRuntimeConfig(options.environment)')
    expect(mainSource).not.toContain('DASHSCOPE_API_KEY')
  })

  it('reads the same saved profile for both providers and observes replacements before new sessions', async () => {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    let apiKey = 'unit-test-saved-first'
    const credentialStore = {
      getRuntimeProfile: vi.fn(() => ({ apiKey, workspaceId: 'saved-workspace', region: 'singapore' as const })),
    }
    const socketFactory = vi.fn(() => ({ readyState: 0, on: vi.fn(), send: vi.fn(), close: vi.fn(), terminate: vi.fn() }))
    const environment = { DASHSCOPE_API_KEY: 'unit-test-env-must-not-win', DASHSCOPE_WORKSPACE_ID: 'env-workspace', DASHSCOPE_REGION: 'beijing' }
    const asr = createQwenAudioRealtimeAsrService({ context, credentialStore, environment, socketFactory })
    const tts = createQwen3TtsRealtimeService({ context, credentialStore, environment, socketFactory })
    const startAsr = defineInvoke(context, qwenAudioRealtimeSessionStart)
    const startTts = defineInvoke(context, qwen3TtsRealtimeSessionStart)
    try {
      await startAsr({ sessionId: 'saved-asr-first', language: 'auto' })
      await startTts({ sessionId: 'saved-tts-first', voice: 'Cherry', languageType: 'Auto', mode: 'server_commit' })
      expect(socketFactory.mock.calls).toHaveLength(2)
      expect(socketFactory).toHaveBeenNthCalledWith(1, expect.stringContaining('saved-workspace.ap-southeast-1'), expect.objectContaining({ Authorization: 'Bearer unit-test-saved-first' }))
      expect(socketFactory).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ Authorization: 'Bearer unit-test-saved-first' }))

      apiKey = 'unit-test-saved-replacement'
      await startAsr({ sessionId: 'saved-asr-next', language: 'auto' })
      await startTts({ sessionId: 'saved-tts-next', voice: 'Cherry', languageType: 'Auto', mode: 'server_commit' })
      expect(credentialStore.getRuntimeProfile).toHaveBeenCalledTimes(4)
      expect(socketFactory).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({ Authorization: 'Bearer unit-test-saved-replacement' }))
      expect(socketFactory).toHaveBeenNthCalledWith(4, expect.any(String), expect.objectContaining({ Authorization: 'Bearer unit-test-saved-replacement' }))
    }
    finally {
      await asr.dispose()
      await tts.dispose()
    }
  })

  it('fails both new sessions after clear even when an injected environment contains a key', async () => {
    const context = createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>()
    const credentialStore = {
      getRuntimeProfile: vi.fn(() => {
        throw new Error('Qwen DashScope PAYG credential is not configured.')
      }),
    }
    const socketFactory = vi.fn(() => ({ readyState: 0, on: vi.fn(), send: vi.fn(), close: vi.fn() }))
    const environment = { DASHSCOPE_API_KEY: 'unit-test-env-must-not-fallback', DASHSCOPE_WORKSPACE_ID: 'env-workspace', DASHSCOPE_REGION: 'beijing' }
    const asr = createQwenAudioRealtimeAsrService({ context, credentialStore, environment, socketFactory })
    const tts = createQwen3TtsRealtimeService({ context, credentialStore, environment, socketFactory })
    try {
      await expect(defineInvoke(context, qwenAudioRealtimeSessionStart)({ sessionId: 'cleared-asr', language: 'auto' })).rejects.toThrow('credential is not configured')
      await expect(defineInvoke(context, qwen3TtsRealtimeSessionStart)({ sessionId: 'cleared-tts', voice: 'Cherry', languageType: 'Auto', mode: 'server_commit' })).rejects.toThrow('credential is not configured')
      expect(socketFactory).not.toHaveBeenCalled()
    }
    finally {
      await asr.dispose()
      await tts.dispose()
    }
  })
})
