import process from 'node:process'

import QwenWebSocket from 'crossws/websocket'

export const QWEN_AUDIO_REALTIME_ASR_MODEL = 'qwen-audio-3.0-asr-flash-streaming'
export const QWEN_ASR_SAMPLE_RATE = 16_000
export const MAX_PRESTART_BUFFER_BYTES = 256 * 1024

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
  on: (event: 'open' | 'message' | 'error' | 'close', listener: (message?: unknown) => void) => void
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
    model: typeof QWEN_AUDIO_REALTIME_ASR_MODEL
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

export function buildQwenRunTaskFrame(taskId: string, language: QwenAudioRealtimeAsrLanguage = 'auto'): QwenRunTaskFrame {
  const languageHints = language === 'auto' ? undefined : [language]
  return {
    header: { action: 'run-task', streaming: 'duplex', task_id: taskId },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: QWEN_AUDIO_REALTIME_ASR_MODEL,
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
    | { action: 'task-failed', taskId: string }
    | { action: 'ignored', originalAction: string, taskId: string }

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
  throw new Error('Qwen Audio realtime ASR returned an unsupported message.')
}

/** Parses and validates only the part of the official server event contract AIRI consumes. */
export function parseQwenServerMessage(message: unknown, expectedTaskId: string): QwenServerMessage {
  const parsed = JSON.parse(textFromSocketMessage(message)) as unknown
  const root = recordValue(parsed)
  const header = recordValue(root?.header)
  const taskId = header?.task_id
  const action = header?.action

  if (typeof taskId !== 'string' || taskId !== expectedTaskId || typeof action !== 'string')
    throw new Error('Qwen Audio realtime ASR returned an invalid task event.')

  if (action !== 'result-generated') {
    if (action === 'task-started' || action === 'task-finished' || action === 'task-failed')
      return { action, taskId }
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
    || typeof endTime !== 'number'
    || typeof sentenceEnd !== 'boolean'
    || endTime < beginTime
  ) {
    throw new Error('Qwen Audio realtime ASR returned an invalid sentence event.')
  }

  return {
    action,
    taskId,
    sentence: {
      durationMilliseconds: endTime - beginTime,
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
      this.socket.on('error', () => {
        void this.fail('websocket_error', 'Qwen Audio realtime ASR WebSocket failed.')
      })
      this.socket.on('close', () => {
        void this.handleClose()
      })
    }
    catch {
      void this.fail('connect_error', 'Qwen Audio realtime ASR could not connect.')
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
    this.socket?.send(JSON.stringify(buildQwenRunTaskFrame(this.taskId, this.language)))
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
      await this.fail('task_failed', 'Qwen Audio realtime ASR task failed.')
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

  private async handleClose() {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    await this.fail('unexpected_close', 'Qwen Audio realtime ASR WebSocket closed unexpectedly.')
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
