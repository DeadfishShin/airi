import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./speech.vue', import.meta.url), 'utf8')

describe('speech settings Qwen3 preview routing', () => {
  it('uses the isolated Qwen streaming controller and keeps generic providers on generateSpeech', () => {
    expect(source).toContain('createQwen3TtsStreamingPreviewController')
    expect(source).toContain('qwenStreamingPreview.start({ model: previewModel, voice: previewVoice.id, text })')
    expect(source).toContain('createQwenAudioTtsTokenPlanStageSession')
    expect(source).toContain('qwenTokenPlanStreamingPreview.start({ model, voice: voice.id, text })')
    expect(source).toContain('if (isQwenRealtimeProvider.value)')
    expect(source).toContain('if (isQwenTokenPlanProvider.value)')
    expect(source).toContain('const response = await generateSpeech({')
    expect(source).not.toContain('Realtime preview unavailable here')
  })

  it('renders an explicit Qwen action without enabling SSML for that route', () => {
    expect(source).toContain('<Qwen3RealtimeStreamingPreview')
    expect(source).toContain('@preview="generateTestSpeech"')
    expect(source).toContain(':model="normalizeQwen3TtsRealtimeModel(activeSpeechModel)"')
    expect(source).toContain(':voice="activeSpeechVoiceId"')
  })

  it('does not show PAYG credential controls while Token Plan is selected', () => {
    expect(source).toContain('const isQwenPaygTtsProvider = computed(() => activeSpeechProvider.value === QWEN3_TTS_REALTIME_PROVIDER_ID)')
    expect(source).toContain('<DashScopePaygCredentialSettings v-if="isQwenPaygTtsProvider"')
  })

  it('surfaces Token Plan and generic preview failures in the shared preview area', () => {
    expect(source).toContain('data-testid="speech-preview-error"')
    expect(source).toContain('v-if="errorMessage && !isQwenRealtimeProvider"')
    expect(source).toContain('role="alert"')
  })
})
