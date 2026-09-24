import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('qwen Token Plan model probe renderer bridge', () => {
  it('sends no credential payload and exposes only the shared result contract', () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan-models-probe.ts', import.meta.url), 'utf8')
    expect(source).toContain('qwenAudioTtsTokenPlanProbeModels)(undefined)')
    expect(source).not.toMatch(/apiKey|Authorization|Bearer/)
  })
})
