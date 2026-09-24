import { Buffer } from 'node:buffer'

import QwenWebSocket from 'crossws/websocket'

import {
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PCM_CHUNK_BYTES,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'

export const QWEN_AUDIO_REALTIME_PLUS_SAMPLE_RATE = 16_000
export const QWEN_AUDIO_REALTIME_PLUS_CHANNELS = 1
export const QWEN_AUDIO_REALTIME_PLUS_BITS_PER_SAMPLE = 16

export interface QwenAudioRealtimePlusTokenPlanSocket {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  terminate?: () => void
  on: ((event: 'open', listener: () => void) => void) & ((event: 'message', listener: (message: unknown) => void) => void) & ((event: 'error', listener: (error: unknown) => void) => void) & ((event: 'close', listener: (code?: number, reason?: string | Uint8Array) => void) => void)
}

export type QwenAudioRealtimePlusTokenPlanSocketFactory = (
  endpoint: string,
  headers: Record<string, string>,
) => QwenAudioRealtimePlusTokenPlanSocket

type QwenWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string>, followRedirects?: boolean },
) => QwenAudioRealtimePlusTokenPlanSocket

export const createQwenAudioRealtimePlusTokenPlanSocket: QwenAudioRealtimePlusTokenPlanSocketFactory = (endpoint, headers) => {
  const WebSocketConstructor = QwenWebSocket as unknown as QwenWebSocketConstructor
  return new WebSocketConstructor(endpoint, undefined, { headers, followRedirects: false })
}

export interface ParsedPcmWav {
  pcm: Uint8Array
  sampleRate: typeof QWEN_AUDIO_REALTIME_PLUS_SAMPLE_RATE
  channels: typeof QWEN_AUDIO_REALTIME_PLUS_CHANNELS
  bitsPerSample: typeof QWEN_AUDIO_REALTIME_PLUS_BITS_PER_SAMPLE
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function uint32(view: DataView, offset: number) {
  return view.getUint32(offset, true)
}

/** Parses a deterministic WAV fixture and strips RIFF/header bytes before sending. */
export function parsePcm16Mono16kWav(input: Uint8Array): ParsedPcmWav {
  if (input.byteLength < 12 || ascii(input, 0, 4) !== 'RIFF' || ascii(input, 8, 4) !== 'WAVE')
    throw new Error('Probe fixture is not a RIFF/WAVE file.')

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  let offset = 12
  let format: { audioFormat: number, channels: number, sampleRate: number, bitsPerSample: number } | undefined
  let pcm: Uint8Array | undefined
  while (offset + 8 <= input.byteLength) {
    const chunkId = ascii(input, offset, 4)
    const chunkSize = uint32(view, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkSize
    if (dataEnd > input.byteLength)
      throw new Error('Probe fixture contains a truncated RIFF chunk.')
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        audioFormat: view.getUint16(dataStart, true),
        channels: view.getUint16(dataStart + 2, true),
        sampleRate: uint32(view, dataStart + 4),
        bitsPerSample: view.getUint16(dataStart + 14, true),
      }
    }
    if (chunkId === 'data')
      pcm = input.slice(dataStart, dataEnd)
    offset = dataEnd + (chunkSize % 2)
  }

  if (!format || !pcm || format.audioFormat !== 1 || format.channels !== QWEN_AUDIO_REALTIME_PLUS_CHANNELS || format.sampleRate !== QWEN_AUDIO_REALTIME_PLUS_SAMPLE_RATE || format.bitsPerSample !== QWEN_AUDIO_REALTIME_PLUS_BITS_PER_SAMPLE)
    throw new Error('Probe fixture must be PCM16, mono, and 16 kHz.')
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0)
    throw new Error('Probe fixture has invalid PCM sample bytes.')

  return { pcm, sampleRate: 16_000, channels: 1, bitsPerSample: 16 }
}

export function chunkPcm(pcm: Uint8Array, chunkBytes = QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PCM_CHUNK_BYTES) {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < pcm.byteLength; offset += chunkBytes)
    chunks.push(pcm.slice(offset, Math.min(offset + chunkBytes, pcm.byteLength)))
  return chunks
}

export function buildQwenAudioRealtimePlusSessionUpdateFrame() {
  return {
    type: 'session.update' as const,
    session: {
      modalities: ['text'] as const,
      input_audio_format: 'pcm' as const,
      turn_detection: null,
    },
  }
}

export function buildQwenAudioRealtimePlusAudioAppendFrame(pcm: Uint8Array) {
  return { type: 'input_audio_buffer.append' as const, audio: Buffer.from(pcm).toString('base64') }
}

export function buildQwenAudioRealtimePlusAudioCommitFrame() {
  return { type: 'input_audio_buffer.commit' as const }
}

export type QwenAudioRealtimePlusServerMessage
  = | { type: 'session.created' }
    | { type: 'session.updated' }
    | { type: 'transcription.delta', itemId?: string, contentIndex?: number, text: string, stash: string }
    | { type: 'transcription.delta.malformed' }
    | { type: 'transcription.completed', itemId?: string, contentIndex?: number, transcript: string }
    | { type: 'transcription.failed', itemId?: string, contentIndex?: number, code?: string, message?: string }
    | { type: 'error', code?: string, message?: string }
    | { type: 'unexpected-generation', eventType: string }

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textFromMessage(message: unknown) {
  if (typeof message === 'string')
    return message
  if (message instanceof ArrayBuffer)
    return new TextDecoder().decode(message)
  if (ArrayBuffer.isView(message))
    return new TextDecoder().decode(new Uint8Array(message.buffer, message.byteOffset, message.byteLength))
  throw new Error('Realtime probe received an unsupported WebSocket message.')
}

function optionalCorrelationFields(root: Record<string, unknown>) {
  const itemId = root.item_id
  const contentIndex = root.content_index
  if (itemId !== undefined && (typeof itemId !== 'string' || !itemId))
    return undefined
  if (contentIndex !== undefined && (typeof contentIndex !== 'number' || !Number.isInteger(contentIndex) || contentIndex < 0))
    return undefined
  return {
    ...(itemId === undefined ? {} : { itemId }),
    ...(contentIndex === undefined ? {} : { contentIndex }),
  } as { itemId?: string, contentIndex?: number }
}

/** Parses only bounded event fields; raw frames never leave the main process. */
export function parseQwenAudioRealtimePlusServerMessage(message: unknown): QwenAudioRealtimePlusServerMessage {
  const root = record(JSON.parse(textFromMessage(message)) as unknown)
  if (!root)
    throw new Error('Realtime probe event payload is not an object.')
  const type = root.type
  if (typeof type !== 'string')
    throw new Error('Realtime probe event type is missing.')
  if (type === 'session.created' || type === 'session.updated')
    return { type }
  if (type === 'conversation.item.input_audio_transcription.delta') {
    const correlation = optionalCorrelationFields(root)
    if (!correlation || typeof root.text !== 'string' || typeof root.stash !== 'string')
      return { type: 'transcription.delta.malformed' }
    return { type: 'transcription.delta', ...correlation, text: root.text, stash: root.stash }
  }
  if (type === 'conversation.item.input_audio_transcription.completed') {
    if (typeof root.transcript !== 'string')
      throw new Error('Realtime probe completed transcript is malformed.')
    const correlation = optionalCorrelationFields(root)
    if (!correlation)
      throw new Error('Realtime probe completed transcript correlation is malformed.')
    return { type: 'transcription.completed', ...correlation, transcript: root.transcript }
  }
  if (type === 'conversation.item.input_audio_transcription.failed') {
    const correlation = optionalCorrelationFields(root)
    if (!correlation)
      throw new Error('Realtime probe transcription failure correlation is malformed.')
    const error = record(root.error)
    return {
      type: 'transcription.failed',
      ...correlation,
      code: typeof error?.code === 'string' ? error.code : undefined,
      message: typeof error?.message === 'string' ? error.message : undefined,
    }
  }
  if (type === 'error') {
    const error = record(root.error)
    return {
      type,
      code: typeof error?.code === 'string' ? error.code : undefined,
      message: typeof error?.message === 'string' ? error.message : undefined,
    }
  }
  if (type.startsWith('response.') || type.startsWith('conversation.item') || type.startsWith('output_audio'))
    return { type: 'unexpected-generation', eventType: type.slice(0, 80) }
  throw new Error(`Realtime probe event is unsupported: ${type.slice(0, 80)}`)
}

export function probeEndpoint() {
  return QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT
}

export function probeModel() {
  return QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_MODEL
}
