import { readFileSync } from 'node:fs'

import { createVadStreamingSession } from '@proj-airi/stage-ui/libs/audio/vad-streaming-session'
import { StreamingTranscriptionConsumers } from '@proj-airi/stage-ui/stores/modules/streaming-transcription-consumers'
import { describe, expect, it, vi } from 'vitest'

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

  it('streaming_asr_single_final_chat_send_count_is_one', () => {
    const consumers = new StreamingTranscriptionConsumers()
    const chatSends: string[] = []
    consumers.register({
      consumerId: 'stage-tamagotchi:voice-input',
      onSentenceEnd: finalText => chatSends.push(finalText),
    })

    consumers.emitSentenceEnd('single final')

    expect(chatSends).toEqual(['single final'])
    expect(chatSends).toHaveLength(1)
  })

  it('streaming_asr_multi_final_chat_send_count_is_two_when_two_segment_finals_reach_direct_handoff', async () => {
    const consumers = new StreamingTranscriptionConsumers()
    const chatSends: string[] = []
    consumers.register({
      consumerId: 'stage-tamagotchi:voice-input',
      // This is the callback contract implemented by handleStreamingSentenceEnd:
      // each delivered non-empty final is sent directly to chat.
      onSentenceEnd: finalText => chatSends.push(finalText),
    })

    const providerFinals = ['final A', 'final B']
    const start = vi.fn(async () => {})
    const stop = vi.fn(async () => {
      consumers.emitSentenceEnd(providerFinals[stop.mock.calls.length - 1] ?? '')
    })
    const vadSession = createVadStreamingSession({ start, stop })

    vadSession.onSpeechStart()
    vadSession.onSpeechEnd()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    vadSession.onSpeechStart()
    vadSession.onSpeechEnd()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2))

    expect(start).toHaveBeenCalledTimes(2)
    expect(chatSends).toEqual(['final A', 'final B'])
    expect(chatSends).toHaveLength(2)
    // In the current chat contract each direct handoff is one independent
    // chatStore.send call, hence two sends imply two chat turns.
    expect(chatSends.length).toBe(2)
    await vadSession.dispose()
  })

  it('stage_direct_handoff_does_not_coalesce_duplicate_callbacks', () => {
    const consumers = new StreamingTranscriptionConsumers()
    const chatSends: string[] = []
    consumers.register({
      consumerId: 'stage-tamagotchi:voice-input',
      onSentenceEnd: finalText => chatSends.push(finalText),
    })

    consumers.emitSentenceEnd('duplicate final')
    consumers.emitSentenceEnd('duplicate final')

    expect(chatSends).toEqual(['duplicate final', 'duplicate final'])
  })
})
