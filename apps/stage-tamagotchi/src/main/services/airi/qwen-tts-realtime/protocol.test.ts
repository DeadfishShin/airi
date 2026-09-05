import type { QwenTtsRealtimeSocket } from './protocol'

import { QWEN3_TTS_REALTIME_MODEL_CATALOG } from '@proj-airi/stage-ui/libs/providers/qwen3-tts-realtime-models'
import { describe, expect, it } from 'vitest'

import {
  buildQwenTtsRealtimeEndpoint,
  buildQwenTtsRealtimeHeaders,
  buildQwenTtsSessionFinishFrame,
  buildQwenTtsSessionUpdateFrame,
  buildQwenTtsTextAppendFrame,
  decodeQwenTtsAudioDelta,
  MAX_PRE_READY_TEXT_CHARS,
  parseQwenTtsServerMessage,
  QWEN3_TTS_REALTIME_SAMPLE_RATE,
  Qwen3TtsRealtimeSession,
  qwenTtsCloseMessage,
  qwenTtsSocketErrorMessage,
  resolveQwenTtsRealtimeRuntimeConfig,
} from './protocol'

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

async function settleEvents() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function sessionCreated() {
  return JSON.stringify({ type: 'session.created', session: { id: 'sess-test' } })
}

function sessionUpdated() {
  return JSON.stringify({ type: 'session.updated', session: { id: 'sess-test' } })
}

describe('qwen3 realtime TTS protocol', () => {
  it('resolves regional endpoints and main-process headers without exposing workspace in the URL', () => {
    expect(buildQwenTtsRealtimeEndpoint('beijing')).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime')
    expect(buildQwenTtsRealtimeEndpoint('singapore')).toBe('wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime')
    expect(buildQwenTtsRealtimeEndpoint('beijing', QWEN3_TTS_REALTIME_MODEL_CATALOG[1].id)).toBe('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-instruct-flash-realtime')

    const config = resolveQwenTtsRealtimeRuntimeConfig({
      DASHSCOPE_API_KEY: 'unit-test-placeholder',
      DASHSCOPE_REGION: 'beijing',
      DASHSCOPE_WORKSPACE_ID: 'workspace-test',
    })
    expect(buildQwenTtsRealtimeHeaders(config)).toEqual({
      'Authorization': 'Bearer unit-test-placeholder',
      'X-DashScope-WorkSpace': 'workspace-test',
    })
    expect(buildQwenTtsRealtimeHeaders({ apiKey: 'unit-test-placeholder', region: 'beijing' })).toEqual({ Authorization: 'Bearer unit-test-placeholder' })
  })

  it('fails closed for missing credentials and invalid regions', () => {
    expect(() => resolveQwenTtsRealtimeRuntimeConfig({ DASHSCOPE_REGION: 'beijing' })).toThrow('API key is unavailable')
    expect(() => resolveQwenTtsRealtimeRuntimeConfig({ DASHSCOPE_API_KEY: 'unit-test-placeholder', DASHSCOPE_REGION: 'tokyo' })).toThrow('region is missing or invalid')
  })

  it('builds the official session, append, and finish frames', () => {
    expect(buildQwenTtsSessionUpdateFrame('Cherry', 'Chinese', 'server_commit', 'event-1')).toEqual({
      event_id: 'event-1',
      type: 'session.update',
      session: {
        voice: 'Cherry',
        mode: 'server_commit',
        language_type: 'Chinese',
        response_format: 'pcm',
        sample_rate: QWEN3_TTS_REALTIME_SAMPLE_RATE,
      },
    })
    expect(buildQwenTtsTextAppendFrame('hello', 'event-2')).toEqual({ event_id: 'event-2', type: 'input_text_buffer.append', text: 'hello' })
    expect(buildQwenTtsSessionFinishFrame('event-3')).toEqual({ event_id: 'event-3', type: 'session.finish' })
  })

  it('waits for session.created, sends one update, flushes pre-ready text in order, and finishes gracefully', async () => {
    const socket = new FakeSocket()
    const events: string[] = []
    let now = 100
    const session = new Qwen3TtsRealtimeSession(
      'session-1',
      { apiKey: 'unit-test-placeholder', region: 'beijing' },
      'Cherry',
      'Chinese',
      'server_commit',
      {
        onReady: () => { events.push('ready') },
        onAudioDelta: (audio, sequence) => {
          events.push(`audio:${sequence}:${audio.byteLength}`)
        },
        onResponseDone: () => { events.push('response-done') },
        onFinished: () => { events.push('finished') },
        onError: (error) => { events.push(`error:${error.message}`) },
      },
      () => socket,
      () => now++,
    )

    session.start()
    expect(session.stateValue).toBe('connecting')
    socket.emit('open')
    expect(socket.sent).toEqual([])

    socket.emit('message', sessionCreated())
    await settleEvents()
    expect(session.stateValue).toBe('waiting_session_updated')
    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0]).type).toBe('session.update')

    session.appendText('你好')
    session.appendText('，世界')
    socket.emit('message', sessionUpdated())
    await settleEvents()
    expect(events).toEqual(['ready'])
    expect(socket.sent.slice(1).map(frame => JSON.parse(frame).text)).toEqual(['你好', '，世界'])

    socket.emit('message', JSON.stringify({ type: 'response.audio.delta', delta: 'AAECAw==' }))
    socket.emit('message', JSON.stringify({ type: 'response.done', response: { status: 'completed' } }))
    await settleEvents()
    expect(events).toContain('audio:0:4')
    expect(events).toContain('response-done')

    const finishing = session.finish()
    expect(session.finish()).toBe(finishing)
    expect(session.stateValue).toBe('finishing')
    expect(JSON.parse(socket.sent.at(-1)!).type).toBe('session.finish')
    socket.emit('message', JSON.stringify({ type: 'session.finished' }))
    await finishing
    expect(events.at(-1)).toBe('finished')
    expect(session.stateValue).toBe('finished')
  })

  it('validates and decodes non-empty even-length PCM16 audio', () => {
    expect(Array.from(new Uint8Array(decodeQwenTtsAudioDelta('AAECAw==')))).toEqual([0, 1, 2, 3])
    expect(() => decodeQwenTtsAudioDelta('AAE=')).not.toThrow()
    expect(() => decodeQwenTtsAudioDelta('AA==')).toThrow('odd byte length')
    expect(() => decodeQwenTtsAudioDelta('not-base64!')).toThrow('valid base64')
  })

  it('ignores unknown server events and rejects malformed required events', () => {
    expect(parseQwenTtsServerMessage(JSON.stringify({ type: 'rate_limits.updated' }))).toEqual({ type: 'unknown', eventType: 'rate_limits.updated' })
    expect(parseQwenTtsServerMessage(JSON.stringify({ type: 'error', error: { code: 'invalid_api_key', message: 'rejected' } }))).toEqual({ type: 'error', code: 'invalid_api_key', message: 'rejected' })
    expect(() => parseQwenTtsServerMessage(JSON.stringify({ type: 'session.updated' }))).toThrow('payload is malformed')
    expect(() => parseQwenTtsServerMessage(JSON.stringify({ type: 'response.audio.delta', delta: '' }))).toThrow('audio delta is missing')
  })

  it('preserves safe status and close diagnostics without retaining authentication material', () => {
    const message = qwenTtsSocketErrorMessage({
      name: 'UnexpectedResponseError',
      statusCode: 403,
      message: 'Bearer unit-test-placeholder was rejected',
    })
    expect(message).toContain('status=403')
    expect(message).toContain('Bearer [redacted]')
    expect(message).not.toContain('unit-test-placeholder')
    expect(qwenTtsCloseMessage(1006, 'TLS connection closed')).toBe('close_code=1006; close_reason=TLS connection closed')
  })

  it('fails closed and clears the bounded pre-ready text queue on overflow', async () => {
    const socket = new FakeSocket()
    const errors: string[] = []
    const session = new Qwen3TtsRealtimeSession(
      'session-1',
      { apiKey: 'unit-test-placeholder', region: 'beijing' },
      'Cherry',
      'Chinese',
      'server_commit',
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
    await settleEvents()
    expect(session.stateValue).toBe('failed')
    expect(errors[0]).toContain('pre_ready_text_overflow')
  })

  it('rejects append after finish and cancels without a fake successful finish event', async () => {
    const socket = new FakeSocket()
    const events: string[] = []
    const session = new Qwen3TtsRealtimeSession(
      'session-1',
      { apiKey: 'unit-test-placeholder', region: 'beijing' },
      'Cherry',
      'Chinese',
      'server_commit',
      {
        onReady: () => {},
        onAudioDelta: () => {},
        onResponseDone: () => {},
        onFinished: () => { events.push('finished') },
        onError: (error) => { events.push(error.message) },
      },
      () => socket,
    )
    session.start()
    socket.emit('open')
    socket.emit('message', sessionCreated())
    await settleEvents()
    socket.emit('message', sessionUpdated())
    await settleEvents()
    const finishing = session.finish()
    expect(() => session.appendText('late')).toThrow('after finish')
    session.cancel()
    await finishing
    expect(session.stateValue).toBe('cancelled')
    expect(events).toEqual([])
    expect(socket.closed || socket.terminated).toBe(true)
  })

  it('keeps the handshake alive when finish is requested before WebSocket open', async () => {
    const socket = new FakeSocket()
    const session = new Qwen3TtsRealtimeSession(
      'session-1',
      { apiKey: 'unit-test-placeholder', region: 'beijing' },
      'Cherry',
      'Chinese',
      'server_commit',
      {
        onReady: () => {},
        onAudioDelta: () => {},
        onResponseDone: () => {},
        onFinished: () => {},
        onError: () => {},
      },
      () => socket,
    )

    session.start()
    const finishing = session.finish()
    socket.emit('open')
    socket.emit('message', sessionCreated())
    await settleEvents()
    socket.emit('message', sessionUpdated())
    await settleEvents()
    expect(socket.sent.map(frame => JSON.parse(frame).type)).toEqual(['session.update', 'session.finish'])
    socket.emit('message', JSON.stringify({ type: 'session.finished' }))
    await finishing
    expect(session.stateValue).toBe('finished')
  })
})
