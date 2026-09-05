import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sharedSpeechSettings = readFileSync(new URL('../../modules/speech.vue', import.meta.url), 'utf8')
const qwenTtsSettings = readFileSync(new URL('./qwen3-tts-realtime.vue', import.meta.url), 'utf8')
const qwenAsrSettings = readFileSync(new URL('../transcription/qwen-audio-realtime-transcription.vue', import.meta.url), 'utf8')
const qwenLanguageSettings = readFileSync(new URL('../../../../../../stage-ui/src/libs/providers/providers/qwen-audio-realtime/hearing-settings.vue', import.meta.url), 'utf8')
const tokenPlanSettings = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')

describe('qwen DashScope PAYG settings surfaces', () => {
  it('uses one shared profile surface from global speech settings and Qwen3 PAYG TTS settings', () => {
    expect(sharedSpeechSettings).toContain('DashScopePaygCredentialSettings')
    expect(qwenTtsSettings).toContain('DashScopePaygCredentialSettings')
  })

  // https://github.com/DeadfishShin/airi/pull/2
  // ROOT CAUSE:
  // The ASR detail route exposed language settings but omitted the shared PAYG form.
  it('exposes the same PAYG component on the ASR detail route and retains language settings', () => {
    expect(qwenAsrSettings).toContain('import DashScopePaygCredentialSettings from \'../speech/DashScopePaygCredentialSettings.vue\'')
    expect(qwenAsrSettings).toContain('<DashScopePaygCredentialSettings />')
    expect(qwenAsrSettings).toContain('<QwenHearingSettings />')
    expect(qwenTtsSettings).toContain('import DashScopePaygCredentialSettings from \'./DashScopePaygCredentialSettings.vue\'')
    expect(qwenTtsSettings).toMatch(/<DashScopePaygCredentialSettings(?:\s[^>]*)?\/>/)
    expect(qwenAsrSettings).not.toMatch(/qwenDashScopePayg(?:Get|Save|Clear)Profile|type="password"|apiKey\s*=|localStorage/)
  })

  it('retains automatic, Chinese, and English ASR language choices', () => {
    expect(qwenLanguageSettings).toContain('value: \'auto\'')
    expect(qwenLanguageSettings).toContain('value: \'zh\'')
    expect(qwenLanguageSettings).toContain('value: \'en\'')
  })

  it('does not connect the Token Plan route to the PAYG profile', () => {
    expect(tokenPlanSettings).not.toContain('DashScopePaygCredentialSettings')
    expect(tokenPlanSettings).not.toMatch(/DASHSCOPE_(API_KEY|WORKSPACE_ID|REGION)/)
  })
})
