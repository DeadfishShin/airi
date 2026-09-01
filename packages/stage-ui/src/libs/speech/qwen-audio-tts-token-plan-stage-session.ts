import type { Eventa, EventContext } from '@moeru/eventa'

import type {
  QwenAudioTtsTokenPlanSessionPayload,
  QwenAudioTtsTokenPlanSessionStartPayload,
  QwenAudioTtsTokenPlanTextAppendPayload,
} from '../providers/qwen-audio-tts-token-plan-ipc'
import type { QwenAudioTtsTokenPlanStageMilestone } from './qwen-audio-tts-token-plan-diagnostics'
import type {
  Qwen3TtsPcmAudioContext,
  Qwen3TtsPcmAudioSource,
  Qwen3TtsPcmPlaybackBridge,
  Qwen3TtsPcmPlaybackEvents,
} from './qwen-tts-pcm-playback'
import type {
  Qwen3TtsStageSessionTelemetry,
} from './qwen-tts-stage-session'
import type {
  StageTtsSession,
  StreamingSessionHooks,
  StreamingSessionSnapshot,
} from './tts-session'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createElectronRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow } from '@proj-airi/stage-shared'

import {
  qwenAudioTtsTokenPlanAudioDelta,
  qwenAudioTtsTokenPlanResponseDone,
  qwenAudioTtsTokenPlanSessionCancel,
  qwenAudioTtsTokenPlanSessionError,
  qwenAudioTtsTokenPlanSessionFinish,
  qwenAudioTtsTokenPlanSessionFinished,
  qwenAudioTtsTokenPlanSessionStart,
  qwenAudioTtsTokenPlanTextAppend,
} from '../providers/qwen-audio-tts-token-plan-ipc'
import { createQwen3TtsPcmPlaybackBridge } from './qwen-tts-pcm-playback'

export const MAX_QWEN_AUDIO_TTS_TOKEN_PLAN_PENDING_TEXT_CHARS = 64 * 1024

export interface QwenAudioTtsTokenPlanStageSessionOptions {
  intentId: string
  snapshot: StreamingSessionSnapshot
  audioContext: Qwen3TtsPcmAudioContext
  hooks?: StreamingSessionHooks
  eventContext?: EventContext<any, any>
  destination?: AudioNode
  onSourceCreated?: (source: Qwen3TtsPcmAudioSource) => void
  onSpeakingChange?: (speaking: boolean) => void
  onTelemetry?: (telemetry: Qwen3TtsStageSessionTelemetry) => void
  onDiagnostic?: (milestone: QwenAudioTtsTokenPlanStageMilestone) => void
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
    throw new Error('Qwen Audio Token Plan TTS requires the Electron desktop app.')

  return createElectronRendererContext(window.electron.ipcRenderer)
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Qwen Audio Token Plan TTS renderer session failed.')
}

const tokenPlanPlaybackEvents: Qwen3TtsPcmPlaybackEvents = {
  audioDelta: qwenAudioTtsTokenPlanAudioDelta,
  responseDone: qwenAudioTtsTokenPlanResponseDone,
  sessionFinished: qwenAudioTtsTokenPlanSessionFinished,
  sessionError: qwenAudioTtsTokenPlanSessionError,
}

/** Stage adapter for Token Plan's native Qwen-Audio-TTS task protocol. */
export function createQwenAudioTtsTokenPlanStageSession(options: QwenAudioTtsTokenPlanStageSessionOptions): StageTtsSession {
  const { intentId, snapshot, audioContext, hooks } = options
  const now = options.now ?? (() => performance.now())
  const eventa = createRendererEventContext(options.eventContext)
  const start = defineInvoke(eventa.context, qwenAudioTtsTokenPlanSessionStart)
  const append = defineInvoke(eventa.context, qwenAudioTtsTokenPlanTextAppend)
  const finish = defineInvoke(eventa.context, qwenAudioTtsTokenPlanSessionFinish)
  const cancelRemote = defineInvoke(eventa.context, qwenAudioTtsTokenPlanSessionCancel)
  const diagnostic = options.onDiagnostic
  const emittedDiagnostics = new Set<QwenAudioTtsTokenPlanStageMilestone>()
  const emitDiagnostic = (milestone: QwenAudioTtsTokenPlanStageMilestone) => {
    if (emittedDiagnostics.has(milestone))
      return
    emittedDiagnostics.add(milestone)
    diagnostic?.(milestone)
  }

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

  const emitTelemetry = () => options.onTelemetry?.({ ...telemetryState })

  const updateDerivedTelemetry = (bridgeTelemetry?: { r0AudioEventReceived?: number, r3SourceScheduled?: number }) => {
    if (telemetryState.s0FirstLlmText !== undefined && telemetryState.s1FirstTextAppendRequested !== undefined)
      telemetryState.firstLlmTextToTextAppendMs = telemetryState.s1FirstTextAppendRequested - telemetryState.s0FirstLlmText
    if (bridgeTelemetry?.r0AudioEventReceived !== undefined)
      telemetryState.s2FirstAudioEventReceived ??= bridgeTelemetry.r0AudioEventReceived
    if (bridgeTelemetry?.r3SourceScheduled !== undefined)
      telemetryState.s3FirstAudioScheduled ??= bridgeTelemetry.r3SourceScheduled
    if (telemetryState.s0FirstLlmText !== undefined && telemetryState.s2FirstAudioEventReceived !== undefined)
      telemetryState.firstLlmTextToAudioEventMs = telemetryState.s2FirstAudioEventReceived - telemetryState.s0FirstLlmText
    if (telemetryState.s0FirstLlmText !== undefined && telemetryState.s3FirstAudioScheduled !== undefined)
      telemetryState.firstLlmTextToPlaybackScheduleMs = telemetryState.s3FirstAudioScheduled - telemetryState.s0FirstLlmText
    if (telemetryState.inputFinishRequestedAt !== undefined && telemetryState.s2FirstAudioEventReceived !== undefined)
      telemetryState.firstAudioEventRelativeToInputFinishMs = telemetryState.s2FirstAudioEventReceived - telemetryState.inputFinishRequestedAt
    if (telemetryState.inputFinishRequestedAt !== undefined && telemetryState.s3FirstAudioScheduled !== undefined)
      telemetryState.firstAudioScheduledRelativeToInputFinishMs = telemetryState.s3FirstAudioScheduled - telemetryState.inputFinishRequestedAt
  }

  const syncBridgeTelemetry = (telemetry: { r0AudioEventReceived?: number, r3SourceScheduled?: number }) => {
    updateDerivedTelemetry(telemetry)
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
    cleanup()
    if (!doneReported) {
      doneReported = true
      hooks?.onDone?.()
    }
  }

  const handleRemoteFinished = (event: Eventa<QwenAudioTtsTokenPlanSessionPayload>) => {
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

  bridge = createQwen3TtsPcmPlaybackBridge({
    audioContext,
    destination: options.destination,
    onSourceCreated: options.onSourceCreated,
    eventContext: eventa.context,
    events: tokenPlanPlaybackEvents,
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
  removeFinishedListener = eventa.context.on(qwenAudioTtsTokenPlanSessionFinished, handleRemoteFinished)

  queueOperation(async () => {
    const payload: QwenAudioTtsTokenPlanSessionStartPayload = { sessionId: intentId, voice: snapshot.voice }
    emitDiagnostic('TOKEN_PLAN_RENDERER_START_REQUESTED')
    await start(payload)
    emitDiagnostic('TOKEN_PLAN_RENDERER_START_RESOLVED')
  })

  const appendText = (text: string) => {
    if (!text.length || terminal !== 'active')
      return
    if (finishRequested) {
      fail(new Error('Qwen Audio Token Plan TTS cannot append text after finish.'))
      return
    }
    if (pendingTextChars + text.length > MAX_QWEN_AUDIO_TTS_TOKEN_PLAN_PENDING_TEXT_CHARS) {
      fail(new Error('Qwen Audio Token Plan TTS pending text buffer is full.'))
      return
    }
    emitDiagnostic('TOKEN_PLAN_FIRST_APPEND_REQUESTED')
    telemetryState.s0FirstLlmText ??= now()
    telemetryState.s1FirstTextAppendRequested ??= now()
    updateDerivedTelemetry()
    emitTelemetry()
    pendingTextChars += text.length
    queueOperation(async () => {
      pendingTextChars -= text.length
      const payload: QwenAudioTtsTokenPlanTextAppendPayload = { sessionId: intentId, text }
      await append(payload)
    })
  }

  const finishInput = () => {
    if (terminal !== 'active' || finishRequested)
      return
    finishRequested = true
    emitDiagnostic('TOKEN_PLAN_FINISH_REQUESTED')
    telemetryState.inputFinishRequestedAt ??= now()
    updateDerivedTelemetry()
    emitTelemetry()
    queueOperation(async () => {
      await finish({ sessionId: intentId })
    })
  }

  const cancel = () => {
    if (terminal === 'cancelled' || terminal === 'failed' || terminal === 'finished')
      return
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
