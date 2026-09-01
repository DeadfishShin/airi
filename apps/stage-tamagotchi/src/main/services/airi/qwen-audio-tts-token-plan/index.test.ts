import type { Qwen3TtsPcmAudioBuffer, Qwen3TtsPcmAudioContext, Qwen3TtsPcmAudioSource } from '@proj-airi/stage-ui/libs/speech/qwen-tts-pcm-playback'

import type { QwenAudioTtsTokenPlanSocket } from './protocol'

import { createContext, defineInvoke } from '@moeru/eventa'
import { createContext as createElectronMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import {
  qwenAudioTtsTokenPlanAudioDelta,
  qwenAudioTtsTokenPlanSessionCancel,
  qwenAudioTtsTokenPlanSessionError,
  qwenAudioTtsTokenPlanSessionFinish,
  qwenAudioTtsTokenPlanSessionFinished,
  qwenAudioTtsTokenPlanSessionReady,
  qwenAudioTtsTokenPlanSessionStart,
  qwenAudioTtsTokenPlanTextAppend,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import { createStageTtsSession } from '@proj-airi/stage-ui/libs/speech/tts-session'
import { describe, expect, it, vi } from 'vitest'

import { createQwenAudioTtsTokenPlanService } from './index'

vi.mock('electron', () => ({ ipcMain: {} }))

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

class FakeSocket implements QwenAudioTtsTokenPlanSocket {
  readonly sent: string[] = []
  readyState = 0
  closed = false
  terminated = false
  private readonly listeners = new Map<string, Array<(...args: never[]) => void>>()

  on(event: 'open', listener: () => void): void
  on(event: 'message', listener: (message: unknown, isBinary?: boolean) => void): void
  on(event: 'error', listener: (error: unknown, detail?: unknown) => void): void
  on(event: 'close', listener: (code?: number, reason?: string | Uint8Array) => void): void
  on(event: 'open' | 'message' | 'error' | 'close', listener: (...args: never[]) => void) {
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
      (callback as (message?: unknown, detail?: unknown) => void)(message, detail)
  }
}

class FakeAudioBuffer implements Qwen3TtsPcmAudioBuffer {
  readonly duration: number
  readonly numberOfChannels = 1
  readonly sampleRate = 24_000

  constructor(readonly length: number) {
    this.duration = length / this.sampleRate
  }

  copyToChannel(_source: Float32Array, _channelNumber: number, _offset?: number) {}
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

  createBuffer(_numberOfChannels: number, length: number, _sampleRate: number) {
    return new FakeAudioBuffer(length)
  }

  createBufferSource() {
    const source = new FakeAudioSource()
    this.sources.push(source)
    return source
  }
}

const tokenPlanEnvironment = {
  TOKEN_PLAN_API_KEY: 'unit-test-token-plan-key',
  DASHSCOPE_API_KEY: 'payg-key-must-not-be-read',
  DASHSCOPE_WORKSPACE_ID: 'payg-workspace-must-not-be-read',
}

const serverEvent = (event: string, extra: Record<string, unknown> = {}) => JSON.stringify({ header: { event, ...extra } })

async function settle() {
  for (let index = 0; index < 4; index++) {
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('qwen Audio Token Plan main service', () => {
  it('uses Token Plan credentials and keeps all async events in the originating renderer', async () => {
    const ipc = createFakeElectronIpc()
    const otherIpc = createFakeElectronIpc(ipc.main)
    const mainEventa = createElectronMainContext(ipc.main as never)
    const rendererA = createElectronRendererContext(ipc.renderer as never)
    const rendererB = createElectronRendererContext(otherIpc.renderer as never)
    const socket = new FakeSocket()
    const socketCalls: Array<{ endpoint: string, headers: Record<string, string> }> = []
    const diagnostics: Array<{ sessionId: string, milestone: string, details?: unknown }> = []
    const service = createQwenAudioTtsTokenPlanService({
      context: mainEventa.context,
      environment: tokenPlanEnvironment,
      onDiagnostic: (sessionId, milestone, details) => diagnostics.push({ sessionId, milestone, details }),
      socketFactory: (endpoint, headers) => {
        socketCalls.push({ endpoint, headers })
        return socket
      },
    })
    const start = defineInvoke(rendererA.context, qwenAudioTtsTokenPlanSessionStart)
    const append = defineInvoke(rendererA.context, qwenAudioTtsTokenPlanTextAppend)
    const finish = defineInvoke(rendererA.context, qwenAudioTtsTokenPlanSessionFinish)
    const received: string[] = []
    const otherReceived: string[] = []
    const removers = [
      rendererA.context.on(qwenAudioTtsTokenPlanSessionReady, () => received.push('ready')),
      rendererA.context.on(qwenAudioTtsTokenPlanAudioDelta, event => event.body && received.push(`audio:${event.body.sequence}:${event.body.audio.byteLength}`)),
      rendererA.context.on(qwenAudioTtsTokenPlanSessionFinished, () => received.push('finished')),
      rendererA.context.on(qwenAudioTtsTokenPlanSessionError, () => received.push('error')),
      rendererB.context.on(qwenAudioTtsTokenPlanAudioDelta, () => otherReceived.push('audio')),
      rendererB.context.on(qwenAudioTtsTokenPlanSessionFinished, () => otherReceived.push('finished')),
    ]

    try {
      await start({ sessionId: 'token-plan-renderer-a', voice: 'longanlingxin' })
      expect(socketCalls).toEqual([{
        endpoint: 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference',
        headers: { Authorization: 'Bearer unit-test-token-plan-key' },
      }])

      socket.emit('open')
      socket.emit('message', serverEvent('task-started'))
      await settle()
      expect(received).toContain('ready')

      await append({ sessionId: 'token-plan-renderer-a', text: '你好。' })
      expect(JSON.parse(socket.sent[0]!).header.action).toBe('run-task')
      expect(JSON.parse(socket.sent[1]!).payload.input.text).toBe('你好。')

      socket.emit('message', new Uint8Array([0, 1, 2, 3]))
      await settle()
      expect(received).toContain('audio:0:4')
      expect(otherReceived).toEqual([])

      const finishing = finish({ sessionId: 'token-plan-renderer-a' })
      expect(JSON.parse(socket.sent.at(-1)!).header.action).toBe('finish-task')
      socket.emit('message', serverEvent('task-finished'))
      await finishing
      expect(received).toContain('finished')
      expect(otherReceived).toEqual([])
      expect(diagnostics.map(diagnostic => diagnostic.milestone)).toEqual([
        'MAIN_SESSION_START_RECEIVED',
        'TOKEN_PLAN_CREDENTIAL_PRESENT',
        'SOCKET_CREATED',
        'SOCKET_OPEN',
        'RUN_TASK_SENT',
        'TASK_STARTED',
        'FIRST_CONTINUE_TASK_SENT',
        'FIRST_BINARY_AUDIO_RECEIVED',
        'FINISH_TASK_SENT',
        'TASK_FINISHED',
      ])
      const serializedDiagnostics = JSON.stringify(diagnostics)
      expect(serializedDiagnostics).not.toContain('你好')
      expect(serializedDiagnostics).not.toContain('unit-test-token-plan-key')
      expect(serializedDiagnostics).not.toContain('DASHSCOPE_API_KEY')
    }
    finally {
      for (const remove of removers)
        remove()
      await service.dispose()
      rendererA.dispose()
      rendererB.dispose()
      mainEventa.dispose()
    }
  })

  it('fails closed without Token Plan key and never falls back to PAYG', async () => {
    const context = createContext()
    let socketCreated = false
    const diagnostics: Array<{ milestone: string, details?: unknown }> = []
    const failures: Error[] = []
    const service = createQwenAudioTtsTokenPlanService({
      context: context as never,
      environment: { DASHSCOPE_API_KEY: 'payg-only' },
      onDiagnostic: (_sessionId, milestone, details) => diagnostics.push({ milestone, details }),
      onFailure: (_sessionId, error) => failures.push(error),
      socketFactory: () => {
        socketCreated = true
        return new FakeSocket()
      },
    })
    const start = defineInvoke(context, qwenAudioTtsTokenPlanSessionStart)

    await expect(start({ sessionId: 'missing-token-plan-key', voice: 'longanlingxin' })).rejects.toThrow('API key is unavailable')
    expect(socketCreated).toBe(false)
    expect(diagnostics).toEqual([
      { milestone: 'MAIN_SESSION_START_RECEIVED', details: undefined },
      { milestone: 'TOKEN_PLAN_CREDENTIAL_PRESENT', details: { credentialPresent: false } },
      { milestone: 'TASK_FAILED', details: { code: 'provider_error', message: 'Qwen Audio Token Plan TTS API key is unavailable.' } },
    ])
    expect(failures).toHaveLength(1)
    await service.dispose()
  })

  it('runs the complete Stage-to-main-to-PCM fake path and drains after remote finish', async () => {
    const ipc = createFakeElectronIpc()
    const otherIpc = createFakeElectronIpc(ipc.main)
    const mainEventa = createElectronMainContext(ipc.main as never)
    const rendererA = createElectronRendererContext(ipc.renderer as never)
    const rendererB = createElectronRendererContext(otherIpc.renderer as never)
    const socket = new FakeSocket()
    const service = createQwenAudioTtsTokenPlanService({
      context: mainEventa.context,
      environment: tokenPlanEnvironment,
      socketFactory: () => socket,
    })
    const audioContext = new FakeAudioContext()
    const onDone = vi.fn()
    const onError = vi.fn()
    const otherAudio: number[] = []
    const removeOtherAudio = rendererB.context.on(qwenAudioTtsTokenPlanAudioDelta, (event) => {
      if (event.body)
        otherAudio.push(event.body.sequence)
    })
    const session = createStageTtsSession({
      providerId: 'qwen-audio-tts-token-plan',
      transport: 'bidirectional-ws',
      streaming: () => ({
        model: 'qwen-audio-3.0-tts-plus',
        voice: 'longanlingxin',
        voiceType: 'custom_configured' as const,
        bufferEntireSession: false,
        extraBody: {},
        onImmediateSpecial: vi.fn(),
      }),
      audioContext: audioContext as unknown as BaseAudioContext,
      playbackManager: { schedule: vi.fn(), stopByIntent: vi.fn() },
      openIntent: () => { throw new Error('Token Plan must not use the segmenter.') },
      intentOptions: () => ({}) as never,
      hooks: { onDone, onError },
      qwenTokenPlan: { eventContext: rendererA.context },
    })

    try {
      session.appendText('你')
      session.appendText('好')
      session.appendText('，')
      session.appendText('世界')
      session.finishInput()
      await settle()

      socket.emit('open')
      socket.emit('message', serverEvent('task-started'))
      await settle()
      const sent = socket.sent.map(frame => JSON.parse(frame) as { header: { action: string }, payload: { input?: { text?: string } } })
      expect(sent.map(frame => frame.header.action)).toEqual([
        'run-task',
        'continue-task',
        'continue-task',
        'continue-task',
        'continue-task',
        'finish-task',
      ])
      expect(sent.slice(1, 5).map(frame => frame.payload.input?.text)).toEqual(['你', '好', '，', '世界'])

      socket.emit('message', new Uint8Array([0, 1, 2, 3]))
      socket.emit('message', new Uint8Array([4, 5, 6, 7]))
      await settle()
      expect(audioContext.sources).toHaveLength(2)
      expect(audioContext.sources[1]?.starts[0]).toBeCloseTo((audioContext.sources[0]?.starts[0] ?? 0) + 2 / 24_000, 6)
      expect(otherAudio).toEqual([])

      socket.emit('message', serverEvent('task-finished'))
      await settle()
      expect(onDone).not.toHaveBeenCalled()
      expect(audioContext.sources.map(source => source.stopCount)).toEqual([0, 0])
      audioContext.sources[0]?.end()
      await settle()
      expect(onDone).not.toHaveBeenCalled()
      audioContext.sources[1]?.end()
      await settle()
      expect(onDone).toHaveBeenCalledTimes(1)
      expect(onError).not.toHaveBeenCalled()
    }
    finally {
      removeOtherAudio()
      session.cancel('test-cleanup')
      await service.dispose()
      rendererA.dispose()
      rendererB.dispose()
      mainEventa.dispose()
    }
  })

  it('keeps task-failed details authoritative for late append and finish calls', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioTtsTokenPlanService({
      context: context as never,
      environment: tokenPlanEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioTtsTokenPlanSessionStart)
    const append = defineInvoke(context, qwenAudioTtsTokenPlanTextAppend)
    const finish = defineInvoke(context, qwenAudioTtsTokenPlanSessionFinish)
    const errors: string[] = []
    context.on(qwenAudioTtsTokenPlanSessionError, (event) => {
      if (event.body)
        errors.push(event.body.message)
    })

    await start({ sessionId: 'token-plan-error-session', voice: 'longanlingxin' })
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settle()
    socket.emit('message', serverEvent('task-failed', {
      error_code: 'invalid_voice',
      error_message: 'voice rejected',
    }))
    await settle()

    await expect(append({ sessionId: 'token-plan-error-session', text: 'late' })).rejects.toThrow('invalid_voice')
    await expect(finish({ sessionId: 'token-plan-error-session' })).rejects.toThrow('invalid_voice')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('error_code=invalid_voice')
    expect(errors[0]).not.toContain('unit-test-token-plan-key')
    await service.dispose()
  })

  it('cancels with the Token Plan directive and emits no synthetic success event', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioTtsTokenPlanService({
      context: context as never,
      environment: tokenPlanEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioTtsTokenPlanSessionStart)
    const cancel = defineInvoke(context, qwenAudioTtsTokenPlanSessionCancel)
    const finished = vi.fn()
    context.on(qwenAudioTtsTokenPlanSessionFinished, finished)

    await start({ sessionId: 'token-plan-cancel-session', voice: 'longanlingxin' })
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settle()
    await cancel({ sessionId: 'token-plan-cancel-session' })

    expect(JSON.parse(socket.sent.at(-1)!).payload.input.directive).toBe('cancel')
    expect(socket.closed || socket.terminated).toBe(true)
    expect(finished).not.toHaveBeenCalled()
    await service.dispose()
  })
})
