import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildQwenAudioRealtimePlusAudioAppendFrame,
  buildQwenAudioRealtimePlusAudioCommitFrame,
  buildQwenAudioRealtimePlusSessionUpdateFrame,
  chunkPcm,
  parsePcm16Mono16kWav,
  parseQwenAudioRealtimePlusServerMessage,
} from './protocol'

const fixture = new Uint8Array(readFileSync(new URL('../../../../../resources/token-plan-asr-capability-probe.wav', import.meta.url)))

describe('token Plan realtime-plus transcript-only probe protocol', () => {
  it('validates WAV and strips the header into 16 kHz mono PCM chunks', () => {
    const parsed = parsePcm16Mono16kWav(fixture)
    expect(parsed.sampleRate).toBe(16_000)
    expect(parsed.channels).toBe(1)
    expect(parsed.bitsPerSample).toBe(16)
    expect(parsed.pcm.byteLength).toBeGreaterThan(0)
    expect(parsed.pcm.byteLength).toBeLessThan(fixture.byteLength)
    for (const chunk of chunkPcm(parsed.pcm)) {
      expect(chunk.byteLength).toBeLessThanOrEqual(1024)
      expect(chunk.byteLength % 2).toBe(0)
    }
  })

  it('builds the exact manual event sequence without response.create', () => {
    expect(buildQwenAudioRealtimePlusSessionUpdateFrame()).toEqual({
      type: 'session.update',
      session: { modalities: ['text'], input_audio_format: 'pcm', turn_detection: null },
    })
    expect(buildQwenAudioRealtimePlusAudioAppendFrame(new Uint8Array([1, 2]))).toEqual({
      type: 'input_audio_buffer.append',
      audio: 'AQI=',
    })
    expect(buildQwenAudioRealtimePlusAudioCommitFrame()).toEqual({ type: 'input_audio_buffer.commit' })
    expect(JSON.stringify([
      buildQwenAudioRealtimePlusSessionUpdateFrame(),
      buildQwenAudioRealtimePlusAudioAppendFrame(new Uint8Array([1, 2])),
      buildQwenAudioRealtimePlusAudioCommitFrame(),
    ])).not.toContain('response.create')
  })

  it('accepts only bounded transcript events and fails closed for vendor generation', () => {
    expect(parseQwenAudioRealtimePlusServerMessage(JSON.stringify({ type: 'session.created' }))).toEqual({ type: 'session.created' })
    expect(parseQwenAudioRealtimePlusServerMessage(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'AIRI probe' }))).toEqual({ type: 'transcription.completed', transcript: 'AIRI probe' })
    expect(parseQwenAudioRealtimePlusServerMessage(JSON.stringify({ type: 'response.created' }))).toEqual({ type: 'unexpected-generation', eventType: 'response.created' })
    expect(() => parseQwenAudioRealtimePlusServerMessage('{')).toThrow()
  })
})
