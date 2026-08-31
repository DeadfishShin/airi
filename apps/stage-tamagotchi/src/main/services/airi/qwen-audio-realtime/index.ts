import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { Lifecycle } from 'injeca'

import type { QwenAsrTelemetry, QwenAudioRealtimeSocketFactory } from './protocol'

import {
  defineInvokeHandler,
} from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionCancel,
  qwenAudioRealtimeSessionError,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionFinished,
  qwenAudioRealtimeSessionStart,
  qwenAudioRealtimeSessionStarted,
  qwenAudioRealtimeTranscriptionFinal,
  qwenAudioRealtimeTranscriptionPartial,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-ipc'
import { ipcMain } from 'electron'

import {
  createQwenAudioRealtimeSocket,
  QwenAudioRealtimeAsrSession,
  resolveQwenAudioRealtimeRuntimeConfig,
} from './protocol'

type QwenMainEventContext = ReturnType<typeof createContext>['context']

export const QWEN_TERMINAL_ERROR_TOMBSTONE_TTL_MS = 30_000
export const QWEN_MAX_TERMINAL_ERROR_TOMBSTONES = 32

interface QwenTerminalErrorTombstone {
  error: Error
  expiresAt: number
}

export interface QwenAudioRealtimeServiceOptions {
  context: QwenMainEventContext
  environment?: NodeJS.ProcessEnv
  lifecycle?: Lifecycle
  now?: () => number
  onTelemetry?: (telemetry: QwenAsrTelemetry) => void
  socketFactory?: QwenAudioRealtimeSocketFactory
}

function sessionIdFromPayload(payload: { sessionId: string }) {
  const sessionId = payload.sessionId.trim()
  if (!sessionId)
    throw new Error('Qwen Audio realtime ASR session ID is required.')
  return sessionId
}

function errorCodeFrom(error: Error) {
  return /^([a-z0-9_]+): /.exec(error.message)?.[1] ?? 'provider_error'
}

/** Registers the main-process owner for Qwen realtime ASR sessions. */
export function createQwenAudioRealtimeAsrService(options: QwenAudioRealtimeServiceOptions) {
  const sessions = new Map<string, QwenAudioRealtimeAsrSession>()
  const terminalErrors = new Map<string, QwenTerminalErrorTombstone>()
  const now = options.now ?? (() => Date.now())
  const runtimeConfig = () => resolveQwenAudioRealtimeRuntimeConfig(options.environment)
  const socketFactory = options.socketFactory ?? createQwenAudioRealtimeSocket
  let disposed = false

  const pruneTerminalErrors = () => {
    const currentTime = now()
    for (const [sessionId, tombstone] of terminalErrors) {
      if (tombstone.expiresAt <= currentTime)
        terminalErrors.delete(sessionId)
    }
    while (terminalErrors.size > QWEN_MAX_TERMINAL_ERROR_TOMBSTONES)
      terminalErrors.delete(terminalErrors.keys().next().value as string)
  }

  const rememberTerminalError = (sessionId: string, error: Error) => {
    pruneTerminalErrors()
    const existing = terminalErrors.get(sessionId)
    if (existing)
      return existing.error

    terminalErrors.set(sessionId, {
      error,
      expiresAt: now() + QWEN_TERMINAL_ERROR_TOMBSTONE_TTL_MS,
    })
    pruneTerminalErrors()
    return error
  }

  const terminalErrorFor = (sessionId: string) => {
    pruneTerminalErrors()
    return terminalErrors.get(sessionId)?.error
  }

  const emitError = async (sessionId: string, error: Error, code = 'provider_error') => {
    await options.context.emit(qwenAudioRealtimeSessionError, {
      sessionId,
      code,
      message: error.message,
    })
  }

  const handlers = [
    defineInvokeHandler(options.context, qwenAudioRealtimeSessionStart, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      if (sessions.has(sessionId))
        throw new Error('Qwen Audio realtime ASR session already exists.')

      const session = new QwenAudioRealtimeAsrSession(
        sessionId,
        runtimeConfig(),
        payload.language,
        {
          onStarted: () => options.context.emit(qwenAudioRealtimeSessionStarted, { sessionId }),
          onPartial: sentence => options.context.emit(qwenAudioRealtimeTranscriptionPartial, {
            sessionId,
            text: sentence.text,
            sentenceId: sentence.sentenceId,
            startMilliseconds: sentence.startMilliseconds,
            durationMilliseconds: sentence.durationMilliseconds,
          }),
          onFinal: sentence => options.context.emit(qwenAudioRealtimeTranscriptionFinal, {
            sessionId,
            text: sentence.text,
            sentenceId: sentence.sentenceId,
            startMilliseconds: sentence.startMilliseconds,
            durationMilliseconds: sentence.durationMilliseconds,
          }),
          onFinished: async () => {
            sessions.delete(sessionId)
            terminalErrors.delete(sessionId)
            await options.context.emit(qwenAudioRealtimeSessionFinished, { sessionId })
          },
          onError: async (error) => {
            if (disposed)
              return
            const authoritativeError = rememberTerminalError(sessionId, error)
            sessions.delete(sessionId)
            await emitError(sessionId, authoritativeError, errorCodeFrom(authoritativeError))
          },
          onTelemetry: options.onTelemetry,
        },
        socketFactory,
        options.now,
      )
      sessions.set(sessionId, session)
      terminalErrors.delete(sessionId)
      session.start()
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeAudioAppend, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session) {
        const terminalError = terminalErrorFor(sessionId)
        if (terminalError)
          throw terminalError
        throw new Error('Qwen Audio realtime ASR session is not active.')
      }
      session.appendAudio(payload.audio)
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeSessionFinish, async (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session) {
        const terminalError = terminalErrorFor(sessionId)
        if (terminalError)
          throw terminalError
        throw new Error('Qwen Audio realtime ASR session is not active.')
      }
      await session.finish()
    }),
    defineInvokeHandler(options.context, qwenAudioRealtimeSessionCancel, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session) {
        terminalErrors.delete(sessionId)
        return
      }
      sessions.delete(sessionId)
      session.cancel()
    }),
  ]

  const dispose = async () => {
    disposed = true
    for (const session of sessions.values())
      session.cancel()
    sessions.clear()
    terminalErrors.clear()
    for (const disposeHandler of handlers)
      disposeHandler()
  }

  options.lifecycle?.appHooks.onStop(dispose)

  return {
    dispose,
    getTerminalErrorTombstoneCount: () => {
      pruneTerminalErrors()
      return terminalErrors.size
    },
    sessions,
  }
}

/** Creates the Electron main Eventa context and registers the ASR service. */
export function setupQwenAudioRealtimeAsr(options: Omit<QwenAudioRealtimeServiceOptions, 'context'> = {}) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioRealtimeAsrService({
    ...options,
    context: eventa.context,
    onTelemetry: options.onTelemetry ?? ((telemetry) => {
      // Bounded diagnostics only: timestamps and latency, never credentials,
      // audio bytes, endpoint URLs, or transcript content.
      console.info('[Qwen ASR canary] session finished', {
        connectLatencyMs: telemetry.connectLatencyMs,
        taskStartLatencyMs: telemetry.taskStartLatencyMs,
        speechStartToFirstPartialMs: telemetry.speechStartToFirstPartialMs,
        firstAudioToFirstPartialMs: telemetry.firstAudioToFirstPartialMs,
        speechEndToFinalMs: telemetry.speechEndToFinalMs,
        finalToAiriDeliveryMs: telemetry.finalToAiriDeliveryMs,
      })
    }),
  })

  return {
    ...service,
    dispose: async () => {
      await service.dispose()
      eventa.dispose()
    },
  }
}

export type { QwenAsrTelemetry, QwenAudioRealtimeRegion, QwenAudioRealtimeRuntimeConfig, QwenAudioRealtimeSocket, QwenAudioRealtimeSocketFactory } from './protocol'
export {
  buildQwenAudioRealtimeEndpoint,
  buildQwenFinishTaskFrame,
  buildQwenRunTaskFrame,
  MAX_PRESTART_BUFFER_BYTES,
  parseQwenServerMessage,
  QWEN_ASR_SAMPLE_RATE,
  QWEN_AUDIO_REALTIME_ASR_MODEL,
  resolveQwenAudioRealtimeRuntimeConfig,
} from './protocol'
