import type { EventContext } from '@moeru/eventa'

import type { Qwen3TtsPcmAudioBuffer, Qwen3TtsPcmAudioContext, Qwen3TtsPcmAudioSource } from './qwen-tts-pcm-playback'
import type { StreamingSessionSnapshot } from './tts-session'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import {
  qwenAudioTtsTokenPlanAudioDelta,
  qwenAudioTtsTokenPlanSessionCancel,
  qwenAudioTtsTokenPlanSessionError,
  qwenAudioTtsTokenPlanSessionFinish,
  qwenAudioTtsTokenPlanSessionFinished,
  qwenAudioTtsTokenPlanSessionStart,
  qwenAudioTtsTokenPlanTextAppend,
} from '../providers/qwen-audio-tts-token-plan-ipc'
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
  readonly starts: number[] = []
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

function snapshot(): StreamingSessionSnapshot {
  return {
    model: 'qwen-audio-3.0-tts-plus',
    voice: 'longanlingxin',
    voiceType: 'custom_configured',
    bufferEntireSession: false,
    extraBody: {},
    onImmediateSpecial: vi.fn(),
  }
}

function pcm16(sampleCount = 2) {
  return new ArrayBuffer(sampleCount * 2)
}

async function settle() {
  for (let index = 0; index < 4; index++) {
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function createSessionHarness() {
  const context = createContext()
  const audioContext = new FakeAudioContext()
  const calls: { start: number, text: string[], finish: number, cancel: number } = { start: 0, text: [], finish: 0, cancel: 0 }
  const onDone = vi.fn()
  const onError = vi.fn()
  const onSpeakingChange = vi.fn()

  defineInvokeHandler(context, qwenAudioTtsTokenPlanSessionStart, () => {
    calls.start++
  })
  defineInvokeHandler(context, qwenAudioTtsTokenPlanTextAppend, async (payload) => {
    calls.text.push(payload.text)
    await Promise.resolve()
  })
  defineInvokeHandler(context, qwenAudioTtsTokenPlanSessionFinish, () => {
    calls.finish++
  })
  defineInvokeHandler(context, qwenAudioTtsTokenPlanSessionCancel, () => {
    calls.cancel++
  })

  const session = createStageTtsSession({
    providerId: 'qwen-audio-tts-token-plan',
    transport: 'bidirectional-ws',
    streaming: snapshot,
    audioContext: audioContext as unknown as BaseAudioContext,
    playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
    openIntent: () => { throw new Error('Token Plan must not use the segmenter.') },
    intentOptions: () => ({}) as never,
    hooks: { onDone, onError },
    qwenTokenPlan: { eventContext: context as unknown as EventContext<any, any>, onSpeakingChange },
  })

  return { context, audioContext, calls, onDone, onError, onSpeakingChange, session }
}

describe('token Plan Qwen Audio TTS Stage adapter', () => {
  it('selects the route-specific adapter, preserves raw text order, and finishes after appends', async () => {
    const harness = createSessionHarness()
    harness.session.appendText('你')
    harness.session.appendText('好')
    harness.session.appendText('，')
    harness.session.appendText('世界')
    harness.session.finishInput()
    await settle()

    expect(harness.calls).toEqual({ start: 1, text: ['你', '好', '，', '世界'], finish: 1, cancel: 0 })
  })

  it('delivers binary PCM to the real bridge and waits for local drain after task-finished', async () => {
    const harness = createSessionHarness()
    await settle()

    await harness.context.emit(qwenAudioTtsTokenPlanAudioDelta, {
      sessionId: harness.session.intentId,
      sequence: 0,
      audio: pcm16(),
    })
    await harness.context.emit(qwenAudioTtsTokenPlanSessionFinished, { sessionId: harness.session.intentId })
    await settle()

    expect(harness.audioContext.sources).toHaveLength(1)
    expect(harness.onDone).not.toHaveBeenCalled()
    expect(harness.audioContext.sources[0]?.stopCount).toBe(0)

    harness.audioContext.sources[0]?.end()
    await settle()
    expect(harness.onDone).toHaveBeenCalledTimes(1)
    expect(harness.onError).not.toHaveBeenCalled()
  })

  it('keeps the shared speaking state active until the local Token Plan tail drains', async () => {
    const harness = createSessionHarness()
    await settle()
    await harness.context.emit(qwenAudioTtsTokenPlanAudioDelta, {
      sessionId: harness.session.intentId,
      sequence: 0,
      audio: pcm16(),
    })
    expect(harness.onSpeakingChange).toHaveBeenLastCalledWith(true)

    await harness.context.emit(qwenAudioTtsTokenPlanSessionFinished, { sessionId: harness.session.intentId })
    await settle()
    expect(harness.onSpeakingChange).not.toHaveBeenLastCalledWith(false)

    harness.audioContext.sources[0]?.end()
    await settle()
    expect(harness.onSpeakingChange).toHaveBeenLastCalledWith(false)
  })

  it('cancels local playback immediately and ignores later Token Plan audio', async () => {
    const harness = createSessionHarness()
    await settle()
    await harness.context.emit(qwenAudioTtsTokenPlanAudioDelta, {
      sessionId: harness.session.intentId,
      sequence: 0,
      audio: pcm16(),
    })

    harness.session.cancel('test')
    await settle()
    await harness.context.emit(qwenAudioTtsTokenPlanAudioDelta, {
      sessionId: harness.session.intentId,
      sequence: 1,
      audio: pcm16(),
    })

    expect(harness.audioContext.sources).toHaveLength(1)
    expect(harness.audioContext.sources[0]?.stopCount).toBe(1)
    expect(harness.calls.cancel).toBe(1)
    expect(harness.onDone).not.toHaveBeenCalled()
    expect(harness.onError).not.toHaveBeenCalled()
  })

  it('keeps the first Token Plan server error authoritative', async () => {
    const harness = createSessionHarness()
    await settle()
    await harness.context.emit(qwenAudioTtsTokenPlanSessionError, {
      sessionId: harness.session.intentId,
      code: 'server_error',
      message: 'error_code=invalid_model; error_message=model unavailable',
    })
    await settle()
    harness.session.appendText('late')
    harness.session.finishInput()
    await settle()

    expect(harness.onError).toHaveBeenCalledTimes(1)
    expect(harness.onError.mock.calls[0]?.[0].message).toContain('invalid_model')
    expect(harness.onDone).not.toHaveBeenCalled()
  })
})
