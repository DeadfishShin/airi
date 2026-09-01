import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('voice transcript ingress telemetry source contract', () => {
  it('streaming_asr_direct_boundary_test keeps sentence-end on direct chat path', () => {
    const start = source.indexOf('function handleStreamingSentenceEnd')
    const end = source.indexOf('/** Replaces the caption', start)
    const streamingPath = source.slice(start, end)

    expect(streamingPath).toContain('markRealtimeVoiceAsrFinal(\'streaming-sentence-end\')')
    expect(streamingPath).toContain('sendVoiceInputTextToChat(finalText, turnId)')
    expect(streamingPath).not.toContain('voiceTranscriptBuffer')
  })

  it('buffered_recorder_1200ms_attribution_test keeps recorder finals on the existing buffer', () => {
    const start = source.indexOf('onTranscriptionResult:')
    const end = source.indexOf('onTranscriptionEmpty:', start)
    const recorderPath = source.slice(start, end)

    expect(recorderPath).toContain('markRealtimeVoiceAsrFinal(\'buffered-recorder\')')
    expect(recorderPath).toContain('voiceTranscriptBuffer.push(text)')
    expect(source).toContain('flushDelayMs: 1200')
    expect(source).toContain('maxBufferedTextLength: 90')
  })
})
