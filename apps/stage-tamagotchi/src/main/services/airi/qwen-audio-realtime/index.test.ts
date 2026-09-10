import type { QwenAudioRealtimeSocket } from './protocol'

import { createContext, defineInvoke } from '@moeru/eventa'
import { createContext as createElectronMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import {
  QWEN_AUDIO_REALTIME_ASR_MODEL,
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionCancel,
  qwenAudioRealtimeSessionError,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionStart,
  qwenAudioRealtimeTranscriptionFinal,
  qwenAudioRealtimeTranscriptionPartial,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-ipc'
import { describe, expect, it, vi } from 'vitest'

import {
  createQwenAudioRealtimeAsrService,
  QWEN_MAX_TERMINAL_ERROR_TOMBSTONES,
  QWEN_TERMINAL_ERROR_TOMBSTONE_TTL_MS,
} from './index'
import { QWEN_ASR_SAMPLE_RATE } from './protocol'

vi.mock('electron', () => ({ ipcMain: {} }))

class FakeSocket implements QwenAudioRealtimeSocket {
  readonly sent: Array<string | Uint8Array> = []
  readyState = 1
  private readonly listeners = new Map<string, Array<(message?: unknown, detail?: unknown) => void>>()

  on(event: 'open' | 'message' | 'error' | 'close', listener: (message?: unknown, detail?: unknown) => void) {
    const callbacks = this.listeners.get(event) ?? []
    callbacks.push(listener)
    this.listeners.set(event, callbacks)
  }

  send(data: string | Uint8Array) {
    this.sent.push(data)
  }

  close() {}

  emit(event: 'open' | 'message' | 'error' | 'close', message?: unknown, detail?: unknown) {
    for (const listener of this.listeners.get(event) ?? [])
      listener(message, detail)
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

let nextFakeSenderId = 1

function createFakeElectronIpc(main = new FakeIpcMain()) {
  const sender = {
    id: nextFakeSenderId++,
    isDestroyed: () => false,
    send: (_channel: string, ..._args: unknown[]) => {},
  }
  const renderer = new FakeIpcRenderer(main, sender)
  sender.send = (channel, ...args) => renderer.dispatch(channel, { sender }, ...args)
  return { main, renderer }
}

const runtimeEnvironment = {
  DASHSCOPE_API_KEY: 'unit-test-placeholder',
  DASHSCOPE_REGION: 'singapore',
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
}

async function settleEvents() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('qwen Audio realtime ASR main service lifecycle', () => {
  it('delivers session results to the renderer that started the session', async () => {
    const ipc = createFakeElectronIpc()
    const otherIpc = createFakeElectronIpc(ipc.main)
    const mainEventa = createElectronMainContext(ipc.main as never)
    const rendererEventa = createElectronRendererContext(ipc.renderer as never)
    const otherRendererEventa = createElectronRendererContext(otherIpc.renderer as never)
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: mainEventa.context,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(rendererEventa.context, qwenAudioRealtimeSessionStart)
    const received: string[] = []
    const otherReceived: string[] = []
    const disposePartial = rendererEventa.context.on(qwenAudioRealtimeTranscriptionPartial, (event) => {
      if (event.body)
        received.push(`partial:${event.body.text}`)
    })
    const disposeFinal = rendererEventa.context.on(qwenAudioRealtimeTranscriptionFinal, (event) => {
      if (event.body)
        received.push(`final:${event.body.text}`)
    })
    const disposeOther = otherRendererEventa.context.on(qwenAudioRealtimeTranscriptionPartial, (event) => {
      if (event.body)
        otherReceived.push(event.body.text)
    })

    await start({ language: 'auto', sessionId: 'renderer-session' })
    socket.emit('open')
    expect(JSON.parse(socket.sent[0] as string).payload.model).toBe(QWEN_AUDIO_REALTIME_ASR_MODEL)
    socket.emit('message', JSON.stringify({
      header: { event: 'task-started', task_id: 'renderer-session' },
      payload: {},
    }))
    socket.emit('message', JSON.stringify({
      header: { event: 'result-generated', task_id: 'renderer-session' },
      payload: {
        output: {
          sentence: {
            begin_time: 0,
            end_time: 100,
            sentence_end: false,
            sentence_id: 1,
            text: '你好',
          },
        },
      },
    }))
    socket.emit('message', JSON.stringify({
      header: { event: 'result-generated', task_id: 'renderer-session' },
      payload: {
        output: {
          sentence: {
            begin_time: 0,
            end_time: 200,
            sentence_end: true,
            sentence_id: 1,
            text: '你好世界',
          },
        },
      },
    }))
    socket.emit('message', JSON.stringify({
      header: { event: 'task-finished', task_id: 'renderer-session' },
      payload: {},
    }))
    await settleEvents()

    expect(received).toEqual(['partial:你好', 'partial:你好世界', 'final:你好世界'])
    expect(otherReceived).toEqual([])

    disposePartial()
    disposeFinal()
    disposeOther()
    await service.dispose()
    rendererEventa.dispose()
    otherRendererEventa.dispose()
    mainEventa.dispose()
  })

  it('keeps the first websocket error authoritative when audio append races teardown', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)
    const append = defineInvoke(context, qwenAudioRealtimeAudioAppend)
    const errors: Array<{ code: string, message: string }> = []
    context.on(qwenAudioRealtimeSessionError, (event) => {
      if (event.body)
        errors.push(event.body)
    })

    await start({ language: 'auto', sessionId: 'session-1' })
    socket.emit('error', new Error('handshake failed'))

    await expect(append({
      audio: new ArrayBuffer(4),
      sessionId: 'session-1',
    })).rejects.toThrow('websocket_error')
    expect(errors[0]?.code).toBe('websocket_error')
    expect(errors[0]?.message).toContain('handshake failed')

    await service.dispose()
  })

  it('propagates the selected allowlisted model into the main-process run-task frame', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)

    await start({ language: 'zh', model: QWEN_AUDIO_REALTIME_ASR_MODEL, sessionId: 'selected-model-session' })
    socket.emit('open')

    expect(JSON.parse(socket.sent[0] as string).payload).toMatchObject({
      model: QWEN_AUDIO_REALTIME_ASR_MODEL,
      parameters: { language_hints: ['zh'] },
    })

    await service.dispose()
  })

  it('rejects an unsupported model before the provider socket is created', async () => {
    const context = createContext()
    const socketFactory = vi.fn(() => new FakeSocket())
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)

    await expect(start({
      language: 'auto',
      model: 'qwen3-asr-flash-realtime' as never,
      sessionId: 'unsupported-model-session',
    })).rejects.toThrow('Unsupported Qwen Audio realtime ASR model.')
    expect(socketFactory).not.toHaveBeenCalled()

    await service.dispose()
  })

  it('keeps the same first failure for a racing finish invoke', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)
    const finish = defineInvoke(context, qwenAudioRealtimeSessionFinish)

    await start({ language: 'auto', sessionId: 'session-1' })
    socket.emit('error', { code: 'ECONNRESET', message: 'socket reset by peer' })

    await expect(finish({ sessionId: 'session-1' })).rejects.toThrow('websocket_error')
    await service.dispose()
  })

  it('bounds terminal failures and expires them without retaining audio or credentials', async () => {
    const context = createContext()
    const sockets: FakeSocket[] = []
    let currentTime = 0
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      now: () => currentTime,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)

    for (let index = 0; index < QWEN_MAX_TERMINAL_ERROR_TOMBSTONES + 1; index++) {
      await start({ language: 'auto', sessionId: `session-${index}` })
      sockets.at(-1)?.emit('error', new Error(`network failure ${index}`))
    }

    expect(service.getTerminalErrorTombstoneCount()).toBe(QWEN_MAX_TERMINAL_ERROR_TOMBSTONES)
    currentTime = QWEN_TERMINAL_ERROR_TOMBSTONE_TTL_MS + 1
    expect(service.getTerminalErrorTombstoneCount()).toBe(0)

    await service.dispose()
  })

  it('cleans a failed session tombstone when cancellation completes its lifecycle', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)
    const cancel = defineInvoke(context, qwenAudioRealtimeSessionCancel)

    await start({ language: 'auto', sessionId: 'session-1' })
    socket.emit('error', new Error('network failure'))
    await cancel({ sessionId: 'session-1' })

    expect(service.getTerminalErrorTombstoneCount()).toBe(0)
    await service.dispose()
  })

  it('leaves the normal streaming lifecycle and pre-start PCM path intact', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeAsrService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeSessionStart)
    const append = defineInvoke(context, qwenAudioRealtimeAudioAppend)
    const finish = defineInvoke(context, qwenAudioRealtimeSessionFinish)

    await start({ language: 'auto', sessionId: 'session-1' })
    socket.emit('open')
    await append({ audio: new Uint8Array(QWEN_ASR_SAMPLE_RATE / 100).buffer, sessionId: 'session-1' })
    socket.emit('message', JSON.stringify({
      header: { event: 'task-started', task_id: 'session-1' },
      payload: {},
    }))
    await settleEvents()
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent[1]).toBeInstanceOf(Uint8Array)

    const finishing = finish({ sessionId: 'session-1' })
    socket.emit('message', JSON.stringify({
      header: { event: 'task-finished', task_id: 'session-1' },
      payload: {},
    }))
    await finishing
    expect(service.sessions.size).toBe(0)
    expect(service.getTerminalErrorTombstoneCount()).toBe(0)

    await service.dispose()
  })
})
