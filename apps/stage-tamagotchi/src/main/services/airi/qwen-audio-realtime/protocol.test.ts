import type {
  QwenAsrSentence,
  QwenAudioRealtimeRuntimeConfig,
  QwenAudioRealtimeSocket,
} from './protocol'

import { describe, expect, it } from 'vitest'

import {
  buildQwenAudioRealtimeEndpoint,
  buildQwenRunTaskFrame,
  MAX_PRESTART_BUFFER_BYTES,
  parseQwenServerMessage,
  QWEN_ASR_SAMPLE_RATE,
  QWEN_AUDIO_REALTIME_ASR_MODEL,
  QwenAudioRealtimeAsrSession,
  resolveQwenAudioRealtimeRuntimeConfig,
} from './protocol'

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

const runtimeConfig: QwenAudioRealtimeRuntimeConfig = {
  apiKey: 'unit-test-placeholder',
  region: 'singapore',
  workspaceId: 'workspace-test',
}

function serverEvent(action: string, taskId = 'session-1', payload?: unknown) {
  return JSON.stringify({ header: { action, task_id: taskId }, payload })
}

function resultEvent(text: string, sentenceEnd: boolean, taskId = 'session-1', sentenceId = 1) {
  return serverEvent('result-generated', taskId, {
    output: {
      sentence: {
        begin_time: 0,
        end_time: text.length * 100,
        sentence_end: sentenceEnd,
        sentence_id: sentenceId,
        text,
      },
    },
  })
}

async function settleEvents() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('qwen Audio realtime ASR protocol', () => {
  it('constructs the current Singapore and Beijing endpoints', () => {
    expect(buildQwenAudioRealtimeEndpoint('singapore', 'workspace-test')).toBe('wss://workspace-test.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference')
    expect(buildQwenAudioRealtimeEndpoint('beijing', 'workspace-test')).toBe('wss://workspace-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference')
  })

  it('keeps the bearer credential at the main-process socket boundary', () => {
    const socket = new FakeSocket()
    let receivedHeaders: Record<string, string> | undefined
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: () => {},
    }, (endpoint, headers) => {
      expect(endpoint).toContain('workspace-test.ap-southeast-1.maas.aliyuncs.com')
      receivedHeaders = headers
      return socket
    })

    session.start()

    expect(receivedHeaders).toEqual({
      'Authorization': 'Bearer unit-test-placeholder',
      'X-DashScope-WorkSpace': 'workspace-test',
    })
  })

  it('fails closed when main-process credentials are incomplete', () => {
    expect(() => resolveQwenAudioRealtimeRuntimeConfig({
      DASHSCOPE_WORKSPACE_ID: 'workspace-test',
      DASHSCOPE_REGION: 'singapore',
    })).toThrow('credentials are incomplete')
  })

  it('builds a run-task frame with official model, PCM, and language mapping', () => {
    expect(buildQwenRunTaskFrame('session-1')).toEqual({
      header: { action: 'run-task', streaming: 'duplex', task_id: 'session-1' },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: QWEN_AUDIO_REALTIME_ASR_MODEL,
        parameters: { format: 'pcm', sample_rate: QWEN_ASR_SAMPLE_RATE },
        input: {},
      },
    })
    expect(buildQwenRunTaskFrame('session-1', 'zh').payload.parameters.language_hints).toEqual(['zh'])
    expect(buildQwenRunTaskFrame('session-1', 'en').payload.parameters.language_hints).toEqual(['en'])
    expect(buildQwenRunTaskFrame('session-1', QWEN_AUDIO_REALTIME_ASR_MODEL, 'zh').payload).toMatchObject({
      model: QWEN_AUDIO_REALTIME_ASR_MODEL,
      parameters: { language_hints: ['zh'] },
    })
  })

  it('queues audio until task-started, then flushes binary PCM before finish', async () => {
    const socket = new FakeSocket()
    const partial: QwenAsrSentence[] = []
    const final: QwenAsrSentence[] = []
    const finished: boolean[] = []
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: (sentence) => { partial.push(sentence) },
      onFinal: (sentence) => { final.push(sentence) },
      onFinished: () => { finished.push(true) },
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    expect(socket.sent).toHaveLength(0)
    socket.emit('open')
    expect(typeof socket.sent[0]).toBe('string')
    expect(JSON.parse(socket.sent[0] as string).header.action).toBe('run-task')

    session.appendAudio(new Uint8Array([1, 2, 3, 4]).buffer)
    expect(socket.sent).toHaveLength(1)
    socket.emit('message', serverEvent('task-started'))
    await settleEvents()
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent[1]).toBeInstanceOf(Uint8Array)
    expect(Array.from(socket.sent[1] as Uint8Array)).toEqual([1, 2, 3, 4])

    socket.emit('message', resultEvent('你好', false))
    socket.emit('message', resultEvent('你好世界', false))
    await settleEvents()
    expect(partial.map(sentence => sentence.text)).toEqual(['你好', '你好世界'])

    const finishing = session.finish()
    expect(JSON.parse(socket.sent.at(-1) as string).header.action).toBe('finish-task')
    socket.emit('message', resultEvent('你好世界', true))
    socket.emit('message', serverEvent('task-finished'))
    await finishing

    expect(final.map(sentence => sentence.text)).toEqual(['你好世界'])
    expect(finished).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  it('aggregates multiple sentence-final results into one task final before renderer handoff', async () => {
    const socket = new FakeSocket()
    const partial: QwenAsrSentence[] = []
    const final: QwenAsrSentence[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: (sentence) => { partial.push(sentence) },
      onFinal: (sentence) => { final.push(sentence) },
      onFinished: () => {},
      onError: (error) => { throw error },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settleEvents()

    socket.emit('message', resultEvent('句段A', false, 'session-1', 1))
    socket.emit('message', resultEvent('句段A', true, 'session-1', 1))
    // Represents a natural pause followed by a new provider sentence.
    socket.emit('message', resultEvent('句段B', false, 'session-1', 2))
    socket.emit('message', resultEvent('句段B', true, 'session-1', 2))
    expect(final).toHaveLength(0)

    const finishing = session.finish()
    socket.emit('message', serverEvent('task-finished'))
    await finishing

    expect(partial.map(sentence => sentence.text)).toEqual(['句段A', '句段A', '句段A句段B', '句段A句段B'])
    expect(final.map(sentence => sentence.text)).toEqual(['句段A句段B'])
    expect(final).toHaveLength(1)
  })

  it('deduplicates repeated delivery of one sentence identity before the renderer final callback', async () => {
    const socket = new FakeSocket()
    const final: QwenAsrSentence[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: (sentence) => { final.push(sentence) },
      onFinished: () => {},
      onError: (error) => { throw error },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settleEvents()
    socket.emit('message', resultEvent('重复句', true, 'session-1', 1))
    socket.emit('message', resultEvent('重复句', true, 'session-1', 1))

    const finishing = session.finish()
    socket.emit('message', serverEvent('task-finished'))
    await finishing

    expect(final).toHaveLength(1)
    expect(final[0]?.sentenceId).toBe(1)
    expect(final[0]?.text).toBe('重复句')
  })

  it('rejects malformed result events instead of accepting generic assistant text', async () => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    socket.emit('message', serverEvent('result-generated', 'session-1', {
      choices: [{ message: { content: 'I cannot transcribe this audio.' } }],
    }))
    await settleEvents()

    expect(errors[0]?.message).toContain('malformed_response')
  })

  it('handles task failure and cancellation without sending more audio', async () => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settleEvents()
    session.cancel()
    const sentBefore = socket.sent.length
    session.appendAudio(new Uint8Array([9, 9]).buffer)
    expect(socket.sent).toHaveLength(sentBefore)
    expect(errors).toHaveLength(0)

    const failedSocket = new FakeSocket()
    const failed: Error[] = []
    const failedSession = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { failed.push(error) },
    }, () => failedSocket)
    failedSession.start()
    failedSocket.emit('open')
    failedSocket.emit('message', JSON.stringify({
      header: {
        error_code: 'AUTHORIZATION_ERROR',
        error_message: 'request rejected with status 403',
        event: 'task-failed',
        task_id: 'session-1',
      },
      payload: {},
    }))
    await settleEvents()
    expect(failed[0]?.message).toContain('task_failed')
    expect(failed[0]?.message).toContain('error_code=AUTHORIZATION_ERROR')
    expect(failed[0]?.message).toContain('status 403')
  })

  it('accepts the official server event field and preserves nullable intermediate end time', () => {
    expect(parseQwenServerMessage(JSON.stringify({
      header: { event: 'result-generated', task_id: 'session-1' },
      payload: {
        output: {
          sentence: {
            begin_time: 0,
            end_time: null,
            sentence_begin: true,
            sentence_end: false,
            sentence_id: 1,
            text: 'hello',
          },
        },
      },
    }), 'session-1')).toMatchObject({
      action: 'result-generated',
      sentence: { durationMilliseconds: 0, text: 'hello' },
    })
  })

  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
  ])('preserves an HTTP %s WebSocket handshake failure without exposing bearer data', async (status, label) => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('error', {
      code: `HTTP_${status}`,
      message: `${label}: Unexpected server response: ${status}; Bearer secret-must-not-appear`,
      statusCode: status,
    })
    await settleEvents()

    expect(errors[0]?.message).toContain(`status=${status}`)
    expect(errors[0]?.message).toContain(`code=HTTP_${status}`)
    expect(errors[0]?.message).toContain('Bearer [redacted]')
    expect(errors[0]?.message).not.toContain('secret-must-not-appear')
  })

  it('preserves an unexpected close code and sanitized reason', async () => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('close', 1006, 'peer closed unexpectedly')
    await settleEvents()

    expect(errors[0]?.message).toContain('close_code=1006')
    expect(errors[0]?.message).toContain('close_reason=peer closed unexpectedly')
  })

  it('finishes an empty ASR response without emitting a transcript', async () => {
    const socket = new FakeSocket()
    const final: QwenAsrSentence[] = []
    const finished: boolean[] = []
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: (sentence) => { final.push(sentence) },
      onFinished: () => { finished.push(true) },
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('message', serverEvent('task-started'))
    await settleEvents()
    const finishing = session.finish()
    socket.emit('message', serverEvent('task-finished'))
    await finishing

    expect(final).toHaveLength(0)
    expect(finished).toHaveLength(1)
    expect(errors).toHaveLength(0)
  })

  it('reports an unexpected close as an error', async () => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)

    session.start()
    socket.emit('open')
    socket.emit('close')
    await settleEvents()

    expect(errors[0]?.message).toContain('unexpected_close')
  })

  it('bounds audio queued before task-started', () => {
    const socket = new FakeSocket()
    const errors: Error[] = []
    const session = new QwenAudioRealtimeAsrSession('session-1', runtimeConfig, 'auto', {
      onStarted: () => {},
      onPartial: () => {},
      onFinal: () => {},
      onFinished: () => {},
      onError: (error) => { errors.push(error) },
    }, () => socket)
    session.start()
    session.appendAudio(new Uint8Array(MAX_PRESTART_BUFFER_BYTES + 1).buffer)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('prestart_buffer_overflow')
  })
})
