import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const pagePath = resolve(
  import.meta.dirname,
  '../../../../../../stage-pages/src/pages/settings/providers/speech/qwen3-tts-realtime.vue',
)

describe('qwen3 realtime TTS settings route', () => {
  it('resolves the provider detail route source with the bounded canary surface', () => {
    const source = readFileSync(pagePath, 'utf8')

    expect(source).toContain('<script setup lang="ts">')
    expect(source).toContain('<template>')
    expect(source).toContain('QWEN3_TTS_REALTIME_PROVIDER_ID')
    expect(source).toContain('initializeProvider(providerId)')
    expect(source).toContain('fetchModelsForProvider(providerId)')
    expect(source).toContain('loadVoicesForProvider(providerId, QWEN3_TTS_REALTIME_MODEL)')
    expect(source).toContain('QWEN3_TTS_REALTIME_MODEL')
    expect(source).toContain('QWEN3_TTS_REALTIME_VOICE_ID')
    expect(source).toContain('qwen3-tts-realtime-environment')
    expect(source).not.toContain('SpeechProviderSettings')
    expect(source).not.toContain('SpeechPlayground')
    expect(source).not.toContain('generateSpeech')
    expect(source).not.toContain('.speech(')
  })
})
