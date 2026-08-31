import type { Qwen3TtsPcmAudioBuffer, Qwen3TtsPcmAudioContext, Qwen3TtsPcmAudioSource } from '@proj-airi/stage-ui/libs/speech/qwen-tts-pcm-playback'

import type { QwenTtsRealtimeSocket } from './protocol'

import { Buffer } from 'node:buffer'

import { createContext as createElectronMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { qwen3TtsRealtimeAudioDelta } from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { createStageTtsSession } from '@proj-airi/stage-ui/libs/speech/tts-session'
import { describe, expect, it, vi } from 'vitest'

import { createQwen3TtsRealtimeService } from './index'

vi.mock('electron', () => ({ ipcMain: {} }))

class FakeSocket implements QwenTtsRealtimeSocket {
  readonly sent: string[] = []
  readyState = 0
  closed = false
  terminated = false
  private readonly listeners = new Map<string, Array<(message?: unknown, detail?: unknown) => void>>()

  on(event: 'open' | 'message' | 'error' | 'close', listener: (message?: unknown, detail?: unknown) => void) {
    const callbacks = this.listeners.get(event) ?? []
    callbacks.push(listener)
    this.listeners.set(event, callbacks)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = 3
  }

  terminate() {
    this.terminated = true
    this.readyState = 3
  }

  emit(event: 'open' | 'message' | 'error' | 'close', message?: unknown, detail?: unknown) {
    if (event === 'open')
      this.readyState = 1
    for (const callback of this.listeners.get(event) ?? [])
      callback(message, detail)
  }
}

type IpcListener = (...args: unknown[]) => void

class FakeIpcMain {
  private readonly listeners = new Map<string, Set<IpcListener>>()

  on(channel: string, listener: IpcListener) {
    const listeners = this.listeners.get(channel) ?? new Set<IpcListener>()
    listeners.add(listener)
    this.listeners.set(channel, listeners)
  }

  off(channel: string, listener: IpcListener) {
    this.listeners.get(channel)?.delete(listener)
  }

  dispatch(channel: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(channel) ?? [])
      listener(...args)
  }
}

class FakeIpcRenderer {
  private readonly listeners = new Map<string, Set<IpcListener>>()

  constructor(
    private readonly main: FakeIpcMain,
    readonly sender: { id: number, isDestroyed: () => boolean, send: (channel: string, ...args: unknown[]) => void },
  ) {}

  send(channel: string, ...args: unknown[]) {
    this.main.dispatch(channel, { sender: this.sender }, ...args)
  }

  on(channel: string, listener: IpcListener) {
    const listeners = this.listeners.get(channel) ?? new Set<IpcListener>()
    listeners.add(listener)
    this.listeners.set(channel, listeners)
  }

  removeListener(channel: string, listener: IpcListener) {
    this.listeners.get(channel)?.delete(listener)
  }

  dispatch(channel: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(channel) ?? [])
      listener(...args)
  }
}

let nextSenderId = 1

function createFakeElectronIpc(main = new FakeIpcMain()) {
  const sender = {
    id: nextSenderId++,
    isDestroyed: () => false,
    send: (_channel: string, ..._args: unknown[]) => {},
  }
  const renderer = new FakeIpcRenderer(main, sender)
  sender.send = (channel, ...args) => renderer.dispatch(channel, { sender }, ...args)
  return { main, renderer }
}

class FakeAudioBuffer implements Qwen3TtsPcmAudioBuffer {
  readonly duration: number
  readonly numberOfChannels = 1

  constructor(readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate
  }

  copyToChannel(_source: Float32Array, _channelNumber: number, _bufferOffset?: number) {}
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

  createBuffer(_numberOfChannels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(length, sampleRate)
  }

  createBufferSource() {
    const source = new FakeAudioSource()
    this.sources.push(source)
    return source
  }
}

const runtimeEnvironment = {
  DASHSCOPE_API_KEY: 'unit-test-placeholder',
  DASHSCOPE_REGION: 'beijing',
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
}

function serverMessage(type: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...payload })
}

function pcmAudio(durationMs = 100) {
  return new ArrayBuffer(24_000 * durationMs / 1000 * 2)
}

async function settle() {
  for (let index = 0; index < 4; index++) {
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
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

function createHarness() {
  const ipc = createFakeElectronIpc()
  const otherIpc = createFakeElectronIpc(ipc.main)
  const mainEventa = createElectronMainContext(ipc.main as never)
  const rendererEventa = createElectronRendererContext(ipc.renderer as never)
  const otherRendererEventa = createElectronRendererContext(otherIpc.renderer as never)
  const socket = new FakeSocket()
  const service = createQwen3TtsRealtimeService({
    context: mainEventa.context,
    environment: runtimeEnvironment,
    socketFactory: () => socket,
  })
  const audioContext = new FakeAudioContext()
  const onDone = vi.fn()
  const onError = vi.fn()
  const onSpeakingChange = vi.fn()
  const pipelineFactory = vi.fn()
  const telemetry = vi.fn()
  let rendererClock = 0
  const session = createStageTtsSession({
    providerId: 'qwen3-tts-realtime',
    transport: 'bidirectional-ws',
    streaming: snapshot,
    audioContext: audioContext as unknown as BaseAudioContext,
    playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
    openIntent: () => { throw new Error('Qwen must not use the segmenter.') },
    intentOptions: () => ({}) as never,
    streamingPipelineFactory: pipelineFactory,
    hooks: { onDone, onError },
    qwenRealtime: {
      eventContext: rendererEventa.context,
      destination: audioContext.destination,
      now: () => ++rendererClock,
      onTelemetry: telemetry,
      onSpeakingChange,
    },
  })
  const dispose = async () => {
    session.cancel('test-cleanup')
    await service.dispose()
    rendererEventa.dispose()
    otherRendererEventa.dispose()
    mainEventa.dispose()
  }
  return {
    audioContext,
    dispose,
    mainEventa,
    onDone,
    onError,
    onSpeakingChange,
    otherRendererEventa,
    pipelineFactory,
    rendererEventa,
    service,
    session,
    socket,
    telemetry,
  }
}

async function prepareReadySession(harness: ReturnType<typeof createHarness>) {
  await settle()
  harness.socket.emit('open')
  harness.socket.emit('message', serverMessage('session.created', { session: { id: 'remote-session' } }))
  await settle()
  harness.session.appendText('你')
  harness.session.appendText('好')
  harness.session.appendText('，')
  harness.session.appendText('世界')
  await settle()
  harness.socket.emit('message', serverMessage('session.updated', { session: { id: 'remote-session' } }))
  await settle()
}

describe('qwen3 Stage binding fake end-to-end', () => {
  it('forwards incremental text through main, isolates audio, and drains after remote finish', async () => {
    const harness = createHarness()
    const stageLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const otherAudio: number[] = []
    const removeOtherListener = harness.otherRendererEventa.context.on(qwen3TtsRealtimeAudioDelta, (event) => {
      if (event.body)
        otherAudio.push(event.body.sequence)
    })

    try {
      await prepareReadySession(harness)
      const sentTypes = harness.socket.sent.map(frame => JSON.parse(frame) as { type: string, text?: string })
      expect(sentTypes.map(frame => frame.type)).toEqual([
        'session.update',
        'input_text_buffer.append',
        'input_text_buffer.append',
        'input_text_buffer.append',
        'input_text_buffer.append',
      ])
      expect(sentTypes.slice(1).map(frame => frame.text)).toEqual(['你', '好', '，', '世界'])
      expect(harness.pipelineFactory).not.toHaveBeenCalled()

      harness.socket.emit('message', serverMessage('response.audio.delta', {
        delta: Buffer.from(pcmAudio()).toString('base64'),
      }))
      harness.socket.emit('message', serverMessage('response.audio.delta', {
        delta: Buffer.from(pcmAudio()).toString('base64'),
      }))
      await settle()

      expect(harness.audioContext.sources).toHaveLength(2)
      expect(harness.onSpeakingChange).toHaveBeenLastCalledWith(true)
      expect(harness.audioContext.sources[1]?.starts[0]).toBeCloseTo(
        (harness.audioContext.sources[0]?.starts[0] ?? 0) + 0.1,
        6,
      )
      expect(otherAudio).toEqual([])

      harness.session.finishInput()
      await settle()
      expect(JSON.parse(harness.socket.sent.at(-1)!).type).toBe('session.finish')

      harness.socket.emit('message', serverMessage('session.finished'))
      await settle()
      expect(harness.onDone).not.toHaveBeenCalled()
      expect(harness.audioContext.sources.map(source => source.stopCount)).toEqual([0, 0])

      harness.audioContext.sources[0]?.end()
      await settle()
      expect(harness.onDone).not.toHaveBeenCalled()
      harness.audioContext.sources[1]?.end()
      await settle()
      expect(harness.onDone).toHaveBeenCalledTimes(1)
      expect(harness.onSpeakingChange).toHaveBeenLastCalledWith(false)
      expect(harness.onError).not.toHaveBeenCalled()
      const telemetry = harness.telemetry.mock.lastCall?.[0]
      expect(telemetry).toEqual(expect.objectContaining({
        s0FirstLlmText: expect.any(Number),
        s1FirstTextAppendRequested: expect.any(Number),
        s2FirstAudioEventReceived: expect.any(Number),
        s3FirstAudioScheduled: expect.any(Number),
        s4RemoteFinished: expect.any(Number),
        s5LocalPlaybackDrain: expect.any(Number),
        firstLlmTextToAudioEventMs: expect.any(Number),
        firstLlmTextToPlaybackScheduleMs: expect.any(Number),
        remoteFinishToLocalDrainMs: expect.any(Number),
      }))
      expect(stageLog).toHaveBeenCalledTimes(1)
      expect(stageLog).toHaveBeenCalledWith('[Qwen3 TTS stage] session finished', expect.objectContaining({
        sessionId: harness.session.intentId.slice(-24),
        remoteFinishToLocalDrainMs: expect.any(Number),
      }))
    }
    finally {
      stageLog.mockRestore()
      removeOtherListener()
      await harness.dispose()
    }
  })

  it('cancels local PCM before main and cannot be resurrected by later audio', async () => {
    const harness = createHarness()
    try {
      await prepareReadySession(harness)
      harness.socket.emit('message', serverMessage('response.audio.delta', {
        delta: Buffer.from(pcmAudio()).toString('base64'),
      }))
      await settle()

      harness.session.cancel('user-aborted')
      await settle()
      await harness.rendererEventa.context.emit(qwen3TtsRealtimeAudioDelta, {
        sessionId: harness.session.intentId,
        sequence: 1,
        audio: pcmAudio(),
      })

      expect(harness.audioContext.sources).toHaveLength(1)
      expect(harness.audioContext.sources[0]?.stopCount).toBe(1)
      expect(harness.socket.closed || harness.socket.terminated).toBe(true)
      expect(harness.onDone).not.toHaveBeenCalled()
      expect(harness.onError).not.toHaveBeenCalled()
    }
    finally {
      await harness.dispose()
    }
  })

  it('propagates one server error and never masks it with a later lifecycle operation', async () => {
    const harness = createHarness()
    try {
      await prepareReadySession(harness)
      harness.socket.emit('message', serverMessage('response.audio.delta', {
        delta: Buffer.from(pcmAudio()).toString('base64'),
      }))
      await settle()
      harness.socket.emit('message', serverMessage('error', {
        error: { code: 'model_error', message: 'placeholder upstream failure' },
      }))
      await settle()

      harness.session.appendText('late')
      harness.session.finishInput()
      await settle()

      expect(harness.audioContext.sources[0]?.stopCount).toBe(1)
      expect(harness.onError).toHaveBeenCalledTimes(1)
      expect(harness.onError.mock.calls[0]?.[0]?.message).toContain('model_error')
      expect(harness.onError.mock.calls[0]?.[0]?.message).toContain('placeholder upstream failure')
      expect(harness.onError.mock.calls[0]?.[0]?.message).not.toContain('session is not active')
      expect(harness.onDone).not.toHaveBeenCalled()
    }
    finally {
      await harness.dispose()
    }
  })
})
