import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('../../../index.ts', import.meta.url), 'utf8')
const asrSource = readFileSync(new URL('../qwen-audio-realtime/index.ts', import.meta.url), 'utf8')
const ttsSource = readFileSync(new URL('../qwen-tts-realtime/index.ts', import.meta.url), 'utf8')

describe('Qwen PAYG credential authority wiring', () => {
  it('creates the secure main-process service from Electron userData', () => {
    expect(mainSource).toContain('setupDashScopePaygCredentials()')
    expect(mainSource).toContain("services:qwen-dashscope-payg-credentials")
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
})
