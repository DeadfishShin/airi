import type {
  Qwen3TtsRealtimeLanguageType,
  Qwen3TtsRealtimeMode,
} from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import type { Qwen3TtsRealtimeModelId } from '@proj-airi/stage-ui/libs/providers/qwen3-tts-realtime-models'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import QwenWebSocket from 'crossws/websocket'

import { errorMessageFrom } from '@moeru/std'
import {
  isQwen3TtsRealtimeModel,
  QWEN3_TTS_REALTIME_DEFAULT_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen3-tts-realtime-models'

export const QWEN3_TTS_REALTIME_SAMPLE_RATE = 24_000
export const QWEN3_TTS_REALTIME_DEFAULT_MODE: Qwen3TtsRealtimeMode = 'server_commit'
export const QWEN3_TTS_REALTIME_DEFAULT_LANGUAGE: Qwen3TtsRealtimeLanguageType = 'Chinese'
export const MAX_PRE_READY_TEXT_CHARS = 32 * 1024
export const MAX_TERMINAL_ERROR_TOMBSTONES = 32
export const TERMINAL_ERROR_TOMBSTONE_TTL_MS = 30_000

const MAX_DIAGNOSTIC_LENGTH = 240
const CONNECTING = 0
const OPEN = 1

export type QwenTtsRealtimeRegion = 'beijing' | 'singapore'
export type QwenTtsRealtimeSessionState
  = | 'created_local'
    | 'connecting'
    | 'waiting_session_created'
    | 'waiting_session_updated'
    | 'ready'
    | 'finishing'
    | 'finished'
    | 'cancelled'
    | 'failed'

export interface QwenTtsRealtimeRuntimeConfig {
  apiKey: string
  region: QwenTtsRealtimeRegion
  workspaceId?: string
}

export function resolveQwenTtsRealtimeRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): QwenTtsRealtimeRuntimeConfig {
  const apiKey = environment.DASHSCOPE_API_KEY?.trim() ?? ''
  const workspaceId = environment.DASHSCOPE_WORKSPACE_ID?.trim() ?? ''
  const region = environment.DASHSCOPE_REGION?.trim().toLowerCase()

  if (!apiKey)
    throw new Error('Qwen3 realtime TTS API key is unavailable.')
  if (region !== 'beijing' && region !== 'singapore')
    throw new Error('Qwen3 realtime TTS region is missing or invalid.')
  if (workspaceId && /[\r\n]/.test(workspaceId))
    throw new Error('Qwen3 realtime TTS workspace ID is invalid.')

  return {
    apiKey,
    region,
    ...(workspaceId ? { workspaceId } : {}),
  }
}

export function buildQwenTtsRealtimeEndpoint(region: QwenTtsRealtimeRegion, model: Qwen3TtsRealtimeModelId = QWEN3_TTS_REALTIME_DEFAULT_MODEL): string {
  if (!isQwen3TtsRealtimeModel(model))
    throw new Error('Qwen3 realtime TTS model is unsupported.')
  const host = region === 'beijing'
    ? 'dashscope.aliyuncs.com'
    : 'dashscope-intl.aliyuncs.com'
  return `wss://${host}/api-ws/v1/realtime?model=${model}`
}

export function buildQwenTtsRealtimeHeaders(config: QwenTtsRealtimeRuntimeConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    ...(config.workspaceId ? { 'X-DashScope-WorkSpace': config.workspaceId } : {}),
  }
}

export interface QwenTtsRealtimeSocket {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  terminate?: () => void
  on: (event: 'open' | 'message' | 'error' | 'close', listener: (message?: unknown, detail?: unknown) => void) => void
}

export type QwenTtsRealtimeSocketFactory = (
  endpoint: string,
  headers: Record<string, string>,
) => QwenTtsRealtimeSocket

type QwenWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => QwenTtsRealtimeSocket

/** Uses crossws' Node adapter so the main process can set handshake headers. */
export const createQwenTtsRealtimeSocket: QwenTtsRealtimeSocketFactory = (endpoint, headers) => {
  const WebSocketConstructor = QwenWebSocket as unknown as QwenWebSocketConstructor
  return new WebSocketConstructor(endpoint, undefined, { headers })
}

interface SessionUpdateFrame {
  event_id: string
  type: 'session.update'
  session: {
    voice: string
    mode: Qwen3TtsRealtimeMode
    language_type: Qwen3TtsRealtimeLanguageType
    response_format: 'pcm'
    sample_rate: typeof QWEN3_TTS_REALTIME_SAMPLE_RATE
  }
}

interface TextAppendFrame {
  event_id: string
  type: 'input_text_buffer.append'
  text: string
}

interface SessionFinishFrame {
  event_id: string
  type: 'session.finish'
}

export function buildQwenTtsSessionUpdateFrame(
  voice: string,
  languageType: Qwen3TtsRealtimeLanguageType,
  mode: Qwen3TtsRealtimeMode,
  eventId: string = randomUUID(),
): SessionUpdateFrame {
  return {
    event_id: eventId,
    type: 'session.update',
    session: {
      voice,
      mode,
      language_type: languageType,
      response_format: 'pcm',
      sample_rate: QWEN3_TTS_REALTIME_SAMPLE_RATE,
    },
  }
}

export function buildQwenTtsTextAppendFrame(text: string, eventId: string = randomUUID()): TextAppendFrame {
  return { event_id: eventId, type: 'input_text_buffer.append', text }
}

export function buildQwenTtsSessionFinishFrame(eventId: string = randomUUID()): SessionFinishFrame {
  return { event_id: eventId, type: 'session.finish' }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function textFromSocketMessage(message: unknown): string {
  if (typeof message === 'string')
    return message
  if (message instanceof ArrayBuffer)
    return new TextDecoder().decode(message)
  if (ArrayBuffer.isView(message))
    return new TextDecoder().decode(new Uint8Array(message.buffer, message.byteOffset, message.byteLength))
  throw new Error('Qwen3 realtime TTS returned an unsupported WebSocket message.')
}

export type QwenTtsRealtimeServerMessage
  = | { type: 'session.created', session: Record<string, unknown> }
    | { type: 'session.updated', session: Record<string, unknown> }
    | { type: 'response.created', response: Record<string, unknown> }
    | { type: 'response.audio.delta', delta: string }
    | { type: 'response.audio.done' }
    | { type: 'response.done', response: Record<string, unknown> }
    | { type: 'session.finished' }
    | { type: 'error', code?: string, message?: string }
    | { type: 'unknown', eventType: string }

/** Parses only the target events needed by the bounded main-process adapter. */
export function parseQwenTtsServerMessage(message: unknown): QwenTtsRealtimeServerMessage {
  const root = recordValue(JSON.parse(textFromSocketMessage(message)) as unknown)
  if (!root)
    throw new Error('Qwen3 realtime TTS event payload is malformed.')
  const type = root?.type
  if (typeof type !== 'string')
    throw new Error('Qwen3 realtime TTS event type is missing.')

  if (type === 'session.created' || type === 'session.updated' || type === 'response.created' || type === 'response.done') {
    const key = type.startsWith('response') ? 'response' : 'session'
    const payload = recordValue(root[key])
    if (!payload)
      throw new Error(`Qwen3 realtime TTS ${type} payload is malformed.`)
    return type === 'session.created'
      ? { type, session: payload }
      : type === 'session.updated'
        ? { type, session: payload }
        : type === 'response.created'
          ? { type, response: payload }
          : { type, response: payload }
  }

  if (type === 'response.audio.delta') {
    if (typeof root.delta !== 'string' || root.delta.length === 0)
      throw new Error('Qwen3 realtime TTS audio delta is missing.')
    return { type, delta: root.delta }
  }

  if (type === 'error') {
    const error = recordValue(root.error)
    const code = error && typeof error.code === 'string' ? error.code : undefined
    const message = error && typeof error.message === 'string' ? error.message : undefined
    if (!code && !message)
      throw new Error('Qwen3 realtime TTS error payload is malformed.')
    return { type, ...(code ? { code } : {}), ...(message ? { message } : {}) }
  }

  if (type === 'response.audio.done' || type === 'session.finished')
    return { type }

  return { type: 'unknown', eventType: type }
}

function strictBase64Bytes(value: string): Uint8Array {
  const normalized = value.trim()
  if (!normalized || !/^[A-Z\d+/]*={0,2}$/i.test(normalized) || normalized.length % 4 === 1)
    throw new Error('Qwen3 realtime TTS audio delta is not valid base64.')

  const decoded = Buffer.from(normalized, 'base64')
  const canonical = decoded.toString('base64').replace(/=+$/, '')
  if (canonical !== normalized.replace(/=+$/, ''))
    throw new Error('Qwen3 realtime TTS audio delta is not valid base64.')
  return Uint8Array.from(decoded)
}

export function decodeQwenTtsAudioDelta(value: string): ArrayBuffer {
  const bytes = strictBase64Bytes(value)
  if (bytes.byteLength === 0)
    throw new Error('Qwen3 realtime TTS audio delta is empty.')
  if (bytes.byteLength % 2 !== 0)
    throw new Error('Qwen3 realtime TTS PCM16 audio delta has an odd byte length.')
  return Uint8Array.from(bytes).buffer
}

export function sanitizeQwenTtsDiagnostic(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const sanitized = value
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(authorization|api[-_ ]?key|token|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .split('')
    .map(character => character.charCodeAt(0) <= 0x1F || character.charCodeAt(0) === 0x7F ? ' ' : character)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized ? sanitized.slice(0, MAX_DIAGNOSTIC_LENGTH) : undefined
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.map(recordValue).find((value): value is Record<string, unknown> => Boolean(value))
}

function statusFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599)
      return value
    if (typeof value === 'string') {
      const match = /\b([1-5]\d{2})\b/.exec(value)
      if (match)
        return Number(match[1])
    }
  }
  return undefined
}

export function qwenTtsSocketErrorMessage(error: unknown, detail?: unknown): string {
  const errorRecord = recordValue(error)
  const detailRecord = recordValue(detail)
  const responseRecord = firstRecord(errorRecord?.response, detailRecord?.response)
  const type = sanitizeQwenTtsDiagnostic(errorRecord?.name ?? errorRecord?.type ?? (error instanceof Error ? error.constructor.name : undefined))
  const code = sanitizeQwenTtsDiagnostic(errorRecord?.code ?? detailRecord?.code)
  const status = statusFrom(errorRecord?.statusCode, errorRecord?.status, detailRecord?.statusCode, detailRecord?.status, responseRecord?.statusCode, responseRecord?.status, code, errorRecord?.message, detailRecord?.message)
  const message = sanitizeQwenTtsDiagnostic(errorRecord?.message ?? detailRecord?.message ?? errorMessageFrom(error))
  return [
    type ? `type=${type}` : undefined,
    status ? `status=${status}` : undefined,
    code && !/^\d+$/.test(code) ? `code=${code}` : undefined,
    message ? `message=${message}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('; ') || 'details unavailable'
}

export function qwenTtsCloseMessage(code: unknown, reason: unknown): string {
  const closeCode = typeof code === 'number' && Number.isInteger(code) ? `close_code=${code}` : undefined
  const closeReason = sanitizeQwenTtsDiagnostic(
    typeof reason === 'string'
      ? reason
      : reason instanceof Uint8Array
        ? new TextDecoder().decode(reason)
        : reason instanceof ArrayBuffer
          ? new TextDecoder().decode(reason)
          : undefined,
  )
  return [closeCode, closeReason ? `close_reason=${closeReason}` : undefined]
    .filter((value): value is string => Boolean(value))
    .join('; ') || 'details unavailable'
}

export function qwenTtsServerErrorMessage(code?: string, message?: string): string {
  return [
    code ? `error_code=${sanitizeQwenTtsDiagnostic(code)}` : undefined,
    message ? `error_message=${sanitizeQwenTtsDiagnostic(message)}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('; ') || 'details unavailable'
}

export interface QwenTtsRealtimeTelemetry {
  t1: number
  t2?: number
  t3a?: number
  t3?: number
  t4?: number
  t5?: number
  t8?: number
  t9?: number
  connectLatencyMs?: number
  sessionReadyLatencyMs?: number
  firstSentTextToFirstAudioMs?: number
  finishToSessionFinishedMs?: number
}

export interface QwenTtsRealtimeSessionCallbacks {
  onReady: () => void | Promise<void>
  onAudioDelta: (audio: ArrayBuffer, sequence: number) => void | Promise<void>
  onResponseDone: () => void | Promise<void>
  onFinished: () => void | Promise<void>
  onError: (error: Error) => void | Promise<void>
  onTelemetry?: (telemetry: QwenTtsRealtimeTelemetry) => void
}

function difference(later: number | undefined, earlier: number | undefined): number | undefined {
  return later !== undefined && earlier !== undefined ? Math.max(0, Math.round(later - earlier)) : undefined
}

/** Owns one Qwen3 realtime TTS WebSocket session in Electron main. */
export class Qwen3TtsRealtimeSession {
  private readonly completion: Promise<void>
  private readonly endpoint: string
  private readonly telemetry: QwenTtsRealtimeTelemetry
  private readonly now: () => number
  private readonly preReadyText: string[] = []
  private preReadyTextChars = 0
  private messageChain = Promise.resolve()
  private socket?: QwenTtsRealtimeSocket
  private state: QwenTtsRealtimeSessionState = 'created_local'
  private sessionCreatedSeen = false
  private sessionUpdatedSeen = false
  private sessionUpdateSent = false
  private finishRequested = false
  private finishSent = false
  private audioSequence = 0
  private terminalError?: Error
  private resolveCompletion!: () => void
  private rejectCompletion!: (error: Error) => void

  constructor(
    readonly sessionId: string,
    private readonly config: QwenTtsRealtimeRuntimeConfig,
    private readonly voice: string,
    private readonly languageType: Qwen3TtsRealtimeLanguageType,
    private readonly mode: Qwen3TtsRealtimeMode,
    private readonly callbacks: QwenTtsRealtimeSessionCallbacks,
    private readonly socketFactory: QwenTtsRealtimeSocketFactory = createQwenTtsRealtimeSocket,
    now: () => number = () => performance.now(),
    model: Qwen3TtsRealtimeModelId = QWEN3_TTS_REALTIME_DEFAULT_MODEL,
  ) {
    this.endpoint = buildQwenTtsRealtimeEndpoint(config.region, model)
    this.now = now
    this.telemetry = { t1: 0 }
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
    this.completion.catch(() => {})
  }

  get stateValue() {
    return this.state
  }

  getTelemetry() {
    return { ...this.telemetry }
  }

  getEndpoint() {
    return this.endpoint
  }

  start(): void {
    if (this.state !== 'created_local')
      throw new Error('Qwen3 realtime TTS session has already started.')
    this.telemetry.t1 = this.now()
    this.state = 'connecting'
    try {
      this.socket = this.socketFactory(this.endpoint, buildQwenTtsRealtimeHeaders(this.config))
      this.socket.on('open', () => this.handleOpen())
      this.socket.on('message', (message) => {
        this.messageChain = this.messageChain
          .then(() => this.handleMessage(message))
          .catch(error => this.fail('protocol_error', errorMessageFrom(error) ?? 'Qwen3 realtime TTS message handling failed.'))
      })
      this.socket.on('error', (error, detail) => {
        void this.fail('websocket_error', `Qwen3 realtime TTS WebSocket failed (${qwenTtsSocketErrorMessage(error, detail)}).`)
      })
      this.socket.on('close', (code, reason) => {
        void this.handleClose(code, reason)
      })
    }
    catch (error) {
      void this.fail('connect_error', `Qwen3 realtime TTS could not connect (${qwenTtsSocketErrorMessage(error)}).`)
    }
  }

  appendText(text: string): void {
    if (!text.length)
      throw new Error('Qwen3 realtime TTS text append must be non-empty.')
    if (this.finishRequested || this.state === 'finishing')
      throw new Error('Qwen3 realtime TTS cannot append text after finish.')
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      throw this.terminalError ?? new Error('Qwen3 realtime TTS session is not accepting text.')

    if (this.state !== 'ready') {
      if (this.preReadyTextChars + text.length > MAX_PRE_READY_TEXT_CHARS) {
        const error = new Error('Qwen3 realtime TTS pre-ready text buffer is full.')
        void this.fail('pre_ready_text_overflow', error.message)
        throw error
      }
      this.preReadyText.push(text)
      this.preReadyTextChars += text.length
      return
    }

    this.sendText(text)
  }

  finish(): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled')
      return Promise.resolve()
    if (this.state === 'failed')
      return this.completion
    if (this.state === 'created_local')
      throw new Error('Qwen3 realtime TTS session has not started.')
    if (this.finishRequested)
      return this.completion

    this.finishRequested = true
    if (this.state === 'ready')
      this.sendFinishIfReady()
    return this.completion
  }

  cancel(): void {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    this.state = 'cancelled'
    this.preReadyText.length = 0
    this.preReadyTextChars = 0
    this.socket?.terminate?.()
    this.socket?.close(1000, 'cancelled')
    this.resolveCompletion()
  }

  private handleOpen(): void {
    if (this.state !== 'connecting')
      return
    this.telemetry.t2 = this.now()
    this.state = 'waiting_session_created'
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return

    let event: QwenTtsRealtimeServerMessage
    try {
      event = parseQwenTtsServerMessage(message)
    }
    catch (error) {
      await this.fail('malformed_response', errorMessageFrom(error) ?? 'Qwen3 realtime TTS returned a malformed event.')
      return
    }

    if (event.type === 'unknown')
      return

    if (event.type === 'session.created') {
      if (this.sessionCreatedSeen)
        return
      this.sessionCreatedSeen = true
      this.telemetry.t3a = this.now()
      this.sendSessionUpdate()
      return
    }

    if (event.type === 'session.updated') {
      if (this.sessionUpdatedSeen)
        return
      if (!this.sessionCreatedSeen || !this.sessionUpdateSent) {
        await this.fail('protocol_error', 'Qwen3 realtime TTS session.updated arrived before session.update.')
        return
      }
      this.sessionUpdatedSeen = true
      this.telemetry.t3 = this.now()
      this.state = 'ready'
      await this.callbacks.onReady()
      this.flushPreReadyText()
      this.sendFinishIfReady()
      return
    }

    if (event.type === 'response.created')
      return

    if (event.type === 'response.audio.delta') {
      if (this.state !== 'ready' && this.state !== 'finishing') {
        await this.fail('protocol_error', 'Qwen3 realtime TTS audio arrived before session readiness.')
        return
      }
      let audio: ArrayBuffer
      try {
        audio = decodeQwenTtsAudioDelta(event.delta)
      }
      catch (error) {
        await this.fail('audio_error', errorMessageFrom(error) ?? 'Qwen3 realtime TTS audio delta is invalid.')
        return
      }
      this.telemetry.t5 ??= this.now()
      await this.callbacks.onAudioDelta(audio, this.audioSequence++)
      return
    }

    if (event.type === 'response.done') {
      if (event.response.status === 'failed') {
        await this.fail('server_error', `Qwen3 realtime TTS response failed (${qwenTtsServerErrorMessage(
          typeof event.response.error_code === 'string' ? event.response.error_code : undefined,
          typeof event.response.error_message === 'string' ? event.response.error_message : undefined,
        )}).`)
        return
      }
      await this.callbacks.onResponseDone()
      return
    }

    if (event.type === 'error') {
      await this.fail('server_error', `Qwen3 realtime TTS server error (${qwenTtsServerErrorMessage(event.code, event.message)}).`)
      return
    }

    if (event.type === 'session.finished') {
      if (this.state !== 'finishing') {
        await this.fail('protocol_error', 'Qwen3 realtime TTS session.finished arrived before session.finish.')
        return
      }
      await this.finishSuccessfully()
    }
  }

  private sendSessionUpdate(): void {
    if (this.sessionUpdateSent)
      return
    this.sessionUpdateSent = true
    this.state = 'waiting_session_updated'
    this.safeSend(JSON.stringify(buildQwenTtsSessionUpdateFrame(this.voice, this.languageType, this.mode)))
  }

  private flushPreReadyText(): void {
    const queued = this.preReadyText.splice(0)
    this.preReadyTextChars = 0
    for (const text of queued)
      this.sendText(text)
  }

  private sendText(text: string): void {
    if (this.telemetry.t4 === undefined)
      this.telemetry.t4 = this.now()
    this.safeSend(JSON.stringify(buildQwenTtsTextAppendFrame(text)))
  }

  private sendFinishIfReady(): void {
    if (!this.finishRequested || this.finishSent || !this.sessionUpdatedSeen || this.state !== 'ready')
      return
    this.finishSent = true
    this.state = 'finishing'
    this.telemetry.t8 = this.now()
    this.safeSend(JSON.stringify(buildQwenTtsSessionFinishFrame()))
  }

  private safeSend(data: string): void {
    if (!this.socket) {
      void this.fail('send_error', 'Qwen3 realtime TTS socket is unavailable.')
      return
    }
    if (this.socket.readyState !== CONNECTING && this.socket.readyState !== OPEN) {
      void this.fail('send_error', 'Qwen3 realtime TTS socket is not open.')
      return
    }
    try {
      this.socket.send(data)
    }
    catch (error) {
      void this.fail('send_error', `Qwen3 realtime TTS send failed (${qwenTtsSocketErrorMessage(error)}).`)
    }
  }

  private async finishSuccessfully(): Promise<void> {
    if (this.state !== 'finishing')
      return
    this.state = 'finished'
    this.telemetry.t9 = this.now()
    this.telemetry.connectLatencyMs = difference(this.telemetry.t2, this.telemetry.t1)
    this.telemetry.sessionReadyLatencyMs = difference(this.telemetry.t3, this.telemetry.t2)
    this.telemetry.firstSentTextToFirstAudioMs = difference(this.telemetry.t5, this.telemetry.t4)
    this.telemetry.finishToSessionFinishedMs = difference(this.telemetry.t9, this.telemetry.t8)
    this.callbacks.onTelemetry?.({ ...this.telemetry })
    try {
      await this.callbacks.onFinished()
    }
    catch {
      // Delivery cleanup must not leave the graceful session promise pending.
    }
    finally {
      this.resolveCompletion()
      this.socket?.close(1000, 'session-finished')
    }
  }

  private async handleClose(code?: unknown, reason?: unknown): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    await this.fail('unexpected_close', `Qwen3 realtime TTS WebSocket closed unexpectedly (${qwenTtsCloseMessage(code, reason)}).`)
  }

  private async fail(code: string, message: string): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    this.state = 'failed'
    this.preReadyText.length = 0
    this.preReadyTextChars = 0
    const error = new Error(`${code}: ${sanitizeQwenTtsDiagnostic(message) ?? 'details unavailable'}`)
    this.terminalError = error
    this.socket?.terminate?.()
    this.socket?.close()
    this.rejectCompletion(error)
    try {
      await this.callbacks.onError(error)
    }
    catch {
      // The first terminal error is already retained and surfaced by the service.
    }
  }
}

export {
  QWEN3_TTS_REALTIME_DEFAULT_MODEL,
}
