import type { QwenAudioRealtimePlusTokenPlanSocket } from '../qwen-audio-realtime-plus-token-plan-transcript-probe/protocol'

import { createContext, defineInvoke } from '@moeru/eventa'
import {
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL,
  qwenAudioRealtimeTokenPlanAudioAppend,
  qwenAudioRealtimeTokenPlanSessionFinish,
  qwenAudioRealtimeTokenPlanSessionFinished,
  qwenAudioRealtimeTokenPlanSessionStart,
  qwenAudioRealtimeTokenPlanTranscription,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-token-plan-ipc'
import { describe, expect, it, vi } from 'vitest'

import {
  createQwenAudioRealtimeTokenPlanAsrService,
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ENDPOINT,
} from './index'

vi.mock('electron', () => ({ ipcMain: {} }))

class FakeSocket implements QwenAudioRealtimePlusTokenPlanSocket {
  readyState = 0
  readonly sent: string[] = []
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  on = ((event: 'open' | 'message' | 'error' | 'close', listener: (...args: unknown[]) => void) => {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }) as QwenAudioRealtimePlusTokenPlanSocket['on']

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  emit(event: 'open' | 'message' | 'error' | 'close', ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? [])
      listener(...args)
  }
}

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('qwen Audio realtime Token Plan ASR main service', () => {
  it('keeps the credential in main and routes one utterance to transcript-only output', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const socketFactory = vi.fn((endpoint: string, headers: Record<string, string>) => {
      expect(endpoint).toBe(QWEN_AUDIO_REALTIME_TOKEN_PLAN_ENDPOINT)
      expect(headers).toEqual({ Authorization: 'Bearer sk-sp-unit-test' })
      return socket
    })
    const service = createQwenAudioRealtimeTokenPlanAsrService({
      context: context as never,
      credentialStore: { getRuntimeProfile: () => ({ apiKey: 'sk-sp-unit-test' }) },
      socketFactory,
    })
    const start = defineInvoke(context, qwenAudioRealtimeTokenPlanSessionStart)
    const append = defineInvoke(context, qwenAudioRealtimeTokenPlanAudioAppend)
    const finish = defineInvoke(context, qwenAudioRealtimeTokenPlanSessionFinish)
    const transcripts: Array<{ text: string, isFinal: boolean }> = []
    const finished: string[] = []
    const disposeTranscript = context.on(qwenAudioRealtimeTokenPlanTranscription, (event) => {
      if (event.body)
        transcripts.push(event.body)
    })
    const disposeFinished = context.on(qwenAudioRealtimeTokenPlanSessionFinished, (event) => {
      if (event.body)
        finished.push(event.body.sessionId)
    })

    await start({ model: QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL, language: 'zh', sessionId: 'session-1' })
    socket.readyState = 1
    socket.emit('open')
    socket.emit('message', JSON.stringify({ type: 'session.created' }))
    socket.emit('message', JSON.stringify({ type: 'session.updated' }))
    await settle()
    await append({ sessionId: 'session-1', audio: new Uint8Array([1, 2, 3, 4]).buffer })
    const finishing = finish({ sessionId: 'session-1' })
    socket.emit('message', JSON.stringify({ type: 'input_audio_buffer.committed', event_id: 'commit-1', item_id: 'item-1' }))
    socket.emit('message', JSON.stringify({ type: 'conversation.item.created', item: { id: 'item-1', type: 'message', role: 'user', content: [{ type: 'input_audio' }] } }))
    socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item-1', content_index: 0, text: '你好', stash: '' }))
    socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', content_index: 0, transcript: '你好，世界' }))
    await finishing
    await settle()

    const sent = socket.sent.map(frame => JSON.parse(frame) as Record<string, unknown>)
    expect(socketFactory).toHaveBeenCalledTimes(1)
    expect(sent.some(frame => frame.type === 'response.create')).toBe(false)
    expect(sent.at(-1)).toEqual({ type: 'input_audio_buffer.commit' })
    expect(transcripts).toEqual([
      { sessionId: 'session-1', text: '你好', isFinal: false },
      { sessionId: 'session-1', text: '你好，世界', isFinal: true },
    ])
    expect(finished).toEqual(['session-1'])
    expect(JSON.stringify(transcripts)).not.toContain('sk-sp-unit-test')

    disposeTranscript()
    disposeFinished()
    await service.dispose()
  })

  it('rejects a second session with the same ID and never falls back to another route', async () => {
    const context = createContext()
    const socket = new FakeSocket()
    const service = createQwenAudioRealtimeTokenPlanAsrService({
      context: context as never,
      credentialStore: { getRuntimeProfile: () => ({ apiKey: 'sk-sp-unit-test' }) },
      socketFactory: () => socket,
    })
    const start = defineInvoke(context, qwenAudioRealtimeTokenPlanSessionStart)

    await start({ language: 'auto', sessionId: 'duplicate-session' })
    await expect(start({ language: 'auto', sessionId: 'duplicate-session' })).rejects.toThrow('already exists')
    expect(JSON.stringify(socket.sent)).not.toContain('dashscope')
    await service.dispose()
  })
})
