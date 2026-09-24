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
    expect(source).toContain('qwen-audio-tts-token-plan-refresh-account-models')
    expect(source).toContain('probeQwenAudioTtsTokenPlanModels')
    expect(source).toContain('modelCatalogAuthority')
    expect(source).toContain('voiceCatalogAuthority')
    expect(source).toContain('modelSourceLabel')
    expect(source).toContain('voiceSourceLabel')
  })

  it('uses the secure credential bridge and does not introduce REST preview behavior', async () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    expect(source).not.toMatch(/SpeechPlayground|generateSpeech|\.speech\s*\(/)
    expect(source).toContain('getQwenAudioTtsTokenPlanCredentialProfile')
    expect(source).toContain('saveQwenAudioTtsTokenPlanCredential')
    expect(source).toContain('clearQwenAudioTtsTokenPlanCredential')
    expect(source).not.toMatch(/DASHSCOPE_API_KEY|TOKEN_PLAN_API_KEY\s*=/)
    expect(source).not.toMatch(/Authorization\s*:/)
    expect(source).toContain('QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL')
    expect(source).not.toContain('QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID')
  })

  it('keeps account refresh manual and renders only its sanitized result', async () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    expect(source).toContain('@click="() => refreshAccountModels()"')
    expect(source).toContain('accountModelsResult.responseClass')
    expect(source).toContain('accountModelsResult.modelIds.length')
    expect(source).not.toContain('Probe account models')
    expect(source).not.toMatch(/onMounted\(.*probeQwenAudioTtsTokenPlanModels/s)
  })

  it('keeps the ASR capability probe manual, diagnostic-only, and sanitized', () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    expect(source).toContain('qwen-audio-asr-token-plan-capability-probe-button')
    expect(source).toContain('@click="runAsrCapabilityProbe"')
    expect(source).toContain('probeQwenAudioAsrTokenPlan')
    expect(source).toContain('asrProbeResult.responseClass')
    expect(source).not.toMatch(/onMounted\(.*probeQwenAudioAsrTokenPlan/s)
    expect(source).not.toMatch(/TOKEN_PLAN_ASR|Authorization\s*:/)
  })

  it('keeps directory browsing separate from the active speech selection', () => {
    const source = readFileSync(new URL('./qwen-audio-tts-token-plan.vue', import.meta.url), 'utf8')
    const refreshStart = source.indexOf('async function loadBundledCatalog(')
    const saveStart = source.indexOf('async function save()')
    const refreshSource = source.slice(refreshStart, saveStart)

    expect(refreshSource).not.toContain('speechStore.activeSpeechProvider = ')
    expect(refreshSource).not.toContain('speechStore.activeSpeechModel = ')
    expect(refreshSource).toContain('preserveOnEmpty: true')
    expect(refreshSource).toContain('throwOnError: true')
    expect(source).toContain('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.source')
    expect(source).toContain('useAccountModelBundledVoiceAuthorities')
    expect(source).toContain('settings.pages.providers.speech.qwen-audio-tts-token-plan.catalog.customNotQueried')
  })
})
