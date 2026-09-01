import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')

describe('voice transcript ingress telemetry source contract', () => {
  it('streaming_asr_direct_boundary_test routes VAD finals through the endpoint controller', () => {
    const start = source.indexOf('function handleStreamingSentenceEnd')
    const end = source.indexOf('/** Replaces the caption', start)
    const streamingPath = source.slice(start, end)

    expect(streamingPath).toContain('streamingVoiceTurnEndpoint.finalTranscript(delta)')
    expect(streamingPath).not.toContain('sendVoiceInputTextToChat(finalText, turnId)')
    expect(streamingPath).not.toContain('voiceTranscriptBuffer')
    expect(source).toContain('streamingVoiceTurnEndpoint.speechActivityStart()')
    expect(source).toContain('streamingVoiceTurnEndpoint.speechActivityEnd()')
    expect(source).toContain('sendVoiceInputTextToChat(decision.aggregatedText, decision.telemetryTurnId)')
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

  it('vad activity callbacks are distinct from text-bearing final callbacks', () => {
    expect(source).toContain('onSpeechActivityStart: handleStreamingSpeechActivityStart')
    expect(source).toContain('onSpeechActivityEnd: handleStreamingSpeechActivityEnd')
    expect(source).toContain('onSpeechActivityCancel: handleStreamingSpeechActivityCancel')
    expect(source).toContain('onSentenceEnd: handleStreamingSentenceEnd')
  })
})
