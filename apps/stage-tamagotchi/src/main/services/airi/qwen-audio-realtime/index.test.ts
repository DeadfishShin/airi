import type { QwenAudioRealtimeSocket } from './protocol'

import { createContext, defineInvoke } from '@moeru/eventa'
import {
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionCancel,
  qwenAudioRealtimeSessionError,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionStart,
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

const runtimeEnvironment = {
  DASHSCOPE_API_KEY: 'unit-test-placeholder',
  DASHSCOPE_REGION: 'singapore',
  DASHSCOPE_WORKSPACE_ID: 'workspace-test',
}

async function settleEvents() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('qwen Audio realtime ASR main service lifecycle', () => {
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
