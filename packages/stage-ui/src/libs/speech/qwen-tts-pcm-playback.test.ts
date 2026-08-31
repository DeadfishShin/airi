import type { EventContext } from '@moeru/eventa'

import type { Qwen3TtsPcmAudioBuffer, Qwen3TtsPcmAudioContext, Qwen3TtsPcmAudioSource } from './qwen-tts-pcm-playback'

import { createContext } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  qwen3TtsRealtimeAudioDelta,
  qwen3TtsRealtimeResponseDone,
  qwen3TtsRealtimeSessionError,
  qwen3TtsRealtimeSessionFinished,
} from '../providers/qwen-tts-realtime-ipc'
import {
  createQwen3TtsPcmAudioBuffer,
  createQwen3TtsPcmPlaybackBridge,
  decodeQwen3TtsPcm16Le,
  QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE,
  QWEN3_TTS_REALTIME_SCHEDULER_LEAD_MS,
} from './qwen-tts-pcm-playback'

class FakeAudioBuffer implements Qwen3TtsPcmAudioBuffer {
  readonly duration: number
  readonly numberOfChannels = 1
  readonly sampleRate: number
  readonly channelData: Float32Array

  constructor(readonly length: number, sampleRate: number) {
    this.sampleRate = sampleRate
    this.duration = length / sampleRate
    this.channelData = new Float32Array(length)
  }

  copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0) {
    if (channelNumber !== 0)
      throw new RangeError('Fake buffer only has channel zero.')
    this.channelData.set(source, bufferOffset)
  }
}

class FakeAudioSource implements Qwen3TtsPcmAudioSource {
  buffer: Qwen3TtsPcmAudioBuffer | null = null
  onended: ((event: Event) => void) | null = null
  connected = false
  disconnected = false
  starts: number[] = []
  stopCount = 0

  connect(destination: AudioNode) {
    this.connected = true
    return destination
  }

  disconnect() {
    this.disconnected = true
  }

  start(when = 0) {
    this.starts.push(when)
  }

  stop() {
    this.stopCount++
  }

  end() {
    this.onended?.({} as Event)
  }
}

class FakeAudioContext implements Qwen3TtsPcmAudioContext {
  currentTime = 0
  destination = {} as AudioNode
  state: AudioContextState = 'running'
  resumeCount = 0
  readonly buffers: FakeAudioBuffer[] = []
  readonly sources: FakeAudioSource[] = []

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    if (numberOfChannels !== 1)
      throw new RangeError('Fake context only supports mono buffers.')
    const buffer = new FakeAudioBuffer(length, sampleRate)
    this.buffers.push(buffer)
    return buffer
  }

  createBufferSource() {
    const source = new FakeAudioSource()
    this.sources.push(source)
    return source
  }

  async resume() {
    this.resumeCount++
    this.state = 'running'
  }
}

function pcm16(...samples: number[]) {
  const audio = new ArrayBuffer(samples.length * 2)
  const view = new DataView(audio)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return audio
}

function pcmDurationMs(durationMs: number) {
  return new ArrayBuffer(Math.round(QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE * durationMs / 1000) * 2)
}

async function emitAudio(context: EventContext<undefined, { raw?: unknown }>, sessionId: string, sequence: number, audio: ArrayBuffer) {
  await context.emit(qwen3TtsRealtimeAudioDelta, { sessionId, sequence, audio })
}

describe('qwen3 realtime TTS PCM conversion', () => {
  it('maps PCM16LE samples to normalized Float32 values', () => {
    expect([...decodeQwen3TtsPcm16Le(pcm16(-32_768, 0, 32_767))]).toEqual([
      -1,
      0,
      32_767 / 32_768,
    ])
  })

  it('rejects empty, odd-length, and non-ArrayBuffer input', () => {
    expect(() => decodeQwen3TtsPcm16Le(new ArrayBuffer(0))).toThrow(/empty/)
    expect(() => decodeQwen3TtsPcm16Le(new ArrayBuffer(1))).toThrow(/odd/)
    expect(() => decodeQwen3TtsPcm16Le('not pcm')).toThrow(/ArrayBuffer/)
  })

  it('creates a mono 24 kHz AudioBuffer without encoded-audio decoding', () => {
    const context = new FakeAudioContext()
    const buffer = createQwen3TtsPcmAudioBuffer(context, pcm16(-32_768, 0, 32_767)) as FakeAudioBuffer

    expect(buffer).toMatchObject({
      numberOfChannels: 1,
      sampleRate: QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE,
      length: 3,
    })
    expect([...buffer.channelData]).toEqual([-1, 0, 32_767 / 32_768])
  })
})

describe('qwen3 realtime TTS PCM playback bridge', () => {
  it('receives IPC PCM, creates a connected source, starts promptly, and records bounded telemetry', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    let clock = 0
    const telemetry = vi.fn()
    const bridge = createQwen3TtsPcmPlaybackBridge({
      eventContext: context,
      audioContext,
      now: () => ++clock,
      onTelemetry: telemetry,
    })
    bridge.bind('session-a')

    await emitAudio(context, 'session-a', 0, pcm16(0, 1_000))

    expect(audioContext.buffers).toHaveLength(1)
    expect(audioContext.sources).toHaveLength(1)
    expect(audioContext.sources[0].connected).toBe(true)
    expect(audioContext.sources[0].starts[0]).toBeCloseTo(QWEN3_TTS_REALTIME_SCHEDULER_LEAD_MS / 1000)
    expect(bridge.telemetry()).toMatchObject({
      firstAudioEventToScheduleMs: expect.any(Number),
      scheduledAudioDurationMs: expect.closeTo(2 / QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE * 1000, 0.001),
    })
    expect(telemetry).toHaveBeenCalled()
  })

  it('schedules contiguous 100 ms chunks and recovers a late arrival without scheduling in the past', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')

    await emitAudio(context, 'session-a', 0, pcmDurationMs(100))
    await emitAudio(context, 'session-a', 1, pcmDurationMs(100))
    expect(audioContext.sources[1].starts[0]).toBeCloseTo(audioContext.sources[0].starts[0] + 0.1, 6)

    audioContext.currentTime = 1
    await emitAudio(context, 'session-a', 2, pcmDurationMs(100))
    expect(audioContext.sources[2].starts[0]).toBeCloseTo(1 + QWEN3_TTS_REALTIME_SCHEDULER_LEAD_MS / 1000, 6)
  })

  it('ignores duplicate sequences and fails closed on a gap', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const errors: Error[] = []
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext, onError: error => errors.push(error) })
    bridge.bind('session-a')

    await emitAudio(context, 'session-a', 0, pcm16(1, 2))
    await emitAudio(context, 'session-a', 0, pcm16(3, 4))
    expect(audioContext.sources).toHaveLength(1)

    await emitAudio(context, 'session-a', 2, pcm16(5, 6))
    expect(bridge.state()).toBe('failed')
    expect(errors[0]?.message).toMatch(/sequence gap/)
    expect(audioContext.sources).toHaveLength(1)
    await emitAudio(context, 'session-a', 1, pcm16(7, 8))
    expect(audioContext.sources).toHaveLength(1)
  })

  it('does not let another session affect this bridge', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')

    await emitAudio(context, 'session-b', 0, pcm16(1, 2))

    expect(audioContext.buffers).toHaveLength(0)
    expect(audioContext.sources).toHaveLength(0)
    expect(bridge.telemetry().r0AudioEventReceived).toBeUndefined()
  })

  it('resumes a suspended context once instead of per delta', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    audioContext.state = 'suspended'
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')

    await emitAudio(context, 'session-a', 0, pcm16(1, 2))
    await emitAudio(context, 'session-a', 1, pcm16(3, 4))

    expect(audioContext.resumeCount).toBe(1)
  })

  it('cancels active sources immediately and ignores later audio', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')
    await emitAudio(context, 'session-a', 0, pcm16(1, 2))
    await emitAudio(context, 'session-a', 1, pcm16(3, 4))

    bridge.cancel()
    await emitAudio(context, 'session-a', 2, pcm16(5, 6))

    expect(audioContext.sources.map(source => source.stopCount)).toEqual([1, 1])
    expect(bridge.state()).toBe('cancelled')
    expect(bridge.scheduledSourceCount()).toBe(0)
    expect(audioContext.sources).toHaveLength(2)
  })

  it('stops playback on a bound session error', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')
    await emitAudio(context, 'session-a', 0, pcm16(1, 2))

    await context.emit(qwen3TtsRealtimeSessionError, {
      sessionId: 'session-a',
      code: 'server_error',
      message: 'placeholder failure',
    })

    expect(audioContext.sources[0].stopCount).toBe(1)
    expect(bridge.state()).toBe('failed')
    await emitAudio(context, 'session-a', 1, pcm16(3, 4))
    expect(audioContext.sources).toHaveLength(1)
  })

  it('preserves scheduled tail when session.finished arrives and drains on source ended', async () => {
    const context = createContext()
    const audioContext = new FakeAudioContext()
    const bridge = createQwen3TtsPcmPlaybackBridge({ eventContext: context, audioContext })
    bridge.bind('session-a')
    await emitAudio(context, 'session-a', 0, pcm16(1, 2))

    let drained = false
    await context.emit(qwen3TtsRealtimeResponseDone, { sessionId: 'session-a' })
    expect(audioContext.sources[0].stopCount).toBe(0)
    expect(bridge.telemetry().responseDone).toBe(true)
    await context.emit(qwen3TtsRealtimeSessionFinished, { sessionId: 'session-a' })
    const drain = bridge.finish().then(() => {
      drained = true
    })

    expect(audioContext.sources[0].stopCount).toBe(0)
    expect(bridge.state()).toBe('finishing')
    expect(drained).toBe(false)

    audioContext.sources[0].end()
    await drain
    expect(drained).toBe(true)
    expect(bridge.state()).toBe('finished')
    expect(bridge.scheduledSourceCount()).toBe(0)
  })
})
