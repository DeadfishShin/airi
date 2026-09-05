import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sharedSpeechSettings = readFileSync(new URL('../../modules/speech.vue', import.meta.url), 'utf8')
const qwenTtsSettings = readFileSync(new URL('./qwen3-tts-realtime.vue', import.meta.url), 'utf8')
const tokenPlanSettings = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')

describe('Qwen DashScope PAYG settings surfaces', () => {
  it('uses one shared profile surface from global speech settings and Qwen3 PAYG TTS settings', () => {
    expect(sharedSpeechSettings).toContain('DashScopePaygCredentialSettings')
    expect(qwenTtsSettings).toContain('DashScopePaygCredentialSettings')
  })

  it('does not connect the Token Plan route to the PAYG profile', () => {
    expect(tokenPlanSettings).not.toContain('DashScopePaygCredentialSettings')
    expect(tokenPlanSettings).not.toMatch(/DASHSCOPE_(API_KEY|WORKSPACE_ID|REGION)/)
  })
})
