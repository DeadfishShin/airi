import type { QwenAudioRealtimeAsrModelId } from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-models'

import process from 'node:process'

import QwenWebSocket from 'crossws/websocket'

import { errorMessageFrom } from '@moeru/std'
import {
  QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-models'

export const QWEN_AUDIO_REALTIME_ASR_MODEL = QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL
export const QWEN_ASR_SAMPLE_RATE = 16_000
export const MAX_PRESTART_BUFFER_BYTES = 256 * 1024
const MAX_ERROR_DETAIL_LENGTH = 240

export type QwenAudioRealtimeRegion = 'singapore' | 'beijing'
export type QwenAudioRealtimeAsrLanguage = 'auto' | 'zh' | 'en'

export interface QwenAudioRealtimeRuntimeConfig {
  apiKey: string
  region: QwenAudioRealtimeRegion
  workspaceId: string
}

export function resolveQwenAudioRealtimeRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): QwenAudioRealtimeRuntimeConfig {
  const apiKey = environment.DASHSCOPE_API_KEY?.trim() ?? ''
  const workspaceId = environment.DASHSCOPE_WORKSPACE_ID?.trim() ?? ''
  const region = environment.DASHSCOPE_REGION?.trim().toLowerCase()

  if (!apiKey || !workspaceId || (region !== 'singapore' && region !== 'beijing'))
    throw new Error('Qwen Audio realtime ASR credentials are incomplete or invalid.')

  if (!/^[a-z0-9-]+$/i.test(workspaceId))
    throw new Error('Qwen Audio realtime ASR workspace ID is invalid.')

  return { apiKey, region, workspaceId }
}

/** Builds the Model Studio endpoint from the region-specific official host. */
export function buildQwenAudioRealtimeEndpoint(region: QwenAudioRealtimeRegion, workspaceId: string): string {
  if (!/^[a-z0-9-]+$/i.test(workspaceId))
    throw new Error('Qwen Audio realtime ASR workspace ID is invalid.')

  const host = region === 'singapore'
    ? `${workspaceId}.ap-southeast-1.maas.aliyuncs.com`
    : `${workspaceId}.cn-beijing.maas.aliyuncs.com`

  return `wss://${host}/api-ws/v1/inference`
}

export interface QwenAudioRealtimeSocket {
  readyState: number
  send: (data: string | Uint8Array) => void
  close: (code?: number, reason?: string) => void
  terminate?: () => void
  on: (event: 'open' | 'message' | 'error' | 'close', listener: (message?: unknown, detail?: unknown) => void) => void
}

export type QwenAudioRealtimeSocketFactory = (
  endpoint: string,
  headers: Record<string, string>,
) => QwenAudioRealtimeSocket

type QwenWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => QwenAudioRealtimeSocket

/**
 * Uses crossws' Node WebSocket implementation so Electron main can send the
 * Authorization header during the handshake. The third argument intentionally
 * selects the bundled ws-compatible client instead of a browser WebSocket.
 */
export const createQwenAudioRealtimeSocket: QwenAudioRealtimeSocketFactory = (endpoint, headers) => {
  const WebSocketConstructor = QwenWebSocket as unknown as QwenWebSocketConstructor
  return new WebSocketConstructor(endpoint, undefined, { headers })
}

export interface QwenRunTaskFrame {
  header: {
    action: 'run-task'
    streaming: 'duplex'
    task_id: string
  }
  payload: {
    function: 'recognition'
    input: Record<string, never>
    model: QwenAudioRealtimeAsrModelId
    parameters: {
      format: 'pcm'
      language_hints?: Array<Exclude<QwenAudioRealtimeAsrLanguage, 'auto'>>
      sample_rate: typeof QWEN_ASR_SAMPLE_RATE
    }
    task: 'asr'
    task_group: 'audio'
  }
}

export interface QwenFinishTaskFrame {
  header: {
    action: 'finish-task'
    streaming: 'duplex'
    task_id: string
  }
  payload: {
    input: Record<string, never>
  }
}

export function buildQwenRunTaskFrame(
  taskId: string,
  modelOrLanguage: QwenAudioRealtimeAsrModelId | QwenAudioRealtimeAsrLanguage = 'auto',
  requestedLanguage: QwenAudioRealtimeAsrLanguage = 'auto',
): QwenRunTaskFrame {
  const isLegacyLanguage = modelOrLanguage === 'auto' || modelOrLanguage === 'zh' || modelOrLanguage === 'en'
  const model = isLegacyLanguage ? QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL : modelOrLanguage
  const language = isLegacyLanguage ? modelOrLanguage : requestedLanguage
  const languageHints = language === 'auto' ? undefined : [language]
  return {
    header: { action: 'run-task', streaming: 'duplex', task_id: taskId },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model,
      parameters: {
        format: 'pcm',
        ...(languageHints ? { language_hints: languageHints } : {}),
        sample_rate: QWEN_ASR_SAMPLE_RATE,
      },
      input: {},
    },
  }
}

export function buildQwenFinishTaskFrame(taskId: string): QwenFinishTaskFrame {
  return {
    header: { action: 'finish-task', streaming: 'duplex', task_id: taskId },
    payload: { input: {} },
  }
}

export interface QwenAsrSentence {
  durationMilliseconds: number
  isFinal: boolean
  sentenceId: number
  startMilliseconds: number
  text: string
}

export type QwenServerMessage
  = | { action: 'task-started', taskId: string }
    | { action: 'result-generated', sentence: QwenAsrSentence, taskId: string }
    | { action: 'task-finished', taskId: string }
    | { action: 'task-failed', errorCode?: string, errorMessage?: string, taskId: string }
    | { action: 'ignored', originalAction: string, taskId: string }

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

/** Keeps provider diagnostics useful without allowing secrets into renderer-visible errors. */
export function sanitizeQwenDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined

  const sanitized = value
    .replace(/bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(authorization|api[-_ ]?key|token|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\bsk-\S+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized ? sanitized.slice(0, MAX_ERROR_DETAIL_LENGTH) : undefined
}

function numericDiagnosticValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value))
      return value
    if (typeof value === 'string') {
      const match = /\b([1-5]\d{2})\b/.exec(value)
      if (match)
        return Number(match[1])
    }
  }
  return undefined
}

function qwenSocketErrorMessage(error: unknown): string {
  const details = recordValue(error)
  const rawMessage = details?.message ?? errorMessageFrom(error) ?? String(error)
  const message = sanitizeQwenDiagnosticText(rawMessage)
  const type = sanitizeQwenDiagnosticText(
    details?.name
    ?? details?.type
    ?? (error instanceof Error ? error.constructor.name : undefined),
  )
  const code = sanitizeQwenDiagnosticText(details?.code)
  const status = numericDiagnosticValue(details?.statusCode, details?.status, details?.code, rawMessage)
  const parts = [
    type ? `type=${type}` : undefined,
    status ? `status=${status}` : undefined,
    code && !/^\d+$/.test(code) ? `code=${code}` : undefined,
    message ? `message=${message}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join('; ') : 'details unavailable'
}

function qwenCloseMessage(code: unknown, reason: unknown): string {
  const closeCode = typeof code === 'number' && Number.isInteger(code) ? `close_code=${code}` : undefined
  const closeReason = sanitizeQwenDiagnosticText(
    typeof reason === 'string'
      ? reason
      : reason instanceof Uint8Array
        ? new TextDecoder().decode(reason)
        : reason instanceof ArrayBuffer
          ? new TextDecoder().decode(reason)
          : undefined,
  )
  return [closeCode, closeReason ? `close_reason=${closeReason}` : undefined]
    .filter((part): part is string => Boolean(part))
    .join('; ') || 'details unavailable'
}

function qwenTaskFailureMessage(errorCode?: string, errorMessage?: string): string {
  const code = sanitizeQwenDiagnosticText(errorCode)
  const message = sanitizeQwenDiagnosticText(errorMessage)
  return [code ? `error_code=${code}` : undefined, message ? `error_message=${message}` : undefined]
    .filter((part): part is string => Boolean(part))
    .join('; ') || 'details unavailable'
}

function textFromSocketMessage(message: unknown): string {
  if (typeof message === 'string')
    return message
  if (message instanceof ArrayBuffer)
    return new TextDecoder().decode(message)
  if (ArrayBuffer.isView(message))
    return new TextDecoder().decode(new Uint8Array(message.buffer, message.byteOffset, message.byteLength))
  throw new Error('Qwen Audio realtime ASR returned an unsupported message.')
}

/** Parses and validates only the part of the official server event contract AIRI consumes. */
export function parseQwenServerMessage(message: unknown, expectedTaskId: string): QwenServerMessage {
  const parsed = JSON.parse(textFromSocketMessage(message)) as unknown
  const root = recordValue(parsed)
  const header = recordValue(root?.header)
  const taskId = header?.task_id
  // Client commands use `action`; current Qwen server events use `event`.
  const action = header?.event ?? header?.action

  if (typeof taskId !== 'string' || taskId !== expectedTaskId || typeof action !== 'string')
    throw new Error('Qwen Audio realtime ASR returned an invalid task event.')

  if (action !== 'result-generated') {
    if (action === 'task-started' || action === 'task-finished')
      return { action, taskId }
    if (action === 'task-failed') {
      return {
        action,
        errorCode: sanitizeQwenDiagnosticText(header?.error_code),
        errorMessage: sanitizeQwenDiagnosticText(header?.error_message),
        taskId,
      }
    }
    return { action: 'ignored', originalAction: action, taskId }
  }

  const payload = recordValue(root?.payload)
  const output = recordValue(payload?.output)
  const sentence = recordValue(output?.sentence)

  if (sentence?.heartbeat === true)
    return { action, taskId, sentence: { durationMilliseconds: 0, isFinal: false, sentenceId: -1, startMilliseconds: 0, text: '' } }

  const sentenceId = sentence?.sentence_id
  const text = sentence?.text
  const beginTime = sentence?.begin_time
  const endTime = sentence?.end_time
  const sentenceEnd = sentence?.sentence_end
  if (
    typeof sentenceId !== 'number'
    || !Number.isInteger(sentenceId)
    || typeof text !== 'string'
    || typeof beginTime !== 'number'
    || (typeof endTime !== 'number' && endTime !== null)
    || typeof sentenceEnd !== 'boolean'
    || (typeof endTime === 'number' && endTime < beginTime)
  ) {
    throw new Error('Qwen Audio realtime ASR returned an invalid sentence event.')
  }

  return {
    action,
    taskId,
    sentence: {
      durationMilliseconds: typeof endTime === 'number' ? endTime - beginTime : 0,
      isFinal: sentenceEnd,
      sentenceId,
      startMilliseconds: beginTime,
      text,
    },
  }
}

export interface QwenAsrTelemetry {
  t0: number
  t1: number
  t2?: number
  t3?: number
  t4?: number
  t5?: number
  t6?: number
  t7?: number
  t8?: number
  t9?: number
  connectLatencyMs?: number
  firstAudioToFirstPartialMs?: number
  finalToAiriDeliveryMs?: number
  speechEndToFinalMs?: number
  speechStartToFirstPartialMs?: number
  taskStartLatencyMs?: number
}

export interface QwenAsrSessionCallbacks {
  onError: (error: Error) => void | Promise<void>
  onFinished: () => void | Promise<void>
  onFinal: (sentence: QwenAsrSentence) => void | Promise<void>
  onPartial: (sentence: QwenAsrSentence) => void | Promise<void>
  onStarted: () => void | Promise<void>
  onTelemetry?: (telemetry: QwenAsrTelemetry) => void
}

type SessionState = 'connecting' | 'streaming' | 'finishing' | 'finished' | 'failed' | 'cancelled'

function difference(later: number | undefined, earlier: number | undefined) {
  return later !== undefined && earlier !== undefined ? Math.max(0, Math.round(later - earlier)) : undefined
}

/** Owns one Qwen duplex task and keeps the wire protocol out of the renderer. */
export class QwenAudioRealtimeAsrSession {
  private readonly completion: Promise<void>
  private readonly endpoint: string
  private readonly now: () => number
  private resolveCompletion!: () => void
  private rejectCompletion!: (error: Error) => void
  private readonly sentences = new Map<number, QwenAsrSentence>()
  private readonly telemetry: QwenAsrTelemetry
  private readonly taskId: string
  private messageChain = Promise.resolve()
  private audioBytes = 0
  private finishSent = false
  private finishRequested = false
  private hasFinalSentence = false
  private queue: Uint8Array[] = []
  private socket?: QwenAudioRealtimeSocket
  private state: SessionState = 'connecting'

  constructor(
    sessionId: string,
    private readonly config: QwenAudioRealtimeRuntimeConfig,
    private readonly language: QwenAudioRealtimeAsrLanguage,
    private readonly callbacks: QwenAsrSessionCallbacks,
    private readonly socketFactory: QwenAudioRealtimeSocketFactory = createQwenAudioRealtimeSocket,
    now: () => number = () => performance.now(),
    private readonly model: QwenAudioRealtimeAsrModelId = QWEN_AUDIO_REALTIME_ASR_DEFAULT_MODEL,
  ) {
    this.endpoint = buildQwenAudioRealtimeEndpoint(config.region, config.workspaceId)
    this.taskId = sessionId
    this.now = now
    this.telemetry = { t0: now(), t1: now() }
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
    // A task can fail before the renderer calls finish. The terminal Eventa is
    // still the authoritative error path, so avoid an unhandled rejection.
    this.completion.catch(() => {})
  }

  getTelemetry() {
    return { ...this.telemetry }
  }

  getEndpoint() {
    return this.endpoint
  }

  start() {
    this.telemetry.t1 = this.now()
    try {
      this.socket = this.socketFactory(this.endpoint, {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-DashScope-WorkSpace': this.config.workspaceId,
      })
      this.socket.on('open', () => this.handleOpen())
      this.socket.on('message', (message) => {
        this.messageChain = this.messageChain
          .then(() => this.handleMessage(message))
          .catch(() => {})
      })
      this.socket.on('error', (error) => {
        void this.fail(
          'websocket_error',
          `Qwen Audio realtime ASR WebSocket failed (${qwenSocketErrorMessage(error)}).`,
        )
      })
      this.socket.on('close', (code, reason) => {
        void this.handleClose(code, reason)
      })
    }
    catch (error) {
      void this.fail(
        'connect_error',
        `Qwen Audio realtime ASR could not connect (${qwenSocketErrorMessage(error)}).`,
      )
    }
  }

  appendAudio(audio: ArrayBuffer): void {
    if (this.state === 'cancelled' || this.state === 'finished' || this.state === 'failed')
      return
    if (this.finishRequested)
      throw new Error('Qwen Audio realtime ASR received audio after finish.')

    const bytes = new Uint8Array(audio)
    if (this.state !== 'streaming' && this.state !== 'finishing') {
      if (this.audioBytes + bytes.byteLength > MAX_PRESTART_BUFFER_BYTES) {
        void this.fail('prestart_buffer_overflow', 'Qwen Audio realtime ASR pre-start audio buffer is full.')
        return
      }
      this.audioBytes += bytes.byteLength
      this.queue.push(bytes)
      return
    }

    this.sendAudio(bytes)
  }

  finish(): Promise<void> {
    if (this.state === 'cancelled' || this.state === 'finished')
      return Promise.resolve()
    if (this.state === 'failed')
      return this.completion

    this.finishRequested = true
    this.telemetry.t6 ??= this.now()
    this.sendFinishIfReady()
    return this.completion
  }

  cancel(): void {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    this.state = 'cancelled'
    this.queue = []
    this.audioBytes = 0
    this.socket?.close(1000, 'cancelled')
    this.resolveCompletion()
  }

  private handleOpen() {
    if (this.state !== 'connecting')
      return
    this.telemetry.t2 = this.now()
    this.socket?.send(JSON.stringify(buildQwenRunTaskFrame(this.taskId, this.model, this.language)))
  }

  private async handleMessage(message: unknown) {
    if (this.state === 'failed' || this.state === 'cancelled' || this.state === 'finished')
      return

    let event: QwenServerMessage
    try {
      event = parseQwenServerMessage(message, this.taskId)
    }
    catch {
      await this.fail('malformed_response', 'Qwen Audio realtime ASR returned an invalid response.')
      return
    }

    if (event.action === 'task-started') {
      this.telemetry.t3 = this.now()
      this.state = 'streaming'
      await this.callbacks.onStarted()
      for (const audio of this.queue)
        this.sendAudio(audio)
      this.queue = []
      this.audioBytes = 0
      this.sendFinishIfReady()
      return
    }

    if (event.action === 'result-generated') {
      if (event.sentence.sentenceId < 0)
        return
      this.sentences.set(event.sentence.sentenceId, event.sentence)
      this.hasFinalSentence ||= event.sentence.isFinal
      const snapshot = this.orderedSentenceSnapshot()
      if (!snapshot.text)
        return

      this.telemetry.t5 ??= this.now()
      await this.callbacks.onPartial(snapshot)
      return
    }

    if (event.action === 'task-failed') {
      await this.fail(
        'task_failed',
        `Qwen Audio realtime ASR task failed (${qwenTaskFailureMessage(event.errorCode, event.errorMessage)}).`,
      )
      return
    }

    if (event.action === 'task-finished')
      await this.handleTaskFinished()
  }

  private async handleTaskFinished() {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return

    const snapshot = this.orderedSentenceSnapshot()
    if (snapshot.text && !this.hasFinalSentence) {
      await this.fail('missing_final_sentence', 'Qwen Audio realtime ASR finished without a final transcript.')
      return
    }

    if (snapshot.text && this.hasFinalSentence) {
      this.telemetry.t8 = this.now()
      this.telemetry.speechEndToFinalMs = difference(this.telemetry.t8, this.telemetry.t6)
      await this.callbacks.onFinal(snapshot)
    }

    this.state = 'finished'
    this.telemetry.t9 = this.now()
    this.telemetry.finalToAiriDeliveryMs = difference(this.telemetry.t9, this.telemetry.t8)
    this.telemetry.connectLatencyMs = difference(this.telemetry.t2, this.telemetry.t1)
    this.telemetry.taskStartLatencyMs = difference(this.telemetry.t3, this.telemetry.t2)
    this.telemetry.speechStartToFirstPartialMs = difference(this.telemetry.t5, this.telemetry.t0)
    this.telemetry.firstAudioToFirstPartialMs = difference(this.telemetry.t5, this.telemetry.t4)
    this.callbacks.onTelemetry?.({ ...this.telemetry })
    await this.callbacks.onFinished()
    this.resolveCompletion()
    this.socket?.close(1000, 'task-finished')
  }

  private async handleClose(code?: unknown, reason?: unknown) {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    await this.fail(
      'unexpected_close',
      `Qwen Audio realtime ASR WebSocket closed unexpectedly (${qwenCloseMessage(code, reason)}).`,
    )
  }

  private orderedSentenceSnapshot(): QwenAsrSentence {
    const ordered = [...this.sentences.values()].sort((left, right) => left.sentenceId - right.sentenceId)
    const first = ordered[0]
    const last = ordered.at(-1)
    return {
      durationMilliseconds: first && last
        ? Math.max(0, last.startMilliseconds + last.durationMilliseconds - first.startMilliseconds)
        : 0,
      isFinal: ordered.some(sentence => sentence.isFinal),
      sentenceId: last?.sentenceId ?? 0,
      startMilliseconds: first?.startMilliseconds ?? 0,
      text: ordered.map(sentence => sentence.text).join(''),
    }
  }

  private sendAudio(audio: Uint8Array) {
    if (this.state === 'cancelled' || this.state === 'failed' || this.state === 'finished')
      return
    if (this.telemetry.t4 === undefined)
      this.telemetry.t4 = this.now()
    this.socket?.send(audio)
  }

  private sendFinishIfReady() {
    if (!this.finishRequested || this.finishSent || this.state !== 'streaming')
      return
    this.finishSent = true
    this.state = 'finishing'
    this.telemetry.t7 = this.now()
    this.socket?.send(JSON.stringify(buildQwenFinishTaskFrame(this.taskId)))
  }

  private async fail(code: string, message: string) {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    this.state = 'failed'
    this.queue = []
    this.audioBytes = 0
    this.socket?.terminate?.()
    this.socket?.close()
    const error = new Error(`${code}: ${message}`)
    this.rejectCompletion(error)
    await this.callbacks.onError(error)
  }
}
