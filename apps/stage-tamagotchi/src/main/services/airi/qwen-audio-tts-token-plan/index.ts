import type { Eventa } from '@moeru/eventa'
import type { createContext, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { Lifecycle } from 'injeca'

import type {
  QwenAudioTtsTokenPlanMainDiagnosticDetails,
  QwenAudioTtsTokenPlanMainMilestone,
  QwenAudioTtsTokenPlanSocketFactory,
  QwenAudioTtsTokenPlanTelemetry,
} from './protocol'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  qwenAudioTtsTokenPlanAudioDelta,
  qwenAudioTtsTokenPlanResponseDone,
  qwenAudioTtsTokenPlanSessionCancel,
  qwenAudioTtsTokenPlanSessionError,
  qwenAudioTtsTokenPlanSessionFinish,
  qwenAudioTtsTokenPlanSessionFinished,
  qwenAudioTtsTokenPlanSessionReady,
  qwenAudioTtsTokenPlanSessionStart,
  qwenAudioTtsTokenPlanTextAppend,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-ipc'
import { ipcMain } from 'electron'

import {
  MAX_TERMINAL_ERROR_TOMBSTONES,
  QwenAudioTtsTokenPlanSession,
  resolveQwenAudioTtsTokenPlanRuntimeConfig,
  sanitizeQwenAudioTtsTokenPlanDiagnostic,
  TERMINAL_ERROR_TOMBSTONE_TTL_MS,
} from './protocol'

type QwenAudioTtsTokenPlanMainEventContext = ReturnType<typeof createContext>['context']

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

export interface QwenAudioTtsTokenPlanServiceOptions {
  context: QwenAudioTtsTokenPlanMainEventContext
  environment?: NodeJS.ProcessEnv
  lifecycle?: Lifecycle
  now?: () => number
  onDiagnostic?: (sessionId: string, milestone: QwenAudioTtsTokenPlanMainMilestone, details?: QwenAudioTtsTokenPlanMainDiagnosticDetails) => void
  onFailure?: (sessionId: string, error: Error) => void
  onTelemetry?: (sessionId: string, telemetry: QwenAudioTtsTokenPlanTelemetry) => void
  socketFactory?: QwenAudioTtsTokenPlanSocketFactory
}

function sessionIdFromPayload(payload: { sessionId: string }): string {
  const sessionId = payload.sessionId.trim()
  if (!sessionId || sessionId.length > 128)
    throw new Error('Qwen Audio Token Plan TTS session ID is invalid.')
  return sessionId
}

function errorCodeFrom(error: Error): string {
  return /^([a-z0-9_]+): /.exec(error.message)?.[1] ?? 'provider_error'
}

function targetFromInvoke(invokeOptions?: { raw?: ElectronMainEmitOptions['raw'] }): QwenRendererEventTarget | undefined {
  const ipcMainEvent = invokeOptions?.raw?.ipcMainEvent
  return ipcMainEvent ? { raw: { ipcMainEvent, event: undefined } } : undefined
}

/** Registers the Electron-main-owned Token Plan TTS route. */
export function createQwenAudioTtsTokenPlanService(options: QwenAudioTtsTokenPlanServiceOptions) {
  const sessions = new Map<string, QwenAudioTtsTokenPlanSession>()
  const eventTargets = new Map<string, QwenRendererEventTarget>()
  const terminalErrors = new Map<string, TerminalErrorTombstone>()
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

  const emit = <Payload>(event: Eventa<Payload>, payload: Payload, sessionId: string) =>
    options.context.emit(event, payload, eventTargets.get(sessionId))

  const handlers = [
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanSessionStart, (payload, invokeOptions) => {
      const sessionId = sessionIdFromPayload(payload)
      options.onDiagnostic?.(sessionId, 'MAIN_SESSION_START_RECEIVED')
      if (sessions.has(sessionId))
        throw new Error('Qwen Audio Token Plan TTS session already exists.')

      let config
      try {
        config = resolveQwenAudioTtsTokenPlanRuntimeConfig(options.environment)
        options.onDiagnostic?.(sessionId, 'TOKEN_PLAN_CREDENTIAL_PRESENT', { credentialPresent: true })
      }
      catch (error) {
        const configurationError = error instanceof Error ? error : new Error(String(error))
        options.onDiagnostic?.(sessionId, 'TOKEN_PLAN_CREDENTIAL_PRESENT', { credentialPresent: false })
        options.onDiagnostic?.(sessionId, 'TASK_FAILED', {
          code: errorCodeFrom(configurationError),
          message: sanitizeQwenAudioTtsTokenPlanDiagnostic(configurationError.message),
        })
        options.onFailure?.(sessionId, configurationError)
        throw configurationError
      }
      terminalErrors.delete(sessionId)
      const target = targetFromInvoke(invokeOptions)
      const session = new QwenAudioTtsTokenPlanSession(
        sessionId,
        config,
        payload.voice,
        {
          onReady: () => emit(qwenAudioTtsTokenPlanSessionReady, { sessionId }, sessionId),
          onAudioDelta: (audio, sequence) => emit(qwenAudioTtsTokenPlanAudioDelta, { sessionId, audio, sequence }, sessionId),
          onResponseDone: () => emit(qwenAudioTtsTokenPlanResponseDone, { sessionId }, sessionId),
          onFinished: async () => {
            sessions.delete(sessionId)
            terminalErrors.delete(sessionId)
            await emit(qwenAudioTtsTokenPlanSessionFinished, { sessionId }, sessionId)
            eventTargets.delete(sessionId)
          },
          onError: async (error) => {
            if (disposed)
              return
            const authoritativeError = rememberTerminalError(sessionId, error)
            sessions.delete(sessionId)
            options.onFailure?.(sessionId, authoritativeError)
            await emit(qwenAudioTtsTokenPlanSessionError, {
              sessionId,
              code: errorCodeFrom(authoritativeError),
              message: authoritativeError.message,
            }, sessionId)
            eventTargets.delete(sessionId)
          },
          onDiagnostic: (milestone, details) => options.onDiagnostic?.(sessionId, milestone, details),
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
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanTextAppend, (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session)
        throw terminalErrorFor(sessionId) ?? new Error('Qwen Audio Token Plan TTS session is not active.')
      session.appendText(payload.text)
    }),
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanSessionFinish, async (payload) => {
      const sessionId = sessionIdFromPayload(payload)
      const session = sessions.get(sessionId)
      if (!session)
        throw terminalErrorFor(sessionId) ?? new Error('Qwen Audio Token Plan TTS session is not active.')
      await session.finish()
    }),
    defineInvokeHandler(options.context, qwenAudioTtsTokenPlanSessionCancel, (payload) => {
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
  ]

  const dispose = async () => {
    disposed = true
    for (const session of sessions.values())
      session.cancel()
    sessions.clear()
    eventTargets.clear()
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

export function setupQwenAudioTtsTokenPlan(options: Omit<QwenAudioTtsTokenPlanServiceOptions, 'context'> = {}) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioTtsTokenPlanService({
    ...options,
    context: eventa.context,
    onDiagnostic: options.onDiagnostic ?? ((sessionId, milestone, details) => {
      console.info('[Qwen Audio Token Plan TTS transport] milestone', {
        sessionId: sessionId.slice(0, 12),
        milestone,
        credentialPresent: details?.credentialPresent,
        code: sanitizeQwenAudioTtsTokenPlanDiagnostic(details?.code),
        message: sanitizeQwenAudioTtsTokenPlanDiagnostic(details?.message),
        closeCode: typeof details?.closeCode === 'number' ? details.closeCode : undefined,
        closeReason: sanitizeQwenAudioTtsTokenPlanDiagnostic(details?.closeReason),
      })
    }),
    onFailure: options.onFailure ?? ((sessionId, error) => {
      console.warn('[Qwen Audio Token Plan TTS transport] session failed', {
        sessionId: sessionId.slice(0, 12),
        code: errorCodeFrom(error),
        message: sanitizeQwenAudioTtsTokenPlanDiagnostic(error.message),
      })
    }),
    onTelemetry: options.onTelemetry ?? ((sessionId, telemetry) => {
      console.info('[Qwen Audio Token Plan TTS transport] session finished', {
        sessionId: sessionId.slice(0, 12),
        connectLatencyMs: telemetry.connectLatencyMs,
        taskStartedLatencyMs: telemetry.taskStartedLatencyMs,
        firstSentTextToFirstAudioMs: telemetry.firstSentTextToFirstAudioMs,
        finishToTaskFinishedMs: telemetry.finishToTaskFinishedMs,
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
