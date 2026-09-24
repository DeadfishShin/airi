import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('qwen Token Plan ASR renderer probe bridge', () => {
  it('sends an empty request and exposes no credential, authorization, or audio payload', () => {
    const source = readFileSync(new URL('./qwen-audio-asr-token-plan-capability-probe.ts', import.meta.url), 'utf8')
    expect(source).toContain('defineInvoke(context, qwenAudioAsrTokenPlanProbe)(undefined)')
    expect(source).not.toMatch(/apiKey|Authorization|Bearer|Base64|input_audio/i)
  })
})
