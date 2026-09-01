import type { EventContext } from '@moeru/eventa'

import type { Qwen3TtsPcmAudioBuffer, Qwen3TtsPcmAudioContext, Qwen3TtsPcmAudioSource } from './qwen-tts-pcm-playback'
import type { Qwen3TtsStageSessionTelemetry } from './qwen-tts-stage-session'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  qwen3TtsRealtimeAudioDelta,
  qwen3TtsRealtimeSessionCancel,
  qwen3TtsRealtimeSessionFinish,
  qwen3TtsRealtimeSessionFinished,
  qwen3TtsRealtimeSessionStart,
  qwen3TtsRealtimeStageTelemetry,
  qwen3TtsRealtimeTextAppend,
} from '../providers/qwen-tts-realtime-ipc'
import { summarizeQwen3TtsStageTelemetry } from './qwen-tts-stage-session'
import { createStageTtsSession } from './tts-session'

class FakeAudioBuffer implements Qwen3TtsPcmAudioBuffer {
  readonly duration: number
  readonly numberOfChannels = 1
  readonly channelData: Float32Array

  constructor(readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate
    this.channelData = new Float32Array(length)
  }

  copyToChannel(source: Float32Array, channelNumber: number, offset = 0) {
    if (channelNumber !== 0)
      throw new RangeError('Only channel zero is supported.')
    this.channelData.set(source, offset)
  }
}

class FakeAudioSource implements Qwen3TtsPcmAudioSource {
  buffer: Qwen3TtsPcmAudioBuffer | null = null
  onended: ((event: Event) => void) | null = null
  starts: number[] = []
  stopCount = 0

  connect(destination: AudioNode) {
    return destination
  }

  disconnect() {}

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
  readonly sources: FakeAudioSource[] = []

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(length, sampleRate)
  }

  createBufferSource() {
    const source = new FakeAudioSource()
    this.sources.push(source)
    return source
  }
}

function snapshot() {
  return {
    model: 'qwen3-tts-flash-realtime',
    voice: 'Cherry',
    voiceType: 'custom_configured' as const,
    bufferEntireSession: false,
    extraBody: {},
    onImmediateSpecial: vi.fn(),
  }
}

function pcm16Samples(sampleCount: number) {
  return new ArrayBuffer(sampleCount * 2)
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function eventContext() {
  return createContext() as EventContext<any, any>
}

describe('qwen3 Stage TTS adapter', () => {
  it('is selected by explicit provider identity and serializes raw LLM chunks before finish', async () => {
    const context = eventContext()
    const starts: unknown[] = []
    const texts: string[] = []
    let finishCount = 0
    defineInvokeHandler(context, qwen3TtsRealtimeSessionStart, (payload) => {
      starts.push(payload)
    })
    defineInvokeHandler(context, qwen3TtsRealtimeTextAppend, (payload) => {
      texts.push(payload.text)
    })
    defineInvokeHandler(context, qwen3TtsRealtimeSessionFinish, () => {
      finishCount++
    })
    const pipelineFactory = vi.fn()

    const session = createStageTtsSession({
      providerId: 'qwen3-tts-realtime',
      transport: 'bidirectional-ws',
      streaming: snapshot,
      audioContext: new FakeAudioContext() as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => {
        throw new Error('Qwen must not open the segmenter intent.')
      },
      intentOptions: () => ({ ownerId: 'card', priority: 'normal', behavior: 'queue' } as never),
      streamingPipelineFactory: pipelineFactory,
      qwenRealtime: { eventContext: context },
    })

    session.appendText('你')
    session.appendText('好')
    session.appendText('，')
    session.appendText('世界')
    session.finishInput()
    await flush()

    expect(starts).toHaveLength(1)
    expect(texts).toEqual(['你', '好', '，', '世界'])
    expect(finishCount).toBe(1)
    expect(pipelineFactory).not.toHaveBeenCalled()
  })

  it('records a negative first-audio overlap when audio arrives before input finish', async () => {
    const context = eventContext()
    let finishCount = 0
    let clock = 0
    let latestTelemetry: Qwen3TtsStageSessionTelemetry = {}
    defineInvokeHandler(context, qwen3TtsRealtimeSessionStart, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeTextAppend, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeSessionFinish, () => {
      finishCount++
    })
    const session = createStageTtsSession({
      providerId: 'qwen3-tts-realtime',
      transport: 'bidirectional-ws',
      streaming: snapshot,
      audioContext: new FakeAudioContext() as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => { throw new Error('segmenter path used') },
      intentOptions: () => ({}) as never,
      qwenRealtime: {
        eventContext: context,
        now: () => clock,
        onTelemetry: (telemetry) => {
          latestTelemetry = telemetry
        },
      },
    })

    await flush()
    clock = 100
    session.appendText('first')
    await flush()
    clock = 200
    await context.emit(qwen3TtsRealtimeAudioDelta, {
      sessionId: session.intentId,
      sequence: 0,
      audio: pcm16Samples(2),
    })
    clock = 300
    session.finishInput()
    session.finishInput()
    await flush()

    expect(latestTelemetry.inputFinishRequestedAt).toBe(300)
    expect(latestTelemetry.firstAudioEventRelativeToInputFinishMs).toBe(-100)
    expect(latestTelemetry.firstAudioScheduledRelativeToInputFinishMs).toBeLessThan(0)
    expect(finishCount).toBe(1)
    session.cancel('test-cleanup')
  })

  it('records a positive first-audio overlap when input finish precedes audio', async () => {
    const context = eventContext()
    let clock = 0
    let latestTelemetry: Qwen3TtsStageSessionTelemetry = {}
    defineInvokeHandler(context, qwen3TtsRealtimeSessionStart, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeTextAppend, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeSessionFinish, () => {})
    const session = createStageTtsSession({
      providerId: 'qwen3-tts-realtime',
      transport: 'bidirectional-ws',
      streaming: snapshot,
      audioContext: new FakeAudioContext() as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => { throw new Error('segmenter path used') },
      intentOptions: () => ({}) as never,
      qwenRealtime: {
        eventContext: context,
        now: () => clock,
        onTelemetry: (telemetry) => {
          latestTelemetry = telemetry
        },
      },
    })

    await flush()
    clock = 100
    session.appendText('first')
    await flush()
    clock = 300
    session.finishInput()
    await flush()
    clock = 400
    await context.emit(qwen3TtsRealtimeAudioDelta, {
      sessionId: session.intentId,
      sequence: 0,
      audio: pcm16Samples(2),
    })

    expect(latestTelemetry.inputFinishRequestedAt).toBe(300)
    expect(latestTelemetry.firstAudioEventRelativeToInputFinishMs).toBe(100)
    expect(latestTelemetry.firstAudioScheduledRelativeToInputFinishMs).toBeGreaterThan(0)
    session.cancel('test-cleanup')
  })

  it('provides one bounded success summary only after remote finish and local drain', () => {
    const telemetry = {
      s4RemoteFinished: 400,
      s5LocalPlaybackDrain: 500,
      firstLlmTextToTextAppendMs: 2,
      firstLlmTextToAudioEventMs: 20,
      firstLlmTextToPlaybackScheduleMs: 21,
      firstAudioEventRelativeToInputFinishMs: -100,
      firstAudioScheduledRelativeToInputFinishMs: -99,
      remoteFinishToLocalDrainMs: 100,
    }

    expect(summarizeQwen3TtsStageTelemetry('stream-long-session-id', telemetry)).toEqual({
      sessionId: 'stream-long-session-id',
      firstLlmTextToTextAppendMs: 2,
      firstLlmTextToAudioEventMs: 20,
      firstLlmTextToPlaybackScheduleMs: 21,
      firstAudioEventRelativeToInputFinishMs: -100,
      firstAudioScheduledRelativeToInputFinishMs: -99,
      remoteFinishToLocalDrainMs: 100,
    })
    expect(summarizeQwen3TtsStageTelemetry('failed-session', { s4RemoteFinished: 400 })).toBeUndefined()
    expect(JSON.stringify(telemetry)).not.toContain('user token')
  })

  it('keeps remote finish separate from local PCM drain and completes once', async () => {
    const context = eventContext()
    defineInvokeHandler(context, qwen3TtsRealtimeSessionStart, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeSessionFinish, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeTextAppend, () => {})
    const stageSummaries: unknown[] = []
    defineInvokeHandler(context, qwen3TtsRealtimeStageTelemetry, (payload) => {
      stageSummaries.push(payload)
    })
    const audioContext = new FakeAudioContext()
    const onDone = vi.fn()
    const onError = vi.fn()
    const session = createStageTtsSession({
      providerId: 'qwen3-tts-realtime',
      transport: 'bidirectional-ws',
      streaming: snapshot,
      audioContext: audioContext as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => { throw new Error('segmenter path used') },
      intentOptions: () => ({}) as never,
      hooks: { onDone, onError },
      qwenRealtime: { eventContext: context },
    })

    await flush()
    await context.emit(qwen3TtsRealtimeAudioDelta, {
      sessionId: session.intentId,
      sequence: 0,
      audio: pcm16Samples(2),
    })
    await context.emit(qwen3TtsRealtimeSessionFinished, { sessionId: session.intentId })
    await flush()

    expect(onDone).not.toHaveBeenCalled()
    expect(audioContext.sources[0]?.stopCount).toBe(0)
    audioContext.sources[0]?.end()
    await flush()

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    await flush()
    expect(stageSummaries).toHaveLength(1)
    expect(stageSummaries[0]).toMatchObject({
      sessionId: session.intentId,
      remoteFinishToLocalDrainMs: expect.any(Number),
    })
  })

  it('cancels local audio before the remote cancellation invoke and ignores later events', async () => {
    const context = eventContext()
    const cancellations: string[] = []
    defineInvokeHandler(context, qwen3TtsRealtimeSessionStart, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeTextAppend, () => {})
    defineInvokeHandler(context, qwen3TtsRealtimeSessionCancel, (payload) => {
      cancellations.push(payload.sessionId)
    })
    const audioContext = new FakeAudioContext()
    const session = createStageTtsSession({
      providerId: 'qwen3-tts-realtime',
      transport: 'bidirectional-ws',
      streaming: snapshot,
      audioContext: audioContext as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => { throw new Error('segmenter path used') },
      intentOptions: () => ({}) as never,
      qwenRealtime: { eventContext: context },
    })

    await flush()
    await context.emit(qwen3TtsRealtimeAudioDelta, {
      sessionId: session.intentId,
      sequence: 0,
      audio: pcm16Samples(2),
    })
    session.cancel('user-aborted')
    await flush()
    await context.emit(qwen3TtsRealtimeAudioDelta, {
      sessionId: session.intentId,
      sequence: 1,
      audio: pcm16Samples(2),
    })

    expect(audioContext.sources).toHaveLength(1)
    expect(audioContext.sources[0]?.stopCount).toBe(1)
    expect(cancellations).toEqual([session.intentId])
  })
})
