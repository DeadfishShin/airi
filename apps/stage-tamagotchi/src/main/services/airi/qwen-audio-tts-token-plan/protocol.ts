import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import QwenWebSocket from 'crossws/websocket'

import { errorMessageFrom } from '@moeru/std'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE,
  QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'

export const QWEN_AUDIO_TTS_TOKEN_PLAN_ENDPOINT = 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_DEFAULT_VOICE = QWEN_AUDIO_TTS_TOKEN_PLAN_VOICE_ID
export const QWEN_AUDIO_TTS_TOKEN_PLAN_TEXT_TYPE = 'PlainText'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_FORMAT = 'pcm'
export const QWEN_AUDIO_TTS_TOKEN_PLAN_VOLUME = 50
export const QWEN_AUDIO_TTS_TOKEN_PLAN_RATE = 1.0
export const QWEN_AUDIO_TTS_TOKEN_PLAN_PITCH = 1.0
export const MAX_PRE_READY_TEXT_CHARS = 32 * 1024
export const MAX_TERMINAL_ERROR_TOMBSTONES = 32
export const TERMINAL_ERROR_TOMBSTONE_TTL_MS = 30_000

const MAX_DIAGNOSTIC_LENGTH = 240
const OPEN = 1

export interface QwenAudioTtsTokenPlanRuntimeConfig {
  apiKey: string
}

/** Token Plan deliberately has its own credential authority and no PAYG fallback. */
export function resolveQwenAudioTtsTokenPlanRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): QwenAudioTtsTokenPlanRuntimeConfig {
  const apiKey = environment.TOKEN_PLAN_API_KEY?.trim() ?? ''
  if (!apiKey)
    throw new Error('Qwen Audio Token Plan TTS API key is unavailable.')
  if (/[\r\n]/.test(apiKey))
    throw new Error('Qwen Audio Token Plan TTS API key is invalid.')
  return { apiKey }
}

export function buildQwenAudioTtsTokenPlanEndpoint(): string {
  return QWEN_AUDIO_TTS_TOKEN_PLAN_ENDPOINT
}

export function buildQwenAudioTtsTokenPlanHeaders(config: QwenAudioTtsTokenPlanRuntimeConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` }
}

export interface QwenAudioTtsTokenPlanSocketOn {
  (event: 'open', listener: () => void): void
  (event: 'message', listener: (message: unknown, isBinary?: boolean) => void): void
  (event: 'error', listener: (error: unknown, detail?: unknown) => void): void
  (event: 'close', listener: (code?: number, reason?: string | Uint8Array) => void): void
}

export interface QwenAudioTtsTokenPlanSocket {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  terminate?: () => void
  on: QwenAudioTtsTokenPlanSocketOn
}

export type QwenAudioTtsTokenPlanSocketFactory = (
  endpoint: string,
  headers: Record<string, string>,
) => QwenAudioTtsTokenPlanSocket

type QwenWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => QwenAudioTtsTokenPlanSocket

/** Uses the already-installed crossws Node adapter; no renderer socket is involved. */
export const createQwenAudioTtsTokenPlanSocket: QwenAudioTtsTokenPlanSocketFactory = (endpoint, headers) => {
  const WebSocketConstructor = QwenWebSocket as unknown as QwenWebSocketConstructor
  return new WebSocketConstructor(endpoint, undefined, { headers })
}

interface TokenPlanFrameHeader {
  action: 'run-task' | 'continue-task' | 'finish-task'
  task_id: string
  streaming: 'duplex'
}

interface RunTaskFrame {
  header: TokenPlanFrameHeader
  payload: {
    task_group: 'audio'
    task: 'tts'
    function: 'SpeechSynthesizer'
    model: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL
    parameters: {
      text_type: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_TEXT_TYPE
      voice: string
      format: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_FORMAT
      sample_rate: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE
      volume: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_VOLUME
      rate: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_RATE
      pitch: typeof QWEN_AUDIO_TTS_TOKEN_PLAN_PITCH
      enable_ssml: false
    }
    input: Record<string, never>
  }
}

interface ContinueTaskFrame {
  header: TokenPlanFrameHeader
  payload: { input: { text: string } }
}

interface FinishTaskFrame {
  header: TokenPlanFrameHeader
  payload: { input: Record<string, never> }
}

interface CancelTaskFrame {
  header: TokenPlanFrameHeader
  payload: { input: { directive: 'cancel' } }
}

function frameHeader(action: TokenPlanFrameHeader['action'], taskId: string): TokenPlanFrameHeader {
  return { action, task_id: taskId, streaming: 'duplex' }
}

export function buildQwenAudioTtsTokenPlanRunTaskFrame(
  taskId: string,
  voice = QWEN_AUDIO_TTS_TOKEN_PLAN_DEFAULT_VOICE,
): RunTaskFrame {
  return {
    header: frameHeader('run-task', taskId),
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
      parameters: {
        text_type: QWEN_AUDIO_TTS_TOKEN_PLAN_TEXT_TYPE,
        voice,
        format: QWEN_AUDIO_TTS_TOKEN_PLAN_FORMAT,
        sample_rate: QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE,
        volume: QWEN_AUDIO_TTS_TOKEN_PLAN_VOLUME,
        rate: QWEN_AUDIO_TTS_TOKEN_PLAN_RATE,
        pitch: QWEN_AUDIO_TTS_TOKEN_PLAN_PITCH,
        enable_ssml: false,
      },
      input: {},
    },
  }
}

export function buildQwenAudioTtsTokenPlanContinueTaskFrame(taskId: string, text: string): ContinueTaskFrame {
  return {
    header: frameHeader('continue-task', taskId),
    payload: { input: { text } },
  }
}

export function buildQwenAudioTtsTokenPlanFinishTaskFrame(taskId: string): FinishTaskFrame {
  return {
    header: frameHeader('finish-task', taskId),
    payload: { input: {} },
  }
}

export function buildQwenAudioTtsTokenPlanCancelTaskFrame(taskId: string): CancelTaskFrame {
  return {
    header: frameHeader('finish-task', taskId),
    payload: { input: { directive: 'cancel' } },
  }
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
  throw new Error('Qwen Audio Token Plan TTS returned an unsupported text WebSocket message.')
}

export type QwenAudioTtsTokenPlanServerMessage
  = | { type: 'task-started' }
    | { type: 'result-generated', outputType: 'sentence-begin' | 'sentence-synthesis' | 'sentence-end' }
    | { type: 'task-finished' }
    | { type: 'task-failed', errorCode?: string, errorMessage?: string }
    | { type: 'unknown', eventType: string }

export function parseQwenAudioTtsTokenPlanServerMessage(message: unknown): QwenAudioTtsTokenPlanServerMessage {
  const root = recordValue(JSON.parse(textFromSocketMessage(message)) as unknown)
  const header = recordValue(root?.header)
  const event = header?.event
  if (!root || !header || typeof event !== 'string')
    throw new Error('Qwen Audio Token Plan TTS server event is malformed.')

  if (event === 'task-started')
    return { type: event }
  if (event === 'task-finished')
    return { type: event }
  if (event === 'task-failed') {
    const errorCode = typeof header.error_code === 'string' ? header.error_code : undefined
    const errorMessage = typeof header.error_message === 'string' ? header.error_message : undefined
    return { type: event, ...(errorCode ? { errorCode } : {}), ...(errorMessage ? { errorMessage } : {}) }
  }
  if (event === 'result-generated') {
    const payload = recordValue(root.payload)
    const output = recordValue(payload?.output)
    const outputType = output?.type
    if (outputType !== 'sentence-begin' && outputType !== 'sentence-synthesis' && outputType !== 'sentence-end')
      throw new Error('Qwen Audio Token Plan TTS result-generated output is malformed.')
    return { type: event, outputType }
  }

  return { type: 'unknown', eventType: event }
}

function binaryFromSocketMessage(message: unknown): ArrayBuffer | undefined {
  if (message instanceof ArrayBuffer)
    return message.slice(0)
  if (ArrayBuffer.isView(message))
    return Uint8Array.from(new Uint8Array(message.buffer, message.byteOffset, message.byteLength)).buffer
  if (Buffer.isBuffer(message))
    return Uint8Array.from(message).buffer
  return undefined
}

export function decodeQwenAudioTtsTokenPlanBinaryAudio(message: unknown): ArrayBuffer {
  const audio = binaryFromSocketMessage(message)
  if (!audio || audio.byteLength === 0)
    throw new Error('Qwen Audio Token Plan TTS binary audio is empty or unsupported.')
  if (audio.byteLength % 2 !== 0)
    throw new Error('Qwen Audio Token Plan TTS PCM16 binary audio has an odd byte length.')
  return audio
}

export function sanitizeQwenAudioTtsTokenPlanDiagnostic(value: unknown): string | undefined {
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

export function qwenAudioTtsTokenPlanSocketErrorMessage(error: unknown, detail?: unknown): string {
  const errorRecord = recordValue(error)
  const detailRecord = recordValue(detail)
  const response = recordValue(errorRecord?.response) ?? recordValue(detailRecord?.response)
  const type = sanitizeQwenAudioTtsTokenPlanDiagnostic(errorRecord?.name ?? errorRecord?.type ?? (error instanceof Error ? error.constructor.name : undefined))
  const status = statusFrom(errorRecord?.statusCode, errorRecord?.status, detailRecord?.statusCode, detailRecord?.status, response?.statusCode, response?.status, errorRecord?.message, detailRecord?.message)
  const message = sanitizeQwenAudioTtsTokenPlanDiagnostic(errorRecord?.message ?? detailRecord?.message ?? errorMessageFrom(error))
  return [
    type ? `type=${type}` : undefined,
    status ? `status=${status}` : undefined,
    message ? `message=${message}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('; ') || 'details unavailable'
}

export type QwenAudioTtsTokenPlanSessionState
  = | 'created_local'
    | 'connecting'
    | 'waiting_task_started'
    | 'ready'
    | 'finishing'
    | 'finished'
    | 'cancelled'
    | 'failed'

export interface QwenAudioTtsTokenPlanTelemetry {
  t1: number
  t2?: number
  t3?: number
  t4?: number
  t5?: number
  t8?: number
  t9?: number
  connectLatencyMs?: number
  taskStartedLatencyMs?: number
  firstSentTextToFirstAudioMs?: number
  finishToTaskFinishedMs?: number
}

export interface QwenAudioTtsTokenPlanSessionCallbacks {
  onReady: () => void | Promise<void>
  onAudioDelta: (audio: ArrayBuffer, sequence: number) => void | Promise<void>
  onResponseDone: () => void | Promise<void>
  onFinished: () => void | Promise<void>
  onError: (error: Error) => void | Promise<void>
  onTelemetry?: (telemetry: QwenAudioTtsTokenPlanTelemetry) => void
  onDiagnostic?: (milestone: QwenAudioTtsTokenPlanMainMilestone, details?: QwenAudioTtsTokenPlanMainDiagnosticDetails) => void
}

export type QwenAudioTtsTokenPlanMainMilestone
  = | 'MAIN_SESSION_START_RECEIVED'
    | 'TOKEN_PLAN_CREDENTIAL_PRESENT'
    | 'SOCKET_CREATED'
    | 'SOCKET_OPEN'
    | 'RUN_TASK_SENT'
    | 'TASK_STARTED'
    | 'FIRST_CONTINUE_TASK_SENT'
    | 'FIRST_BINARY_AUDIO_RECEIVED'
    | 'FINISH_TASK_SENT'
    | 'TASK_FINISHED'
    | 'TASK_FAILED'
    | 'SOCKET_ERROR'
    | 'SOCKET_CLOSE'

export interface QwenAudioTtsTokenPlanMainDiagnosticDetails {
  credentialPresent?: boolean
  code?: string
  message?: string
  closeCode?: number
  closeReason?: string
}

function difference(later: number | undefined, earlier: number | undefined): number | undefined {
  return later !== undefined && earlier !== undefined ? Math.max(0, Math.round(later - earlier)) : undefined
}

/** Owns one Token Plan native Qwen-Audio-TTS task in Electron main. */
export class QwenAudioTtsTokenPlanSession {
  private readonly completion: Promise<void>
  private readonly telemetry: QwenAudioTtsTokenPlanTelemetry
  private readonly now: () => number
  private readonly taskId = randomUUID()
  private readonly preReadyText: string[] = []
  private preReadyTextChars = 0
  private messageChain = Promise.resolve()
  private socket?: QwenAudioTtsTokenPlanSocket
  private state: QwenAudioTtsTokenPlanSessionState = 'created_local'
  private taskStartedSeen = false
  private finishRequested = false
  private finishSent = false
  private audioSequence = 0
  private terminalError?: Error
  private readonly emittedDiagnostics = new Set<QwenAudioTtsTokenPlanMainMilestone>()
  private resolveCompletion!: () => void
  private rejectCompletion!: (error: Error) => void

  constructor(
    readonly sessionId: string,
    private readonly config: QwenAudioTtsTokenPlanRuntimeConfig,
    private readonly voice: string,
    private readonly callbacks: QwenAudioTtsTokenPlanSessionCallbacks,
    private readonly socketFactory: QwenAudioTtsTokenPlanSocketFactory = createQwenAudioTtsTokenPlanSocket,
    now: () => number = () => performance.now(),
  ) {
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

  private emitDiagnostic(milestone: QwenAudioTtsTokenPlanMainMilestone, details?: QwenAudioTtsTokenPlanMainDiagnosticDetails) {
    if (this.emittedDiagnostics.has(milestone))
      return
    this.emittedDiagnostics.add(milestone)
    this.callbacks.onDiagnostic?.(milestone, details)
  }

  start(): void {
    if (this.state !== 'created_local')
      throw new Error('Qwen Audio Token Plan TTS session has already started.')
    this.telemetry.t1 = this.now()
    this.state = 'connecting'
    try {
      this.socket = this.socketFactory(buildQwenAudioTtsTokenPlanEndpoint(), buildQwenAudioTtsTokenPlanHeaders(this.config))
      this.emitDiagnostic('SOCKET_CREATED')
      this.socket.on('open', () => this.handleOpen())
      this.socket.on('message', (message, isBinary) => {
        this.messageChain = this.messageChain
          .then(() => this.handleMessage(message, isBinary))
          .catch(error => this.fail('protocol_error', errorMessageFrom(error) ?? 'Qwen Audio Token Plan TTS message handling failed.'))
      })
      this.socket.on('error', (error, detail) => {
        const diagnostic = qwenAudioTtsTokenPlanSocketErrorMessage(error, detail)
        this.emitDiagnostic('SOCKET_ERROR', { message: diagnostic })
        void this.fail('websocket_error', `Qwen Audio Token Plan TTS WebSocket failed (${diagnostic}).`)
      })
      this.socket.on('close', (code, reason) => {
        void this.handleClose(code, reason)
      })
    }
    catch (error) {
      const diagnostic = qwenAudioTtsTokenPlanSocketErrorMessage(error)
      this.emitDiagnostic('SOCKET_ERROR', { message: diagnostic })
      void this.fail('connect_error', `Qwen Audio Token Plan TTS could not connect (${diagnostic}).`)
    }
  }

  appendText(text: string): void {
    if (!text.length)
      return
    if (this.finishRequested || this.state === 'finishing')
      throw new Error('Qwen Audio Token Plan TTS cannot append text after finish.')
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      throw this.terminalError ?? new Error('Qwen Audio Token Plan TTS session is not accepting text.')

    if (this.state !== 'ready') {
      if (this.preReadyTextChars + text.length > MAX_PRE_READY_TEXT_CHARS) {
        const error = new Error('Qwen Audio Token Plan TTS pre-ready text buffer is full.')
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
      throw new Error('Qwen Audio Token Plan TTS session has not started.')
    if (this.finishRequested)
      return this.completion

    this.finishRequested = true
    this.sendFinishIfReady()
    return this.completion
  }

  cancel(): void {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    this.state = 'cancelled'
    this.preReadyText.length = 0
    this.preReadyTextChars = 0
    if (this.taskStartedSeen && this.socket?.readyState === OPEN) {
      try {
        this.socket.send(JSON.stringify(buildQwenAudioTtsTokenPlanCancelTaskFrame(this.taskId)))
      }
      catch {}
    }
    this.socket?.terminate?.()
    this.socket?.close(1000, 'cancelled')
    this.resolveCompletion()
  }

  private handleOpen(): void {
    if (this.state !== 'connecting')
      return
    this.telemetry.t2 = this.now()
    this.state = 'waiting_task_started'
    this.emitDiagnostic('SOCKET_OPEN')
    if (this.safeSend(JSON.stringify(buildQwenAudioTtsTokenPlanRunTaskFrame(this.taskId, this.voice))))
      this.emitDiagnostic('RUN_TASK_SENT')
  }

  private async handleMessage(message: unknown, isBinary?: boolean): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return

    // crossws' Node adapter uses ws' `(data, isBinary)` EventEmitter contract:
    // text data may be a Buffer, so explicit frame metadata must win over shape.
    // Test/fake sockets from older callers may omit the flag; retain the bounded
    // legacy inference only for that compatibility seam.
    const frameIsBinary = isBinary ?? (typeof message !== 'string' && (message instanceof ArrayBuffer || ArrayBuffer.isView(message)))
    if (frameIsBinary) {
      let audio: ArrayBuffer
      try {
        audio = decodeQwenAudioTtsTokenPlanBinaryAudio(message)
      }
      catch (error) {
        await this.fail('audio_error', errorMessageFrom(error) ?? 'Qwen Audio Token Plan TTS binary audio is invalid.')
        return
      }
      if (!this.taskStartedSeen || (this.state !== 'ready' && this.state !== 'finishing')) {
        await this.fail('protocol_error', 'Qwen Audio Token Plan TTS audio arrived before task-started.')
        return
      }
      this.telemetry.t5 ??= this.now()
      this.emitDiagnostic('FIRST_BINARY_AUDIO_RECEIVED')
      await this.callbacks.onAudioDelta(audio, this.audioSequence++)
      return
    }

    let event: QwenAudioTtsTokenPlanServerMessage
    try {
      event = parseQwenAudioTtsTokenPlanServerMessage(message)
    }
    catch (error) {
      await this.fail('malformed_response', errorMessageFrom(error) ?? 'Qwen Audio Token Plan TTS returned a malformed event.')
      return
    }

    if (event.type === 'unknown')
      return
    if (event.type === 'task-started') {
      if (this.taskStartedSeen)
        return
      if (this.state !== 'waiting_task_started') {
        await this.fail('protocol_error', 'Qwen Audio Token Plan TTS task-started arrived in an invalid state.')
        return
      }
      this.taskStartedSeen = true
      this.telemetry.t3 = this.now()
      this.state = 'ready'
      this.emitDiagnostic('TASK_STARTED')
      await this.callbacks.onReady()
      this.flushPreReadyText()
      this.sendFinishIfReady()
      return
    }
    if (event.type === 'result-generated')
      return
    if (event.type === 'task-failed') {
      const detail = qwenAudioTtsTokenPlanServerErrorMessage(event.errorCode, event.errorMessage)
      await this.fail('server_error', `Qwen Audio Token Plan TTS task failed (${detail}).`)
      return
    }
    if (event.type === 'task-finished') {
      if (this.state !== 'finishing') {
        await this.fail('protocol_error', 'Qwen Audio Token Plan TTS task-finished arrived before finish-task.')
        return
      }
      await this.finishSuccessfully()
    }
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
    if (this.safeSend(JSON.stringify(buildQwenAudioTtsTokenPlanContinueTaskFrame(this.taskId, text))))
      this.emitDiagnostic('FIRST_CONTINUE_TASK_SENT')
  }

  private sendFinishIfReady(): void {
    if (!this.finishRequested || this.finishSent || !this.taskStartedSeen || this.state !== 'ready')
      return
    this.finishSent = true
    this.state = 'finishing'
    this.telemetry.t8 = this.now()
    if (this.safeSend(JSON.stringify(buildQwenAudioTtsTokenPlanFinishTaskFrame(this.taskId))))
      this.emitDiagnostic('FINISH_TASK_SENT')
  }

  private safeSend(data: string): boolean {
    if (!this.socket) {
      void this.fail('send_error', 'Qwen Audio Token Plan TTS socket is unavailable.')
      return false
    }
    if (this.socket.readyState !== OPEN) {
      void this.fail('send_error', 'Qwen Audio Token Plan TTS socket is not open.')
      return false
    }
    try {
      this.socket.send(data)
      return true
    }
    catch (error) {
      void this.fail('send_error', `Qwen Audio Token Plan TTS send failed (${qwenAudioTtsTokenPlanSocketErrorMessage(error)}).`)
      return false
    }
  }

  private async finishSuccessfully(): Promise<void> {
    if (this.state !== 'finishing')
      return
    this.state = 'finished'
    this.telemetry.t9 = this.now()
    this.telemetry.connectLatencyMs = difference(this.telemetry.t2, this.telemetry.t1)
    this.telemetry.taskStartedLatencyMs = difference(this.telemetry.t3, this.telemetry.t2)
    this.telemetry.firstSentTextToFirstAudioMs = difference(this.telemetry.t5, this.telemetry.t4)
    this.telemetry.finishToTaskFinishedMs = difference(this.telemetry.t9, this.telemetry.t8)
    this.emitDiagnostic('TASK_FINISHED')
    this.callbacks.onTelemetry?.({ ...this.telemetry })
    try {
      await this.callbacks.onFinished()
    }
    catch {
      // Never leave the transport completion promise pending because delivery cleanup failed.
    }
    finally {
      this.resolveCompletion()
      this.socket?.close(1000, 'task-finished')
    }
  }

  private async handleClose(code?: unknown, reason?: unknown): Promise<void> {
    const closeReason = typeof reason === 'string' ? sanitizeQwenAudioTtsTokenPlanDiagnostic(reason) : undefined
    this.emitDiagnostic('SOCKET_CLOSE', {
      closeCode: typeof code === 'number' ? code : undefined,
      closeReason,
    })
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    await this.fail('unexpected_close', `Qwen Audio Token Plan TTS WebSocket closed unexpectedly (close_code=${typeof code === 'number' ? code : 'unknown'}${closeReason ? `; close_reason=${closeReason}` : ''}).`)
  }

  private async fail(code: string, message: string): Promise<void> {
    if (this.state === 'finished' || this.state === 'cancelled' || this.state === 'failed')
      return
    this.state = 'failed'
    this.preReadyText.length = 0
    this.preReadyTextChars = 0
    const error = new Error(`${code}: ${sanitizeQwenAudioTtsTokenPlanDiagnostic(message) ?? 'details unavailable'}`)
    this.terminalError = error
    this.emitDiagnostic('TASK_FAILED', {
      code,
      message: sanitizeQwenAudioTtsTokenPlanDiagnostic(message),
    })
    this.socket?.terminate?.()
    this.socket?.close()
    this.rejectCompletion(error)
    try {
      await this.callbacks.onError(error)
    }
    catch {
      // First failure is already retained by the service.
    }
  }
}

export function qwenAudioTtsTokenPlanServerErrorMessage(code?: string, message?: string): string {
  return [
    code ? `error_code=${sanitizeQwenAudioTtsTokenPlanDiagnostic(code)}` : undefined,
    message ? `error_message=${sanitizeQwenAudioTtsTokenPlanDiagnostic(message)}` : undefined,
  ].filter((value): value is string => Boolean(value)).join('; ') || 'details unavailable'
}

export {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODEL,
  QWEN_AUDIO_TTS_TOKEN_PLAN_SAMPLE_RATE,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
