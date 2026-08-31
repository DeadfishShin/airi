import type { Eventa, EventContext } from '@moeru/eventa'

import type {
  Qwen3TtsRealtimeLanguageType,
  Qwen3TtsRealtimeMode,
  Qwen3TtsRealtimeSessionPayload,
  Qwen3TtsRealtimeSessionStartPayload,
  Qwen3TtsRealtimeTextAppendPayload,
} from '../providers/qwen-tts-realtime-ipc'
import type {
  Qwen3TtsPcmAudioContext,
  Qwen3TtsPcmAudioSource,
  Qwen3TtsPcmPlaybackBridge,
  Qwen3TtsRealtimeRendererEventContext,
} from './qwen-tts-pcm-playback'
import type {
  StageTtsSession,
  StreamingSessionHooks,
  StreamingSessionSnapshot,
} from './tts-session'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'

import {
  qwen3TtsRealtimeSessionCancel,
  qwen3TtsRealtimeSessionFinish,
  qwen3TtsRealtimeSessionFinished,
  qwen3TtsRealtimeSessionStart,
  qwen3TtsRealtimeTextAppend,
} from '../providers/qwen-tts-realtime-ipc'
import { createQwen3TtsPcmPlaybackBridge } from './qwen-tts-pcm-playback'

export const MAX_QWEN3_TTS_PENDING_TEXT_CHARS = 64 * 1024

export interface Qwen3TtsStageSessionTelemetry {
  /** First non-empty LLM text handed to the Qwen Stage session. */
  s0FirstLlmText?: number
  /** First text append operation actually requested through renderer IPC. */
  s1FirstTextAppendRequested?: number
  /** First bound AUDIO_DELTA event observed by the PCM bridge. */
  s2FirstAudioEventReceived?: number
  /** First AudioBufferSourceNode scheduled by the PCM bridge. */
  s3FirstAudioScheduled?: number
  /** Remote session.finished observed by this Stage session. */
  s4RemoteFinished?: number
  /** All locally owned scheduled sources have ended. */
  s5LocalPlaybackDrain?: number
  firstLlmTextToAudioEventMs?: number
  firstLlmTextToPlaybackScheduleMs?: number
  remoteFinishToLocalDrainMs?: number
}

export interface Qwen3TtsStageSessionOptions {
  intentId: string
  snapshot: StreamingSessionSnapshot
  audioContext: Qwen3TtsPcmAudioContext
  hooks?: StreamingSessionHooks
  /** Test seam and a way to reuse an already-created renderer Eventa context. */
  eventContext?: EventContext<any, any>
  /** Existing AIRI output/gain destination, when one is available. */
  destination?: AudioNode
  /** Attach each source to AIRI's existing analyser/lip-sync graph. */
  onSourceCreated?: (source: Qwen3TtsPcmAudioSource) => void
  /** Stage's canonical assistant-speaking state setter. */
  onSpeakingChange?: (speaking: boolean) => void
  /** Renderer-clock telemetry callback; contains no text, audio, or credentials. */
  onTelemetry?: (telemetry: Qwen3TtsStageSessionTelemetry) => void
  /** Injectable renderer monotonic clock for deterministic tests. */
  now?: () => number
}

interface RendererEventContextHandle {
  context: EventContext<any, any>
  dispose: () => void
}

function createRendererEventContext(provided?: EventContext<any, any>): RendererEventContextHandle {
  if (provided)
    return { context: provided, dispose: () => {} }

  if (typeof window === 'undefined' || !isElectronWindow(window))
    throw new Error('Qwen3 realtime TTS requires the Electron desktop app.')

  const eventa = createElectronRendererContext(window.electron.ipcRenderer)
  return eventa
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Qwen3 realtime TTS renderer session failed.')
}

/**
 * Provider-specific Stage adapter for the main-process Qwen session.
 *
 * It is intentionally the only Stage-facing module that knows the Qwen IPC
 * event names. Stage chat hooks continue to use the provider-neutral
 * StageTtsSession surface.
 */
export function createQwen3TtsStageSession(options: Qwen3TtsStageSessionOptions): StageTtsSession {
  const { intentId, snapshot, audioContext, hooks } = options
  const now = options.now ?? (() => performance.now())
  const eventa = createRendererEventContext(options.eventContext)
  const start = defineInvoke(eventa.context, qwen3TtsRealtimeSessionStart)
  const append = defineInvoke(eventa.context, qwen3TtsRealtimeTextAppend)
  const finish = defineInvoke(eventa.context, qwen3TtsRealtimeSessionFinish)
  const cancelRemote = defineInvoke(eventa.context, qwen3TtsRealtimeSessionCancel)

  let terminal: 'active' | 'cancelled' | 'failed' | 'finished' = 'active'
  let finishRequested = false
  let remoteFinished = false
  let errorReported = false
  let doneReported = false
  let pendingTextChars = 0
  let operationChain = Promise.resolve()
  let cleanedUp = false
  let bridge: Qwen3TtsPcmPlaybackBridge
  let removeFinishedListener: (() => void) | undefined
  const telemetryState: Qwen3TtsStageSessionTelemetry = {}

  const emitTelemetry = () => {
    options.onTelemetry?.({ ...telemetryState })
  }

  const markFirstLlmText = () => {
    telemetryState.s0FirstLlmText ??= now()
    emitTelemetry()
  }

  const markFirstTextAppendRequested = () => {
    telemetryState.s1FirstTextAppendRequested ??= now()
    emitTelemetry()
  }

  const syncBridgeTelemetry = (telemetry: { r0AudioEventReceived?: number, r3SourceScheduled?: number }) => {
    if (telemetry.r0AudioEventReceived !== undefined)
      telemetryState.s2FirstAudioEventReceived ??= telemetry.r0AudioEventReceived
    if (telemetry.r3SourceScheduled !== undefined)
      telemetryState.s3FirstAudioScheduled ??= telemetry.r3SourceScheduled
    if (telemetryState.s0FirstLlmText !== undefined && telemetryState.s2FirstAudioEventReceived !== undefined)
      telemetryState.firstLlmTextToAudioEventMs = telemetryState.s2FirstAudioEventReceived - telemetryState.s0FirstLlmText
    if (telemetryState.s0FirstLlmText !== undefined && telemetryState.s3FirstAudioScheduled !== undefined)
      telemetryState.firstLlmTextToPlaybackScheduleMs = telemetryState.s3FirstAudioScheduled - telemetryState.s0FirstLlmText
    emitTelemetry()
  }

  const cleanup = () => {
    if (cleanedUp)
      return
    cleanedUp = true
    removeFinishedListener?.()
    removeFinishedListener = undefined
    eventa.dispose()
  }

  const fail = (reason: unknown) => {
    if (terminal !== 'active')
      return
    terminal = 'failed'
    pendingTextChars = 0
    bridge.cancel()
    options.onSpeakingChange?.(false)
    cleanup()
    if (!errorReported) {
      errorReported = true
      hooks?.onError?.(errorFrom(reason))
    }
    void cancelRemote({ sessionId: intentId }).catch(() => {})
  }

  const reportDoneAfterDrain = async () => {
    if (terminal !== 'active' || !remoteFinished)
      return
    await bridge.finish()
    if (terminal !== 'active')
      return
    terminal = 'finished'
    options.onSpeakingChange?.(false)
    cleanup()
    if (!doneReported) {
      doneReported = true
      hooks?.onDone?.()
    }
  }

  const handleRemoteFinished = (event: Eventa<Qwen3TtsRealtimeSessionPayload>) => {
    if (event.body?.sessionId !== intentId || terminal !== 'active')
      return
    remoteFinished = true
    telemetryState.s4RemoteFinished ??= now()
    emitTelemetry()
    void reportDoneAfterDrain().catch(fail)
  }

  const queueOperation = (operation: () => Promise<void>) => {
    operationChain = operationChain
      .then(async () => {
        if (terminal !== 'active')
          return
        await operation()
      })
      .catch(fail)
  }

  const bindBridge = () => {
    bridge = createQwen3TtsPcmPlaybackBridge({
      audioContext,
      destination: options.destination,
      onSourceCreated: options.onSourceCreated,
      eventContext: eventa.context as Qwen3TtsRealtimeRendererEventContext,
      onError: fail,
      onPlaybackActive: () => options.onSpeakingChange?.(true),
      onPlaybackDrained: () => {
        options.onSpeakingChange?.(false)
        telemetryState.s5LocalPlaybackDrain ??= now()
        if (telemetryState.s4RemoteFinished !== undefined)
          telemetryState.remoteFinishToLocalDrainMs = telemetryState.s5LocalPlaybackDrain - telemetryState.s4RemoteFinished
        emitTelemetry()
      },
      onTelemetry: syncBridgeTelemetry,
      now,
    })
    bridge.bind(intentId)
  }

  // Bind before starting the main session so an immediately-ready fake or
  // real IPC peer cannot race the renderer listener registration.
  bindBridge()
  removeFinishedListener = eventa.context.on(qwen3TtsRealtimeSessionFinished, handleRemoteFinished)

  queueOperation(async () => {
    const payload: Qwen3TtsRealtimeSessionStartPayload = {
      sessionId: intentId,
      voice: snapshot.voice,
      languageType: 'Chinese' satisfies Qwen3TtsRealtimeLanguageType,
      mode: 'server_commit' satisfies Qwen3TtsRealtimeMode,
    }
    await start(payload)
  })

  const appendText = (text: string) => {
    if (!text.length || terminal !== 'active')
      return
    if (finishRequested) {
      fail(new Error('Qwen3 realtime TTS cannot append text after finish.'))
      return
    }
    if (pendingTextChars + text.length > MAX_QWEN3_TTS_PENDING_TEXT_CHARS) {
      fail(new Error('Qwen3 realtime TTS pending text buffer is full.'))
      return
    }

    markFirstLlmText()
    pendingTextChars += text.length
    queueOperation(async () => {
      pendingTextChars -= text.length
      const payload: Qwen3TtsRealtimeTextAppendPayload = { sessionId: intentId, text }
      markFirstTextAppendRequested()
      await append(payload)
    })
  }

  const finishInput = () => {
    if (terminal !== 'active' || finishRequested)
      return
    finishRequested = true
    queueOperation(async () => {
      await finish({ sessionId: intentId })
    })
  }

  const cancel = () => {
    if (terminal === 'cancelled' || terminal === 'failed' || terminal === 'finished')
      return
    // Local audio is stopped before the IPC operation, so a slow or stalled
    // main process cannot leave an already-playing tail audible.
    terminal = 'cancelled'
    pendingTextChars = 0
    bridge.cancel()
    options.onSpeakingChange?.(false)
    cleanup()
    void cancelRemote({ sessionId: intentId }).catch(() => {})
  }

  return {
    intentId,
    appendText,
    appendSpecial: snapshot.onImmediateSpecial,
    finishInput,
    end: () => {},
    cancel,
  }
}
