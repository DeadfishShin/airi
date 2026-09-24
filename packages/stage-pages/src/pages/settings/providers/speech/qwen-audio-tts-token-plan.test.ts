import { readFileSync } from 'node:fs'

import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import { describe, expect, it } from 'vitest'

describe('qwen Audio Token Plan TTS settings route', () => {
  it('resolves the provider detail component and keeps the canary surface bounded', () => {
    const routeFile = new URL('./qwen-audio-tts-token-plan.vue', import.meta.url)
    const source = readFileSync(routeFile, 'utf8')
    expect(routeFile.pathname).toContain('/settings/providers/speech/qwen-audio-tts-token-plan.vue')
    expect(QWEN_AUDIO_TTS_TOKEN_PLAN_PROVIDER_ID).toBe('qwen-audio-tts-token-plan')
    expect(QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL).toBe('qwen-audio-3.0-tts-plus')
    expect(QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID).toBe('longanlingxin')
    expect(source).toContain('<route lang="yaml">')
    expect(source).toContain('qwen-audio-tts-token-plan-api-key')
    expect(source).toContain('qwen-audio-tts-token-plan-save')
    expect(source).toContain('qwen-audio-tts-token-plan-voice')
  })

  it('uses the secure credential bridge and does not introduce REST preview behavior', async () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/SpeechPlayground|generateSpeech|\.speech\s*\(/)
    expect(source).toContain('getQwenAudioTtsTokenPlanCredentialProfile')
    expect(source).toContain('saveQwenAudioTtsTokenPlanCredential')
    expect(source).toContain('clearQwenAudioTtsTokenPlanCredential')
    expect(source).not.toMatch(/DASHSCOPE_API_KEY|TOKEN_PLAN_API_KEY\s*=/)
    expect(source).toContain('QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL')
    expect(source).not.toContain('QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID')
  })

  it('keeps directory browsing separate from the active speech selection', () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    const refreshStart = source.indexOf('async function refreshCatalog()')
    const saveStart = source.indexOf('async function save()')
    const refreshSource = source.slice(refreshStart, saveStart)

    expect(refreshSource).not.toContain('speechStore.activeSpeechProvider = ')
    expect(refreshSource).not.toContain('speechStore.activeSpeechModel = ')
    expect(refreshSource).toContain('preserveOnEmpty: true')
    expect(refreshSource).toContain('throwOnError: true')
    expect(source).toContain('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.source')
    expect(source).toContain('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.customNotQueried')
  })
})
