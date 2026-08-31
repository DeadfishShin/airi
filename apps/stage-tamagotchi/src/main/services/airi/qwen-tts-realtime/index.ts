import type { Eventa } from '@moeru/eventa'
import type { createContext, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { Lifecycle } from 'injeca'

import type { QwenTtsRealtimeSocketFactory, QwenTtsRealtimeTelemetry } from './protocol'

import {
  defineInvokeHandler,
} from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  qwen3TtsRealtimeAudioDelta,
  qwen3TtsRealtimeResponseDone,
  qwen3TtsRealtimeSessionCancel,
  qwen3TtsRealtimeSessionError,
  qwen3TtsRealtimeSessionFinish,
  qwen3TtsRealtimeSessionFinished,
  qwen3TtsRealtimeSessionReady,
  qwen3TtsRealtimeSessionStart,
  qwen3TtsRealtimeStageTelemetry,
  qwen3TtsRealtimeTextAppend,
} from '@proj-airi/stage-ui/libs/providers/qwen-tts-realtime-ipc'
import { ipcMain } from 'electron'

import {
  MAX_TERMINAL_ERROR_TOMBSTONES,
  QWEN3_TTS_REALTIME_DEFAULT_LANGUAGE,
  QWEN3_TTS_REALTIME_DEFAULT_MODE,
  QWEN3_TTS_REALTIME_DEFAULT_VOICE,
  Qwen3TtsRealtimeSession,
  resolveQwenTtsRealtimeRuntimeConfig,
  TERMINAL_ERROR_TOMBSTONE_TTL_MS,
} from './protocol'

type QwenTtsMainEventContext = ReturnType<typeof createContext>['context']
interface QwenRendererEventTarget {
  raw: {
    ipcMainEvent: ElectronMainEmitOptions['raw']['ipcMainEvent']
    event: undefined
  }
}

interface TerminalErrorTombstone {
  error: Error
  expiresAt: number
}

export const MAX_STAGE_TELEMETRY_LOGS = 64

export interface Qwen3TtsRealtimeServiceOptions {
  context: QwenTtsMainEventContext
  environment?: NodeJS.ProcessEnv
  lifecycle?: Lifecycle
  now?: () => number
  onTelemetry?: (sessionId: string, telemetry: QwenTtsRealtimeTelemetry) => void
  socketFactory?: QwenTtsRealtimeSocketFactory
}

function sessionIdFromPayload(payload: { sessionId: string }): string {
  const sessionId = payload.sessionId.trim()
  if (!sessionId || sessionId.length > 128)
    throw new Error('Qwen3 realtime TTS session ID is invalid.')
  return sessionId
}

function errorCodeFrom(error: Error): string {
  return /^([a-z0-9_]+): /.exec(error.message)?.[1] ?? 'provider_error'
}

function targetFromInvoke(invokeOptions?: { raw?: ElectronMainEmitOptions['raw'] }): QwenRendererEventTarget | undefined {
  const ipcMainEvent = invokeOptions?.raw?.ipcMainEvent
  return ipcMainEvent ? { raw: { ipcMainEvent, event: undefined } } : undefined
}

export function createQwen3TtsRealtimeService(options: Qwen3TtsRealtimeServiceOptions) {
  const sessions = new Map<string, Qwen3TtsRealtimeSession>()
  const eventTargets = new Map<string, QwenRendererEventTarget>()
  const terminalErrors = new Map<string, TerminalErrorTombstone>()
  const loggedStageTelemetry = new Set<string>()
  const now = options.now ?? (() => performance.now())
  const socketFactory = options.socketFactory
  let disposed = false

  const pruneTerminalErrors = () => {
    const currentTime = now()
    for (const [sessionId, tombstone] of terminalErrors) {
      if (tombstone.expiresAt <= currentTime)
        terminalErrors.delete(sessionId)
    }
    while (terminalErrors.size > MAX_TERMINAL_ERROR_TOMBSTONES)
      terminalErrors.delete(terminalErrors.keys().next().value as string)
  }

  const rememberTerminalError = (sessionId: string, error: Error) => {
    pruneTerminalErrors()
    const existing = terminalErrors.get(sessionId)
    if (existing)
      return existing.error
    terminalErrors.set(sessionId, { error, expiresAt: now() + TERMINAL_ERROR_TOMBSTONE_TTL_MS })
    pruneTerminalErrors()
    return error
  }

  const terminalErrorFor = (sessionId: string) => {
    pruneTerminalErrors()
    return terminalErrors.get(sessionId)?.error
  }

  const rememberStageTelemetry = (sessionId: string) => {
    if (loggedStageTelemetry.has(sessionId))
      return false
    loggedStageTelemetry.add(sessionId)
    while (loggedStageTelemetry.size > MAX_STAGE_TELEMETRY_LOGS)
      loggedStageTelemetry.delete(loggedStageTelemetry.values().next().value as string)
    return true
  }

  const finiteMetric = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined

  const emit = <Payload>(event: Eventa<Payload>, payload: Payload, sessionId: string) =>
    options.context.emit(event, payload, eventTargets.get(sessionId))

  const handlers = [
    defineInvokeHandler(options.context, qwen3TtsRealtimeSessionStart, (payload, invokeOptions) => {
      const sessionId = sessionIdFromPayload(payload)
      if (sessions.has(sessionId))
        throw new Error('Qwen3 realtime TTS session already exists.')

      const config = resolveQwenTtsRealtimeRuntimeConfig(options.environment)
      terminalErrors.delete(sessionId)
      loggedStageTelemetry.delete(sessionId)
      const target = targetFromInvoke(invokeOptions)
      const session = new Qwen3TtsRealtimeSession(
        sessionId,
        config,
        payload.voice || QWEN3_TTS_REALTIME_DEFAULT_VOICE,
        payload.languageType || QWEN3_TTS_REALTIME_DEFAULT_LANGUAGE,
        payload.mode || QWEN3_TTS_REALTIME_DEFAULT_MODE,
        {
          onReady: () => emit(qwen3TtsRealtimeSessionReady, { sessionId }, sessionId),
          onAudioDelta: (audio, sequence) => emit(qwen3TtsRealtimeAudioDelta, { sessionId, audio, sequence }, sessionId),
          onResponseDone: () => emit(qwen3TtsRealtimeResponseDone, { sessionId }, sessionId),
          onFinished: async () => {
            sessions.delete(sessionId)
            terminalErrors.delete(sessionId)
            await emit(qwen3TtsRealtimeSessionFinished, { sessionId }, sessionId)
            eventTargets.delete(sessionId)
          },
          onError: async (error) => {
            if (disposed)
              return
            const authoritativeError = rememberTerminalError(sessionId, error)
            sessions.delete(sessionId)
            await emit(qwen3TtsRealtimeSessionError, {
              sessionId,
              code: errorCodeFrom(authoritativeError),
              message: authoritativeError.message,
            }, sessionId)
            eventTargets.delete(sessionId)
          },
          onTelemetry: telemetry => options.onTelemetry?.(sessionId, telemetry),
        },
        socketFactory,
        now,
      )
      if (target)
        eventTargets.set(sessionId, target)
      sessions.set(sessionId, session)
      session.start()
    }),
    defineInvokeHandler(options.context, qwen3TtsRealtimeTextAppend, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session)
        throw terminalErrorFor(sessionId) ?? new Error('Qwen3 realtime TTS session is not active.')
      session.appendText(payload.text)
    }),
    defineInvokeHandler(options.context, qwen3TtsRealtimeSessionFinish, async (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session)
        throw terminalErrorFor(sessionId) ?? new Error('Qwen3 realtime TTS session is not active.')
      await session.finish()
    }),
    defineInvokeHandler(options.context, qwen3TtsRealtimeSessionCancel, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session) {
        terminalErrors.delete(sessionId)
        eventTargets.delete(sessionId)
        return
      }
      sessions.delete(sessionId)
      eventTargets.delete(sessionId)
      session.cancel()
    }),
    defineInvokeHandler(options.context, qwen3TtsRealtimeStageTelemetry, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      if (!rememberStageTelemetry(sessionId))
        return

      console.info('[Qwen3 TTS stage] session finished', {
        sessionId: sessionId.slice(-24),
        firstLlmTextToTextAppendMs: finiteMetric(payload.firstLlmTextToTextAppendMs),
        firstLlmTextToAudioEventMs: finiteMetric(payload.firstLlmTextToAudioEventMs),
        firstLlmTextToPlaybackScheduleMs: finiteMetric(payload.firstLlmTextToPlaybackScheduleMs),
        firstAudioEventRelativeToInputFinishMs: finiteMetric(payload.firstAudioEventRelativeToInputFinishMs),
        firstAudioScheduledRelativeToInputFinishMs: finiteMetric(payload.firstAudioScheduledRelativeToInputFinishMs),
        remoteFinishToLocalDrainMs: finiteMetric(payload.remoteFinishToLocalDrainMs),
      })
    }),
  ]

  const dispose = async () => {
    disposed = true
    for (const session of sessions.values())
      session.cancel()
    sessions.clear()
    eventTargets.clear()
    terminalErrors.clear()
    loggedStageTelemetry.clear()
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
    getStageTelemetryLogCount: () => loggedStageTelemetry.size,
    sessions,
  }
}

export function setupQwen3TtsRealtime(options: Omit<Qwen3TtsRealtimeServiceOptions, 'context'> = {}) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwen3TtsRealtimeService({
    ...options,
    context: eventa.context,
    onTelemetry: options.onTelemetry ?? ((sessionId, telemetry) => {
      console.info('[Qwen3 TTS transport] session finished', {
        sessionId: sessionId.slice(0, 12),
        connectLatencyMs: telemetry.connectLatencyMs,
        sessionReadyLatencyMs: telemetry.sessionReadyLatencyMs,
        firstSentTextToFirstAudioMs: telemetry.firstSentTextToFirstAudioMs,
        finishToSessionFinishedMs: telemetry.finishToSessionFinishedMs,
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

export {
  MAX_TERMINAL_ERROR_TOMBSTONES,
  TERMINAL_ERROR_TOMBSTONE_TTL_MS,
} from './protocol'
