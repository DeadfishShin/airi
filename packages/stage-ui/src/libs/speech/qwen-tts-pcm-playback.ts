import type { Eventa } from '@moeru/eventa'

import {
  qwen3TtsRealtimeAudioDelta,
  qwen3TtsRealtimeResponseDone,
  qwen3TtsRealtimeSessionError,
  qwen3TtsRealtimeSessionFinished,
} from '../providers/qwen-tts-realtime-ipc'

export const QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE = 24_000
export const QWEN3_TTS_REALTIME_SCHEDULER_LEAD_MS = 5

export type Qwen3TtsPcmPlaybackState = 'idle' | 'active' | 'finishing' | 'finished' | 'cancelled' | 'failed' | 'disposed'

export interface Qwen3TtsPcmAudioBuffer {
  readonly duration: number
  readonly length: number
  readonly numberOfChannels: number
  readonly sampleRate: number
  copyToChannel: (source: Float32Array, channelNumber: number, bufferOffset?: number) => void
}

export interface Qwen3TtsPcmAudioSource {
  buffer: Qwen3TtsPcmAudioBuffer | null
  onended: ((event: Event) => void) | null
  connect: (destination: AudioNode) => AudioNode
  disconnect: () => void
  start: (when?: number) => void
  stop: (when?: number) => void
}

export interface Qwen3TtsPcmAudioContext {
  readonly currentTime: number
  readonly destination: AudioNode
  readonly state?: AudioContextState
  readonly createBuffer: (numberOfChannels: number, length: number, sampleRate: number) => Qwen3TtsPcmAudioBuffer
  readonly createBufferSource: () => Qwen3TtsPcmAudioSource
  readonly resume?: () => Promise<void>
}

export interface Qwen3TtsRealtimeRendererEventContext {
  on: <P>(event: Eventa<P>, handler: (payload: Eventa<P>) => unknown) => () => void
}

export interface Qwen3TtsPcmPlaybackTelemetry {
  r0AudioEventReceived?: number
  r1PcmDecoded?: number
  r2AudioBufferCreated?: number
  r3SourceScheduled?: number
  r4SourceStartTime?: number
  /** Monotonic timestamp when the final owned source has drained. */
  r5LocalDrainCompleted?: number
  firstAudioEventToScheduleMs?: number
  scheduledAudioDurationMs: number
  responseDone: boolean
}

export interface Qwen3TtsPcmPlaybackBridgeOptions {
  audioContext: Qwen3TtsPcmAudioContext
  eventContext: Qwen3TtsRealtimeRendererEventContext
  /** Existing AIRI output/gain destination. Defaults to audioContext.destination. */
  destination?: AudioNode
  now?: () => number
  onError?: (error: Error) => void
  onTelemetry?: (telemetry: Qwen3TtsPcmPlaybackTelemetry) => void
  onPlaybackActive?: () => void
  onPlaybackDrained?: () => void
  /** Attach the source to existing AIRI analyser/lip-sync nodes as needed. */
  onSourceCreated?: (source: Qwen3TtsPcmAudioSource) => void
}

export interface Qwen3TtsPcmPlaybackBridge {
  /** Bind this playback owner to exactly one Qwen session. */
  bind: (sessionId: string) => void
  /** Alias for callers that model the bridge as a session start. */
  start: (sessionId: string) => void
  /** Testable lower-level entry point; production callers normally use IPC events. */
  enqueue: (sequence: number, audio: ArrayBuffer) => boolean
  /** Stop accepting new audio while allowing already scheduled sources to drain. */
  finish: () => Promise<void>
  /** Stop and clear all local sources immediately. */
  cancel: () => void
  /** Detach listeners and release bridge-owned source references. */
  dispose: () => void
  readonly state: () => Qwen3TtsPcmPlaybackState
  readonly telemetry: () => Qwen3TtsPcmPlaybackTelemetry
  readonly scheduledSourceCount: () => number
}

function assertArrayBuffer(input: unknown): asserts input is ArrayBuffer {
  if (!(input instanceof ArrayBuffer))
    throw new TypeError('Qwen3 realtime TTS audio must be an ArrayBuffer.')
}

/** Decode raw signed little-endian PCM16 without using an encoded-audio decoder. */
export function decodeQwen3TtsPcm16Le(input: unknown): Float32Array {
  assertArrayBuffer(input)
  if (input.byteLength === 0)
    throw new RangeError('Qwen3 realtime TTS PCM audio is empty.')
  if (input.byteLength % 2 !== 0)
    throw new RangeError('Qwen3 realtime TTS PCM16 audio has an odd byte length.')

  const view = new DataView(input)
  const samples = new Float32Array(input.byteLength / 2)
  for (let index = 0; index < samples.length; index++)
    samples[index] = view.getInt16(index * 2, true) / 32_768
  return samples
}

export function createQwen3TtsPcmAudioBuffer(
  audioContext: Qwen3TtsPcmAudioContext,
  input: ArrayBuffer,
): Qwen3TtsPcmAudioBuffer {
  const samples = decodeQwen3TtsPcm16Le(input)
  const audioBuffer = audioContext.createBuffer(1, samples.length, QWEN3_TTS_REALTIME_PCM_SAMPLE_RATE)
  audioBuffer.copyToChannel(samples, 0)
  return audioBuffer
}

function errorFrom(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

/**
 * Renderer-only Qwen PCM playback owner. It deliberately stops at
 * AudioBufferSourceNode scheduling; StageTtsSession and PlaybackManager remain
 * outside this canary slice.
 */
export function createQwen3TtsPcmPlaybackBridge(
  options: Qwen3TtsPcmPlaybackBridgeOptions,
): Qwen3TtsPcmPlaybackBridge {
  let boundSessionId: string | undefined
  let currentState: Qwen3TtsPcmPlaybackState = 'idle'
  let expectedSequence = 0
  let nextStartTime = 0
  let acceptingAudio = true
  let errorReported = false
  let resumeRequested = false
  let playbackActiveReported = false
  let playbackDrainReported = false
  const sourceNodes = new Set<Qwen3TtsPcmAudioSource>()
  const now = options.now ?? (() => performance.now())
  const telemetryState: Qwen3TtsPcmPlaybackTelemetry = {
    scheduledAudioDurationMs: 0,
    responseDone: false,
  }
  const listeners: Array<() => void> = []
  let drainPromise: Promise<void> | undefined
  let resolveDrain: (() => void) | undefined

  function telemetrySnapshot(): Qwen3TtsPcmPlaybackTelemetry {
    return { ...telemetryState }
  }

  function emitTelemetry() {
    options.onTelemetry?.(telemetrySnapshot())
  }

  function resolveDrainIfReady() {
    if (!resolveDrain)
      return
    if (acceptingAudio || sourceNodes.size > 0)
      return
    const resolve = resolveDrain
    resolveDrain = undefined
    if (currentState === 'finishing')
      currentState = 'finished'
    if (!playbackDrainReported) {
      playbackDrainReported = true
      telemetryState.r5LocalDrainCompleted = now()
      options.onPlaybackDrained?.()
      emitTelemetry()
    }
    resolve()
  }

  function ensureDrainPromise() {
    if (!drainPromise) {
      drainPromise = new Promise<void>((resolve) => {
        resolveDrain = resolve
      })
      resolveDrainIfReady()
    }
    return drainPromise
  }

  function detachListeners() {
    for (const dispose of listeners.splice(0))
      dispose()
  }

  function stopSource(source: Qwen3TtsPcmAudioSource) {
    try {
      source.stop()
    }
    catch {}
    try {
      source.disconnect()
    }
    catch {}
    sourceNodes.delete(source)
  }

  function stopAllSources() {
    for (const source of sourceNodes)
      stopSource(source)
    resolveDrainIfReady()
  }

  function fail(reason: unknown, fallback: string) {
    if (currentState === 'failed' || currentState === 'cancelled' || currentState === 'disposed' || currentState === 'finished')
      return
    currentState = 'failed'
    acceptingAudio = false
    nextStartTime = 0
    detachListeners()
    stopAllSources()
    resolveDrainIfReady()
    if (!errorReported) {
      errorReported = true
      options.onError?.(errorFrom(reason, fallback))
    }
  }

  function handleAudioDelta(event: Eventa<{ sessionId: string, sequence: number, audio: ArrayBuffer }>) {
    const payload = event.body
    if (!payload || payload.sessionId !== boundSessionId)
      return
    try {
      enqueue(payload.sequence, payload.audio)
    }
    catch (error) {
      fail(error, 'Qwen3 realtime TTS PCM playback failed.')
    }
  }

  function handleResponseDone(event: Eventa<{ sessionId: string }>) {
    if (event.body?.sessionId !== boundSessionId)
      return
    // response.done ends one synthesis response, not the local playback tail.
    telemetryState.responseDone = true
    emitTelemetry()
  }

  function handleSessionFinished(event: Eventa<{ sessionId: string }>) {
    if (event.body?.sessionId !== boundSessionId)
      return
    void finish()
  }

  function handleSessionError(event: Eventa<{ sessionId: string, code: string, message: string }>) {
    if (event.body?.sessionId !== boundSessionId)
      return
    const payload = event.body
    if (!payload)
      return
    const code = payload.code || 'qwen3_tts_session_error'
    const message = payload.message || 'Qwen3 realtime TTS session failed.'
    fail(new Error(`${code}: ${message}`), 'Qwen3 realtime TTS session failed.')
  }

  function bind(sessionId: string) {
    if (!sessionId.trim())
      throw new Error('Qwen3 realtime TTS playback session ID is required.')
    if (currentState !== 'idle')
      throw new Error('Qwen3 realtime TTS playback bridge has already started.')

    boundSessionId = sessionId
    currentState = 'active'
    listeners.push(
      options.eventContext.on(qwen3TtsRealtimeAudioDelta, handleAudioDelta),
      options.eventContext.on(qwen3TtsRealtimeResponseDone, handleResponseDone),
      options.eventContext.on(qwen3TtsRealtimeSessionFinished, handleSessionFinished),
      options.eventContext.on(qwen3TtsRealtimeSessionError, handleSessionError),
    )
  }

  function enqueue(sequence: number, audio: ArrayBuffer): boolean {
    if (currentState === 'failed' || currentState === 'cancelled' || currentState === 'disposed' || currentState === 'finished')
      return false
    if (!boundSessionId)
      throw new Error('Qwen3 realtime TTS playback bridge is not bound to a session.')
    if (!acceptingAudio)
      return false
    telemetryState.r0AudioEventReceived ??= now()
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new RangeError('Qwen3 realtime TTS audio sequence is invalid.')
    if (sequence < expectedSequence)
      return false
    if (sequence > expectedSequence) {
      fail(new Error(`Qwen3 realtime TTS audio sequence gap at ${expectedSequence}.`), 'Qwen3 realtime TTS audio sequence is out of order.')
      return false
    }

    expectedSequence++
    let audioBuffer: Qwen3TtsPcmAudioBuffer
    try {
      audioBuffer = createQwen3TtsPcmAudioBuffer(options.audioContext, audio)
    }
    catch (error) {
      fail(error, 'Qwen3 realtime TTS PCM playback failed.')
      return false
    }
    telemetryState.r1PcmDecoded ??= now()
    telemetryState.r2AudioBufferCreated ??= now()

    if (!resumeRequested && options.audioContext.state === 'suspended' && options.audioContext.resume) {
      resumeRequested = true
      void options.audioContext.resume().catch(error => fail(error, 'Qwen3 realtime TTS AudioContext could not resume.'))
    }

    const source = options.audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(options.destination ?? options.audioContext.destination)
    options.onSourceCreated?.(source)
    sourceNodes.add(source)
    source.onended = () => {
      sourceNodes.delete(source)
      try {
        source.disconnect()
      }
      catch {}
      emitTelemetry()
      resolveDrainIfReady()
    }

    const minimumSafeStartTime = options.audioContext.currentTime + QWEN3_TTS_REALTIME_SCHEDULER_LEAD_MS / 1000
    const startAt = Math.max(minimumSafeStartTime, nextStartTime)
    try {
      source.start(startAt)
    }
    catch (error) {
      stopSource(source)
      fail(error, 'Qwen3 realtime TTS audio source could not start.')
      return false
    }

    nextStartTime = startAt + audioBuffer.duration
    telemetryState.r3SourceScheduled ??= now()
    telemetryState.r4SourceStartTime ??= startAt
    telemetryState.firstAudioEventToScheduleMs ??= telemetryState.r3SourceScheduled - telemetryState.r0AudioEventReceived!
    telemetryState.scheduledAudioDurationMs += audioBuffer.duration * 1000
    if (!playbackActiveReported) {
      playbackActiveReported = true
      options.onPlaybackActive?.()
    }
    emitTelemetry()
    return true
  }

  function finish() {
    if (currentState === 'idle')
      throw new Error('Qwen3 realtime TTS playback bridge has not started.')
    if (currentState === 'failed' || currentState === 'cancelled' || currentState === 'disposed')
      return Promise.resolve()
    if (currentState === 'finished')
      return Promise.resolve()

    acceptingAudio = false
    currentState = 'finishing'
    const promise = ensureDrainPromise()
    detachListeners()
    resolveDrainIfReady()
    return promise
  }

  function cancel() {
    if (currentState === 'disposed' || currentState === 'cancelled')
      return
    if (currentState === 'finished')
      return
    acceptingAudio = false
    currentState = 'cancelled'
    nextStartTime = 0
    detachListeners()
    stopAllSources()
    resolveDrainIfReady()
  }

  function dispose() {
    if (currentState === 'disposed')
      return
    cancel()
    detachListeners()
    currentState = 'disposed'
    boundSessionId = undefined
  }

  return {
    bind,
    start: bind,
    enqueue,
    finish,
    cancel,
    dispose,
    state: () => currentState,
    telemetry: telemetrySnapshot,
    scheduledSourceCount: () => sourceNodes.size,
  }
}
