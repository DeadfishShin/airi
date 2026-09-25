import type { QwenAudioRealtimePlusTokenPlanSocket } from './protocol'

import { readFileSync } from 'node:fs'

import {
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'
import { describe, expect, it, vi } from 'vitest'

import { runQwenAudioRealtimePlusTokenPlanProbe } from './index'

const fixtureBytes = new Uint8Array(readFileSync(new URL('../../../../../resources/token-plan-asr-capability-probe.wav', import.meta.url)))

class FakeSocket implements QwenAudioRealtimePlusTokenPlanSocket {
  readyState = 0
  sent: string[] = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

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

describe('token Plan realtime-plus transcript-only main probe', () => {
  it('keeps credential and raw PCM in main and never sends response.create', async () => {
    let socket!: FakeSocket
    const socketFactory = vi.fn((endpoint: string, headers: Record<string, string>) => {
      expect(endpoint).toBe(QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT)
      expect(endpoint).toContain(`model=${QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL}`)
      expect(headers).toEqual({ Authorization: 'Bearer sk-sp-unit-test' })
      socket = new FakeSocket()
      setTimeout(() => {
        socket.readyState = 1
        socket.emit('open')
        socket.emit('message', JSON.stringify({ type: 'session.created' }))
        socket.emit('message', JSON.stringify({ type: 'session.updated' }))
        socket.emit('message', JSON.stringify({ event_id: 'event_commit', type: 'input_audio_buffer.committed', previous_item_id: null, item_id: 'item_x' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.created', previous_item_id: null, item: { id: 'item_x', type: 'message', role: 'user', content: [{ type: 'input_audio' }] } }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_x', content_index: 0, text: 'AIRI', stash: ' probe' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_x', content_index: 0, transcript: 'AIRI probe' }))
      }, 0)
      return socket
    })

    const result = await runQwenAudioRealtimePlusTokenPlanProbe(
      () => ({ apiKey: 'sk-sp-unit-test' }),
      { socketFactory, fixtureBytes, chunkPacingMs: 0 },
    )
    const sent = socket.sent.map(frame => JSON.parse(frame) as Record<string, unknown>)
    expect(result).toMatchObject({
      responseClass: 'SUCCESS_TRANSCRIPT_ONLY',
      transcript: 'AIRI probe',
      transcriptPresent: true,
      sessionCreated: true,
      sessionUpdated: true,
      commitSent: true,
      commitAckReceived: true,
      committedItemIdPresent: true,
      userItemCreatedReceived: true,
      userItemCorrelationMatch: true,
      transcriptionDeltaEventCount: 1,
      validTextStashDeltaObserved: true,
      responseCreateSent: false,
    })
    expect(sent.at(-1)).toEqual({ type: 'input_audio_buffer.commit' })
    expect(sent.some(frame => frame.type === 'response.create')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('sk-sp-unit-test')
    expect(JSON.stringify(result)).not.toContain('AQ')
    expect(socketFactory).toHaveBeenCalledTimes(1)
  })

  it('keeps commit acknowledgement and user-item creation non-terminal before transcript completion', async () => {
    let socket!: FakeSocket
    const socketFactory = vi.fn(() => {
      socket = new FakeSocket()
      setTimeout(() => {
        socket.readyState = 1
        socket.emit('open')
        socket.emit('message', JSON.stringify({ type: 'session.created' }))
        socket.emit('message', JSON.stringify({ type: 'session.updated' }))
        socket.emit('message', JSON.stringify({ event_id: 'event_commit', type: 'input_audio_buffer.committed', item_id: 'item_user' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.created', item: { id: 'item_user', type: 'message', role: 'user', content: [{ type: 'input_audio' }] } }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_user', transcript: 'AIRI probe' }))
      }, 0)
      return socket
    })

    const result = await runQwenAudioRealtimePlusTokenPlanProbe(
      () => ({ apiKey: 'sk-sp-unit-test' }),
      { socketFactory, fixtureBytes, chunkPacingMs: 0 },
    )

    expect(result).toMatchObject({
      responseClass: 'SUCCESS_TRANSCRIPT_ONLY',
      commitAckReceived: true,
      committedItemIdPresent: true,
      userItemCreatedReceived: true,
      userItemCorrelationMatch: true,
    })
    expect(socketFactory).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting after a malformed partial delta and correlates the completed transcript', async () => {
    let socket!: FakeSocket
    const socketFactory = vi.fn(() => {
      socket = new FakeSocket()
      setTimeout(() => {
        socket.readyState = 1
        socket.emit('open')
        socket.emit('message', JSON.stringify({ type: 'session.created' }))
        socket.emit('message', JSON.stringify({ type: 'session.updated' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', delta: 'wrong schema' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_x', content_index: 0, text: 'AIRI', stash: ' probe' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'other_item', content_index: 0, transcript: 'wrong item' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_x', content_index: 0, transcript: 'AIRI probe' }))
      }, 0)
      return socket
    })

    const result = await runQwenAudioRealtimePlusTokenPlanProbe(
      () => ({ apiKey: 'sk-sp-unit-test' }),
      { socketFactory, fixtureBytes, chunkPacingMs: 0 },
    )

    expect(result.responseClass).toBe('SUCCESS_TRANSCRIPT_ONLY')
    expect(result.transcript).toBe('AIRI probe')
    expect(result.responseCreateSent).toBe(false)
    expect(socketFactory).toHaveBeenCalledTimes(1)
  })

  it('waits for a matching transcription failure event', async () => {
    let socket!: FakeSocket
    const socketFactory = vi.fn(() => {
      socket = new FakeSocket()
      setTimeout(() => {
        socket.readyState = 1
        socket.emit('open')
        socket.emit('message', JSON.stringify({ type: 'session.created' }))
        socket.emit('message', JSON.stringify({ type: 'session.updated' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_x', content_index: 0, text: '', stash: '' }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'other_item', content_index: 0, error: { code: 'wrong_item', message: 'ignored' } }))
        socket.emit('message', JSON.stringify({ type: 'conversation.item.input_audio_transcription.failed', item_id: 'item_x', content_index: 0, error: { code: 'transcription_failed', message: 'failed' } }))
      }, 0)
      return socket
    })

    const result = await runQwenAudioRealtimePlusTokenPlanProbe(
      () => ({ apiKey: 'sk-sp-unit-test' }),
      { socketFactory, fixtureBytes, chunkPacingMs: 0 },
    )

    expect(result.responseClass).toBe('TRANSCRIPTION_FAILED')
    expect(result.providerErrorCode).toBe('transcription_failed')
    expect(result.sanitizedErrorMessage).toBe('failed')
    expect(socketFactory).toHaveBeenCalledTimes(1)
  })

  it('fails closed on unexpected generation and does not retry', async () => {
    let socket!: FakeSocket
    const socketFactory = vi.fn(() => {
      socket = new FakeSocket()
      setTimeout(() => {
        socket.readyState = 1
        socket.emit('open')
        socket.emit('message', JSON.stringify({ type: 'session.created' }))
        socket.emit('message', JSON.stringify({ type: 'session.updated' }))
        socket.emit('message', JSON.stringify({ type: 'response.created' }))
      }, 0)
      return socket
    })
    const result = await runQwenAudioRealtimePlusTokenPlanProbe(
      () => ({ apiKey: 'sk-sp-unit-test' }),
      { socketFactory, fixtureBytes, chunkPacingMs: 0 },
    )
    expect(result.responseClass).toBe('UNEXPECTED_VENDOR_RESPONSE_GENERATION')
    expect(socketFactory).toHaveBeenCalledTimes(1)
  })
})
