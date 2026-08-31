import type { QwenTtsRealtimeSocket } from './protocol'

import { createContext, defineInvoke } from '@moeru/eventa'
import { createContext as createElectronMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import {
  qwen3TtsRealtimeAudioDelta,
  qwen3TtsRealtimeResponseDone,
  qwen3TtsRealtimeSessionCancel,
  qwen3TtsRealtimeSessionError,
  qwen3TtsRealtimeSessionFinish,
  qwen3TtsRealtimeSessionFinished,
  qwen3TtsRealtimeSessionReady,
  qwen3TtsRealtimeSessionStart,
  qwen3TtsRealtimeStageTelemetry,
  qwen3TtsRealtimeTextAppend,
} from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { describe, expect, it, vi } from 'vitest'

import {
  createQwen3TtsRealtimeService,
  MAX_STAGE_TELEMETRY_LOGS,
  MAX_TERMINAL_ERROR_TOMBSTONES,
  TERMINAL_ERROR_TOMBSTONE_TTL_MS,
} from './index'

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

const runtimeEnvironment = {
  DASHSCOPE_API_KEY: 'unit-test-placeholder',
  DASHSCOPE_REGION: 'beijing',
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
}

async function settleEvents() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function serverMessage(type: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...payload })
}

describe('qwen3 realtime TTS main service', () => {
  it('routes ready, PCM audio, response, finish, and error events only to the originating renderer', async () => {
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
    const start = defineInvoke(rendererEventa.context, qwen3TtsRealtimeSessionStart)
    const append = defineInvoke(rendererEventa.context, qwen3TtsRealtimeTextAppend)
    const finish = defineInvoke(rendererEventa.context, qwen3TtsRealtimeSessionFinish)
    const received: string[] = []
    const otherReceived: string[] = []
    const dispose = [
      rendererEventa.context.on(qwen3TtsRealtimeSessionReady, () => received.push('ready')),
      rendererEventa.context.on(qwen3TtsRealtimeAudioDelta, (event) => {
        if (event.body)
          received.push(`audio:${event.body.sequence}:${event.body.audio.byteLength}`)
      }),
      rendererEventa.context.on(qwen3TtsRealtimeResponseDone, () => received.push('response-done')),
      rendererEventa.context.on(qwen3TtsRealtimeSessionFinished, () => received.push('finished')),
      rendererEventa.context.on(qwen3TtsRealtimeSessionError, event => event.body && received.push(`error:${event.body.code}`)),
      otherRendererEventa.context.on(qwen3TtsRealtimeAudioDelta, () => otherReceived.push('audio')),
      otherRendererEventa.context.on(qwen3TtsRealtimeSessionError, () => otherReceived.push('error')),
    ]

    await start({ sessionId: 'renderer-a-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
    socket.emit('open')
    socket.emit('message', serverMessage('session.created', { session: { id: 'server-session' } }))
    await settleEvents()
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'session.update', session: { voice: 'Cherry', language_type: 'Chinese', mode: 'server_commit' } })

    await append({ sessionId: 'renderer-a-session', text: '你好' })
    socket.emit('message', serverMessage('session.updated', { session: { id: 'server-session' } }))
    await settleEvents()
    expect(received).toContain('ready')
    expect(socket.sent.map(frame => JSON.parse(frame).type)).toEqual(['session.update', 'input_text_buffer.append'])

    socket.emit('message', serverMessage('response.audio.delta', { delta: 'AAECAw==' }))
    socket.emit('message', serverMessage('response.done', { response: { status: 'completed' } }))
    await settleEvents()
    expect(received).toContain('audio:0:4')
    expect(received).toContain('response-done')
    expect(otherReceived).toEqual([])

    const finishing = finish({ sessionId: 'renderer-a-session' })
    expect(JSON.parse(socket.sent.at(-1)!).type).toBe('session.finish')
    socket.emit('message', serverMessage('session.finished'))
    await finishing
    expect(received).toContain('finished')
    expect(otherReceived).toEqual([])

    for (const remove of dispose)
      remove()
    await service.dispose()
    rendererEventa.dispose()
    otherRendererEventa.dispose()
    mainEventa.dispose()
  })

  it('keeps an early WebSocket failure authoritative for racing append and finish calls', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwen3TtsRealtimeService({ context: context as never, environment: runtimeEnvironment, socketFactory: () => socket })
    const start = defineInvoke(context, qwen3TtsRealtimeSessionStart)
    const append = defineInvoke(context, qwen3TtsRealtimeTextAppend)
    const finish = defineInvoke(context, qwen3TtsRealtimeSessionFinish)
    const errors: Array<{ code: string, message: string }> = []
    context.on(qwen3TtsRealtimeSessionError, event => event.body && errors.push(event.body))

    await start({ sessionId: 'failed-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
    socket.emit('error', { name: 'UnexpectedResponseError', statusCode: 401, message: 'handshake rejected' })
    await settleEvents()

    await expect(append({ sessionId: 'failed-session', text: 'late text' })).rejects.toThrow('status=401')
    await expect(finish({ sessionId: 'failed-session' })).rejects.toThrow('status=401')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('status=401')
    expect(errors[0].message).not.toContain('unit-test-placeholder')
    await service.dispose()
  })

  it('propagates sanitized server error details and does not emit finished on cancel', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwen3TtsRealtimeService({ context: context as never, environment: runtimeEnvironment, socketFactory: () => socket })
    const start = defineInvoke(context, qwen3TtsRealtimeSessionStart)
    const cancel = defineInvoke(context, qwen3TtsRealtimeSessionCancel)
    const received: string[] = []
    context.on(qwen3TtsRealtimeSessionError, event => event.body && received.push(`${event.body.code}:${event.body.message}`))
    context.on(qwen3TtsRealtimeSessionFinished, () => {
      received.push('finished')
    })

    await start({ sessionId: 'server-error-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
    socket.emit('open')
    socket.emit('message', serverMessage('session.created', { session: { id: 'server-session' } }))
    await settleEvents()
    socket.emit('message', serverMessage('error', { error: { code: 'model_not_found', message: 'model unavailable' } }))
    await settleEvents()
    expect(received[0]).toContain('server_error:server_error: Qwen3 realtime TTS server error (error_code=model_not_found; error_message=model unavailable).')

    await start({ sessionId: 'cancelled-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
    await cancel({ sessionId: 'cancelled-session' })
    expect(received).not.toContain('finished')
    await service.dispose()
  })

  it('rejects a duplicate session start deterministically', async () => {
    const context = createContext()
    const sockets: FakeSocket[] = []
    const service = createQwen3TtsRealtimeService({
      context: context as never,
      environment: runtimeEnvironment,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    const start = defineInvoke(context, qwen3TtsRealtimeSessionStart)
    const cancel = defineInvoke(context, qwen3TtsRealtimeSessionCancel)

    await start({ sessionId: 'duplicate-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
    await expect(start({ sessionId: 'duplicate-session', voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })).rejects.toThrow('already exists')
    await cancel({ sessionId: 'duplicate-session' })
    expect(sockets[0].closed || sockets[0].terminated).toBe(true)
    await service.dispose()
  })

  it('bounds and expires first-failure tombstones and clears them on cancellation', async () => {
    const context = createContext()
    const sockets: FakeSocket[] = []
    let currentTime = 0
    const service = createQwen3TtsRealtimeService({
      context: context as never,
      environment: runtimeEnvironment,
      now: () => currentTime,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    const start = defineInvoke(context, qwen3TtsRealtimeSessionStart)

    for (let index = 0; index < MAX_TERMINAL_ERROR_TOMBSTONES + 1; index++) {
      await start({ sessionId: `failed-${index}`, voice: 'Cherry', languageType: 'Chinese', mode: 'server_commit' })
      sockets.at(-1)?.emit('error', new Error(`network failure ${index}`))
    }
    await settleEvents()
    expect(service.getTerminalErrorTombstoneCount()).toBe(MAX_TERMINAL_ERROR_TOMBSTONES)
    currentTime = TERMINAL_ERROR_TOMBSTONE_TTL_MS + 1
    expect(service.getTerminalErrorTombstoneCount()).toBe(0)
    await service.dispose()
  })

  it('logs one bounded renderer Stage telemetry summary and preserves signed metrics', async () => {
    const context = createContext()
    const service = createQwen3TtsRealtimeService({ context: context as never, environment: runtimeEnvironment })
    const report = defineInvoke(context, qwen3TtsRealtimeStageTelemetry)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const sessionId = `stream-${'x'.repeat(100)}`
    const payload = {
      sessionId,
      firstLlmTextToTextAppendMs: 4,
      firstLlmTextToAudioEventMs: 335,
      firstLlmTextToPlaybackScheduleMs: 336,
      firstAudioEventRelativeToInputFinishMs: -120,
      firstAudioScheduledRelativeToInputFinishMs: -119,
      remoteFinishToLocalDrainMs: 908,
    }

    await report(payload)
    await report(payload)

    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]).toEqual([
      '[Qwen3 TTS stage] session finished',
      {
        sessionId: sessionId.slice(-24),
        firstLlmTextToTextAppendMs: 4,
        firstLlmTextToAudioEventMs: 335,
        firstLlmTextToPlaybackScheduleMs: 336,
        firstAudioEventRelativeToInputFinishMs: -120,
        firstAudioScheduledRelativeToInputFinishMs: -119,
        remoteFinishToLocalDrainMs: 908,
      },
    ])
    const logged = log.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(logged)).toEqual([
      'sessionId',
      'firstLlmTextToTextAppendMs',
      'firstLlmTextToAudioEventMs',
      'firstLlmTextToPlaybackScheduleMs',
      'firstAudioEventRelativeToInputFinishMs',
      'firstAudioScheduledRelativeToInputFinishMs',
      'remoteFinishToLocalDrainMs',
    ])
    expect(logged.sessionId).toHaveLength(24)
    expect(JSON.stringify(logged)).not.toContain(sessionId)
    expect(JSON.stringify(logged)).not.toContain('unit-test-placeholder')
    expect(JSON.stringify(logged)).not.toContain('base64')
    expect(JSON.stringify(logged)).not.toContain('user token')
    expect(service.getStageTelemetryLogCount()).toBe(1)

    log.mockRestore()
    await service.dispose()
  })

  it('bounds remembered Stage telemetry session IDs', async () => {
    const context = createContext()
    const service = createQwen3TtsRealtimeService({ context: context as never, environment: runtimeEnvironment })
    const report = defineInvoke(context, qwen3TtsRealtimeStageTelemetry)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})

    for (let index = 0; index < MAX_STAGE_TELEMETRY_LOGS + 1; index++)
      await report({ sessionId: `stage-${index}`, firstAudioScheduledRelativeToInputFinishMs: index - 1 })

    expect(service.getStageTelemetryLogCount()).toBe(MAX_STAGE_TELEMETRY_LOGS)
    expect(log).toHaveBeenCalledTimes(MAX_STAGE_TELEMETRY_LOGS + 1)

    log.mockRestore()
    await service.dispose()
  })
})
