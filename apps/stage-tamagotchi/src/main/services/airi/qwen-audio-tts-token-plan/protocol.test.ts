import type { QwenAudioTtsTokenPlanSocket } from './protocol'

import { describe, expect, it } from 'vitest'

import {
  buildQwenAudioTtsTokenPlanCancelTaskFrame,
  buildQwenAudioTtsTokenPlanContinueTaskFrame,
  buildQwenAudioTtsTokenPlanFinishTaskFrame,
  buildQwenAudioTtsTokenPlanHeaders,
  buildQwenAudioTtsTokenPlanRunTaskFrame,
  decodeQwenAudioTtsTokenPlanBinaryAudio,
  MAX_PRE_READY_TEXT_CHARS,
  parseQwenAudioTtsTokenPlanServerMessage,
  QWEN_AUDIO_TTS_TOKEN_PLAN_ENDPOINT,
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE,
  QwenAudioTtsTokenPlanSession,
  resolveQwenAudioTtsTokenPlanRuntimeConfig,
  sanitizeQwenAudioTtsTokenPlanDiagnostic,
} from './protocol'

class FakeSocket implements QwenAudioTtsTokenPlanSocket {
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

const event = (eventName: string, extra: Record<string, unknown> = {}) => JSON.stringify({ header: { event: eventName, ...extra } })

async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('token Plan Qwen Audio TTS protocol', () => {
  it('uses the isolated Beijing endpoint and Token Plan credential only', () => {
    expect(QWEN_AUDIO_TTS_TOKEN_PLAN_ENDPOINT).toBe('wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference')
    expect(resolveQwenAudioTtsTokenPlanRuntimeConfig({
      TOKEN_PLAN_API_KEY: 'unit-test-token-plan-key',
      DASHSCOPE_API_KEY: 'must-not-be-used',
      DASHSCOPE_WORKSPACE_ID: 'must-not-be-used',
    })).toEqual({ apiKey: 'unit-test-token-plan-key' })
    expect(buildQwenAudioTtsTokenPlanHeaders({ apiKey: 'unit-test-token-plan-key' })).toEqual({
      Authorization: 'Bearer unit-test-token-plan-key',
    })
    expect(() => resolveQwenAudioTtsTokenPlanRuntimeConfig({ DASHSCOPE_API_KEY: 'payg-only' })).toThrow('API key is unavailable')
  })

  it('builds the official native task frames', () => {
    expect(buildQwenAudioTtsTokenPlanRunTaskFrame('task-1')).toEqual({
      header: { action: 'run-task', task_id: 'task-1', streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
        parameters: {
          text_type: 'PlainText',
          voice: 'longanlingxin',
          format: 'pcm',
          sample_rate: QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE,
          volume: 50,
          rate: 1,
          pitch: 1,
          enable_ssml: false,
        },
        input: {},
      },
    })
    expect(buildQwenAudioTtsTokenPlanContinueTaskFrame('task-1', '你好。')).toEqual({
      header: { action: 'continue-task', task_id: 'task-1', streaming: 'duplex' },
      payload: { input: { text: '你好。' } },
    })
    expect(buildQwenAudioTtsTokenPlanFinishTaskFrame('task-1')).toEqual({
      header: { action: 'finish-task', task_id: 'task-1', streaming: 'duplex' },
      payload: { input: {} },
    })
    expect(buildQwenAudioTtsTokenPlanCancelTaskFrame('task-1')).toEqual({
      header: { action: 'finish-task', task_id: 'task-1', streaming: 'duplex' },
      payload: { input: { directive: 'cancel' } },
    })
  })

  it('waits for task-started, flushes text, then sends finish without an ack', async () => {
    const socket = new FakeSocket()
    const audio: Array<{ sequence: number, bytes: number }> = []
    const events: string[] = []
    let now = 100
    const session = new QwenAudioTtsTokenPlanSession(
      'task-1',
      { apiKey: 'unit-test-token-plan-key' },
      'longanlingxin',
      {
        onReady: () => { events.push('ready') },
        onAudioDelta: (chunk, sequence) => { audio.push({ sequence, bytes: chunk.byteLength }) },
        onResponseDone: () => {},
        onFinished: () => { events.push('finished') },
        onError: (error) => { events.push(`error:${error.message}`) },
      },
      () => socket,
      () => now++,
    )

    session.start()
    socket.emit('open')
    const taskId = (JSON.parse(socket.sent[0]!) as { header: { task_id: string } }).header.task_id
    expect(taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(taskId).not.toBe('task-1')
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ header: { action: 'run-task', streaming: 'duplex' } })
    session.appendText('你')
    session.appendText('好')
    const completion = session.finish()
    expect(socket.sent).toHaveLength(1)

    socket.emit('message', event('task-started'))
    await settle()
    expect(events).toEqual(['ready'])
    expect(socket.sent.slice(1).map(frame => JSON.parse(frame).header.action)).toEqual(['continue-task', 'continue-task', 'finish-task'])
    expect(socket.sent.slice(1, 3).map(frame => JSON.parse(frame).payload.input.text)).toEqual(['你', '好'])
    expect(socket.sent.map(frame => (JSON.parse(frame) as { header: { task_id: string } }).header.task_id)).toEqual([taskId, taskId, taskId, taskId])

    socket.emit('message', new Uint8Array([0, 1, 2, 3]))
    socket.emit('message', JSON.stringify({
      header: { event: 'result-generated' },
      payload: { output: { type: 'sentence-synthesis' } },
    }))
    await settle()
    expect(audio).toEqual([{ sequence: 0, bytes: 4 }])
    socket.emit('message', event('task-finished'))
    await completion
    expect(events.at(-1)).toBe('finished')
    expect(session.stateValue).toBe('finished')
  })

  it('rejects malformed/odd/empty audio and preserves task-failed details', () => {
    expect(() => decodeQwenAudioTtsTokenPlanBinaryAudio(new Uint8Array())).toThrow('empty')
    expect(() => decodeQwenAudioTtsTokenPlanBinaryAudio(new Uint8Array([1]))).toThrow('odd byte length')
    expect(parseQwenAudioTtsTokenPlanServerMessage(event('task-failed', {
      error_code: 'invalid_model',
      error_message: 'model was not accepted',
    }))).toEqual({ type: 'task-failed', errorCode: 'invalid_model', errorMessage: 'model was not accepted' })
    expect(sanitizeQwenAudioTtsTokenPlanDiagnostic('Bearer unit-test-token-plan-key')).toBe('Bearer [redacted]')
  })

  it('bounds pre-ready text, cancels with a directive, and does not reconnect', async () => {
    const socket = new FakeSocket()
    const errors: string[] = []
    const session = new QwenAudioTtsTokenPlanSession(
      'task-1',
      { apiKey: 'unit-test-token-plan-key' },
      'longanlingxin',
      {
        onReady: () => {},
        onAudioDelta: () => {},
        onResponseDone: () => {},
        onFinished: () => {},
        onError: (error) => { errors.push(error.message) },
      },
      () => socket,
    )
    session.start()
    socket.emit('open')
    expect(() => session.appendText('x'.repeat(MAX_PRE_READY_TEXT_CHARS + 1))).toThrow('pre-ready text buffer is full')
    await settle()
    expect(session.stateValue).toBe('failed')
    expect(errors[0]).toContain('pre_ready_text_overflow')

    const cancelSocket = new FakeSocket()
    const cancelSession = new QwenAudioTtsTokenPlanSession(
      'task-2',
      { apiKey: 'unit-test-token-plan-key' },
      'longanlingxin',
      { onReady: () => {}, onAudioDelta: () => {}, onResponseDone: () => {}, onFinished: () => {}, onError: () => {} },
      () => cancelSocket,
    )
    cancelSession.start()
    cancelSocket.emit('open')
    cancelSocket.emit('message', event('task-started'))
    await settle()
    cancelSession.cancel()
    const cancelTaskId = (JSON.parse(cancelSocket.sent[0]!) as { header: { task_id: string } }).header.task_id
    expect(JSON.parse(cancelSocket.sent.at(-1)!)).toEqual(buildQwenAudioTtsTokenPlanCancelTaskFrame(cancelTaskId))
    expect(cancelSocket.closed || cancelSocket.terminated).toBe(true)
  })
})
