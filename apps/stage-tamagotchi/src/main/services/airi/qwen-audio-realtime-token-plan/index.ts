import type { Eventa, EventContext } from '@moeru/eventa'
import type { ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenAudioRealtimeTokenPlanAudioPayload,
  QwenAudioRealtimeTokenPlanErrorPayload,
  QwenAudioRealtimeTokenPlanSessionPayload,
  QwenAudioRealtimeTokenPlanSessionStartPayload,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-token-plan-ipc'
import type { Lifecycle } from 'injeca'

import type { QwenAudioRealtimePlusTokenPlanSocket, QwenAudioRealtimePlusTokenPlanSocketFactory } from '../qwen-audio-realtime-plus-token-plan-transcript-probe/protocol'
import type { QwenAudioTtsTokenPlanCredentialService } from '../qwen-audio-tts-token-plan-credentials'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { errorMessageFrom } from '@moeru/std'
import {
  qwenAudioRealtimeTokenPlanAudioAppend,
  qwenAudioRealtimeTokenPlanSessionCancel,
  qwenAudioRealtimeTokenPlanSessionError,
  qwenAudioRealtimeTokenPlanSessionFinish,
  qwenAudioRealtimeTokenPlanSessionFinished,
  qwenAudioRealtimeTokenPlanSessionStart,
  qwenAudioRealtimeTokenPlanSessionStarted,
  qwenAudioRealtimeTokenPlanTranscription,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-token-plan-ipc'
import { ipcMain } from 'electron'

import {
  buildQwenAudioRealtimePlusAudioAppendFrame,
  buildQwenAudioRealtimePlusAudioCommitFrame,
  buildQwenAudioRealtimePlusSessionUpdateFrame,
  createQwenAudioRealtimePlusTokenPlanSocket,
  parseQwenAudioRealtimePlusServerMessage,
} from '../qwen-audio-realtime-plus-token-plan-transcript-probe/protocol'

const ENDPOINT = 'wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus'
const SAMPLE_RATE = 16_000
const MAX_PRESTART_BUFFER_BYTES = 256 * 1024
const HANDSHAKE_TIMEOUT_MS = 10_000
const SESSION_TIMEOUT_MS = 10_000
const TRANSCRIPT_TIMEOUT_MS = 15_000
const MAX_ERROR_LENGTH = 240

type MainEventContext = EventContext<any, any>

interface RuntimeConfig {
  apiKey: string
}

interface SessionCallbacks {
  onError: (error: Error) => void | Promise<void>
  onFinished: () => void | Promise<void>
  onStarted: () => void | Promise<void>
  onTranscription: (text: string, isFinal: boolean) => void | Promise<void>
}

function sanitize(value: unknown, maxLength = MAX_ERROR_LENGTH) {
  if (typeof value !== 'string' || !value.trim())
    return 'Token Plan realtime ASR failed.'
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-sp-[\w-]+/g, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function sessionIdFromPayload(payload: { sessionId: string }) {
  const sessionId = payload.sessionId.trim()
  if (!sessionId)
    throw new Error('Token Plan realtime ASR session ID is required.')
  return sessionId
}

function errorCodeFrom(error: Error) {
  return /^([a-z0-9_]+): /.exec(error.message)?.[1] ?? 'provider_error'
}

function qwenRendererEventTargetFromInvoke(invokeOptions?: { raw?: ElectronMainEmitOptions['raw'] }) {
  const ipcMainEvent = invokeOptions?.raw?.ipcMainEvent
  return ipcMainEvent ? { raw: { ipcMainEvent, event: undefined } } : undefined
}

type SessionState = 'connecting' | 'session' | 'streaming' | 'finishing' | 'finished' | 'failed' | 'cancelled'

class QwenAudioRealtimeTokenPlanAsrSession {
  private readonly endpoint = ENDPOINT
  private readonly queue: Uint8Array[] = []
  private readonly completion: Promise<void>
  private readonly callbacks: SessionCallbacks
  private readonly socketFactory: QwenAudioRealtimePlusTokenPlanSocketFactory
  private socket?: QwenAudioRealtimePlusTokenPlanSocket
  private state: SessionState = 'connecting'
  private finishRequested = false
  private finishSent = false
  private committedItemId?: string
  private transcriptionItemId?: string
  private transcriptionContentIndex?: number
  private timer?: ReturnType<typeof setTimeout>
  private messageChain = Promise.resolve()
  private audioBytes = 0
  private resolveCompletion!: () => void
  private rejectCompletion!: (error: Error) => void

  constructor(
    private readonly config: RuntimeConfig,
    callbacks: SessionCallbacks,
    socketFactory: QwenAudioRealtimePlusTokenPlanSocketFactory = createQwenAudioRealtimePlusTokenPlanSocket,
  ) {
    this.callbacks = callbacks
    this.socketFactory = socketFactory
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve
      this.rejectCompletion = reject
    })
    this.completion.catch(() => {})
  }

  start() {
    try {
      this.socket = this.socketFactory(this.endpoint, { Authorization: `Bearer ${this.config.apiKey}` })
      this.socket.on('open', () => this.arm(HANDSHAKE_TIMEOUT_MS, 'handshake_timeout'))
      this.socket.on('message', (message) => {
        this.messageChain = this.messageChain.then(() => this.handleMessage(message)).catch(() => {})
      })
      this.socket.on('error', error => void this.fail('network_error', sanitize(errorMessageFrom(error))))
      this.socket.on('close', (code, reason) => {
        if (this.state !== 'finished' && this.state !== 'failed' && this.state !== 'cancelled')
          void this.fail('connection_closed', `Token Plan realtime ASR connection closed (${code ?? 'unknown'} ${sanitize(reason)}).`)
      })
      this.arm(HANDSHAKE_TIMEOUT_MS, 'handshake_timeout')
    }
    catch (error) {
      void this.fail('connect_error', sanitize(errorMessageFrom(error)))
    }
  }

  appendAudio(audio: ArrayBuffer) {
    if (this.state === 'failed' || this.state === 'finished' || this.state === 'cancelled')
      return
    if (this.finishRequested)
      throw new Error('Token Plan realtime ASR received audio after finish.')

    const bytes = new Uint8Array(audio).slice()
    if (this.state !== 'streaming' && this.state !== 'finishing') {
      if (this.audioBytes + bytes.byteLength > MAX_PRESTART_BUFFER_BYTES) {
        void this.fail('prestart_buffer_overflow', 'Token Plan realtime ASR audio buffer is full.')
        return
      }
      this.queue.push(bytes)
      this.audioBytes += bytes.byteLength
      return
    }
    this.sendAudio(bytes)
  }

  async finish() {
    if (this.state === 'finished' || this.state === 'cancelled')
      return
    if (this.state === 'failed')
      return this.completion
    this.finishRequested = true
    this.sendFinishIfReady()
    return this.completion
  }

  cancel() {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    this.state = 'cancelled'
    this.clearTimer()
    this.queue.length = 0
    this.socket?.close(1000, 'cancelled')
    this.resolveCompletion()
  }

  private arm(timeoutMs: number, code: string) {
    this.clearTimer()
    this.timer = setTimeout(() => void this.fail(code, `Token Plan realtime ASR timed out at ${code}.`), timeoutMs)
  }

  private clearTimer() {
    if (this.timer)
      clearTimeout(this.timer)
    this.timer = undefined
  }

  private async handleMessage(message: unknown) {
    if (this.state === 'failed' || this.state === 'finished' || this.state === 'cancelled')
      return
    let event
    try {
      event = parseQwenAudioRealtimePlusServerMessage(message)
    }
    catch (error) {
      await this.fail('malformed_event', sanitize(errorMessageFrom(error)))
      return
    }

    if (event.type === 'session.created') {
      this.state = 'session'
      this.socket?.send(JSON.stringify(buildQwenAudioRealtimePlusSessionUpdateFrame()))
      this.arm(SESSION_TIMEOUT_MS, 'session_updated_timeout')
      return
    }
    if (event.type === 'session.updated') {
      this.clearTimer()
      this.state = 'streaming'
      await this.callbacks.onStarted()
      for (const audio of this.queue)
        this.sendAudio(audio)
      this.queue.length = 0
      this.audioBytes = 0
      this.sendFinishIfReady()
      return
    }
    if (event.type === 'commit.ack') {
      this.committedItemId = event.itemId
      this.arm(TRANSCRIPT_TIMEOUT_MS, 'transcript_timeout')
      return
    }
    if (event.type === 'user.item.created') {
      if (this.committedItemId && event.itemId !== this.committedItemId)
        return
      this.transcriptionItemId ??= event.itemId
      return
    }
    if (event.type === 'transcription.delta') {
      if (!this.matchesCorrelation(event.itemId, event.contentIndex))
        return
      const text = `${event.text}${event.stash}`.trim()
      if (text)
        await this.callbacks.onTranscription(text, false)
      return
    }
    if (event.type === 'transcription.completed') {
      if (!this.matchesCorrelation(event.itemId, event.contentIndex))
        return
      this.clearTimer()
      const transcript = event.transcript.trim()
      if (transcript)
        await this.callbacks.onTranscription(transcript.slice(0, 2_000), true)
      await this.finishSuccessfully()
      return
    }
    if (event.type === 'transcription.failed') {
      if (this.matchesCorrelation(event.itemId, event.contentIndex))
        await this.fail(event.code || 'transcription_failed', sanitize(event.message))
      return
    }
    if (event.type === 'error') {
      await this.fail(event.code || 'provider_error', sanitize(event.message))
      return
    }
    if (event.type === 'unexpected-generation')
      await this.fail('unexpected_vendor_generation', 'Unexpected vendor generation output was rejected.')
  }

  private matchesCorrelation(itemId?: string, contentIndex?: number) {
    if (itemId && this.transcriptionItemId && itemId !== this.transcriptionItemId)
      return false
    if (contentIndex !== undefined && this.transcriptionContentIndex !== undefined && contentIndex !== this.transcriptionContentIndex)
      return false
    if (itemId)
      this.transcriptionItemId ??= itemId
    if (contentIndex !== undefined)
      this.transcriptionContentIndex ??= contentIndex
    return true
  }

  private sendAudio(bytes: Uint8Array) {
    this.socket?.send(JSON.stringify(buildQwenAudioRealtimePlusAudioAppendFrame(bytes)))
  }

  private sendFinishIfReady() {
    if (!this.finishRequested || this.finishSent || this.state !== 'streaming')
      return
    this.finishSent = true
    this.state = 'finishing'
    this.socket?.send(JSON.stringify(buildQwenAudioRealtimePlusAudioCommitFrame()))
    this.arm(TRANSCRIPT_TIMEOUT_MS, 'transcript_timeout')
  }

  private async finishSuccessfully() {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    this.state = 'finished'
    this.clearTimer()
    await this.callbacks.onFinished()
    this.resolveCompletion()
    this.socket?.close(1000, 'transcript-complete')
  }

  private async fail(code: string, message: string) {
    if (this.state === 'finished' || this.state === 'failed' || this.state === 'cancelled')
      return
    this.state = 'failed'
    this.clearTimer()
    this.queue.length = 0
    this.audioBytes = 0
    this.socket?.terminate?.()
    this.socket?.close()
    const error = new Error(`${code}: ${message}`)
    this.rejectCompletion(error)
    await this.callbacks.onError(error)
  }
}

interface RendererEventTarget {
  raw: {
    ipcMainEvent: ElectronMainEmitOptions['raw']['ipcMainEvent']
    event: undefined
  }
}

export interface QwenAudioRealtimeTokenPlanAsrServiceOptions {
  context: MainEventContext
  credentialStore: Pick<QwenAudioTtsTokenPlanCredentialService, 'getRuntimeProfile'>
  lifecycle?: Lifecycle
  socketFactory?: QwenAudioRealtimePlusTokenPlanSocketFactory
}

export function createQwenAudioRealtimeTokenPlanAsrService(options: QwenAudioRealtimeTokenPlanAsrServiceOptions) {
  const sessions = new Map<string, QwenAudioRealtimeTokenPlanAsrSession>()
  const targets = new Map<string, RendererEventTarget>()
  let disposed = false

  const emit = <Payload>(event: Eventa<Payload>, payload: Payload, sessionId: string) => options.context.emit(event, payload, targets.get(sessionId))
  const emitError = (sessionId: string, error: Error) => emit(qwenAudioRealtimeTokenPlanSessionError, {
    sessionId,
    code: errorCodeFrom(error),
    message: sanitize(error.message),
  } satisfies QwenAudioRealtimeTokenPlanErrorPayload, sessionId)

  const handlers = [
    defineInvokeHandler(options.context, qwenAudioRealtimeTokenPlanSessionStart, (payload: QwenAudioRealtimeTokenPlanSessionStartPayload, invokeOptions) => {
      const sessionId = sessionIdFromPayload(payload)
      if (sessions.has(sessionId))
        throw new Error('Token Plan realtime ASR session already exists.')
      const config = options.credentialStore.getRuntimeProfile()
      const target = qwenRendererEventTargetFromInvoke(invokeOptions)
      const session = new QwenAudioRealtimeTokenPlanAsrSession(config, {
        onStarted: () => emit(qwenAudioRealtimeTokenPlanSessionStarted, { sessionId }, sessionId),
        onTranscription: (text, isFinal) => emit(qwenAudioRealtimeTokenPlanTranscription, { sessionId, text, isFinal }, sessionId),
        onFinished: async () => {
          sessions.delete(sessionId)
          await emit(qwenAudioRealtimeTokenPlanSessionFinished, { sessionId }, sessionId)
          targets.delete(sessionId)
        },
        onError: async (error) => {
          if (!disposed)
            await emitError(sessionId, error)
          sessions.delete(sessionId)
          targets.delete(sessionId)
        },
      }, options.socketFactory)
      if (target)
        targets.set(sessionId, target)
      sessions.set(sessionId, session)
      session.start()
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeTokenPlanAudioAppend, (payload: QwenAudioRealtimeTokenPlanAudioPayload) => {
      const session = sessions.get(sessionIdFromPayload(payload))
      if (!session)
        throw new Error('Token Plan realtime ASR session is not active.')
      session.appendAudio(payload.audio)
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeTokenPlanSessionFinish, async (payload: QwenAudioRealtimeTokenPlanSessionPayload) => {
      const session = sessions.get(sessionIdFromPayload(payload))
      if (!session)
        throw new Error('Token Plan realtime ASR session is not active.')
      await session.finish()
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeTokenPlanSessionCancel, (payload: QwenAudioRealtimeTokenPlanSessionPayload) => {
      const sessionId = sessionIdFromPayload(payload)
      sessions.get(sessionId)?.cancel()
      sessions.delete(sessionId)
      targets.delete(sessionId)
    }),
  ]

  const dispose = async () => {
    disposed = true
    for (const session of sessions.values())
      session.cancel()
    sessions.clear()
    targets.clear()
    handlers.forEach(disposeHandler => disposeHandler())
  }

  options.lifecycle?.appHooks.onStop(dispose)
  return { dispose, sessions }
}

export function setupQwenAudioRealtimeTokenPlanAsr(options: Omit<QwenAudioRealtimeTokenPlanAsrServiceOptions, 'context'>) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioRealtimeTokenPlanAsrService({ ...options, context: eventa.context })
  return {
    ...service,
    dispose: async () => {
      await service.dispose()
      eventa.dispose()
    },
  }
}

export { ENDPOINT as QWEN_AUDIO_REALTIME_TOKEN_PLAN_ENDPOINT, SAMPLE_RATE as QWEN_AUDIO_REALTIME_TOKEN_PLAN_SAMPLE_RATE }
