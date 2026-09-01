export const STREAMING_VOICE_ENDPOINT_GRACE_MS = 500
export const MAX_STREAMING_VOICE_TURN_CHARS = 64 * 1024

export type StreamingVoiceEndpointReason = 'vad-grace-expired' | 'explicit-flush'

export interface StreamingVoiceEndpointDecision {
  aggregatedText: string
  telemetryTurnId: string
  reason: StreamingVoiceEndpointReason
  at: number
  firstAsrFinalAt: number
  lastAsrFinalAt: number
  lastSpeechActivityEndAt?: number
}

export interface StreamingVoiceEndpointFinalTranscript {
  text: string
  at: number
  telemetryTurnId: string
}

export interface StreamingVoiceTurnEndpointOptions {
  createTelemetryTurnId: (at: number) => string
  onFinalTranscript?: (event: StreamingVoiceEndpointFinalTranscript) => void
  onEndpointDecision: (decision: StreamingVoiceEndpointDecision) => void
  onOverflow?: (telemetryTurnId: string) => void
  maxAggregatedTextChars?: number
  graceMs?: number
  now?: () => number
  setTimeout?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
}

interface PendingTurn {
  telemetryTurnId: string
  segments: string[]
  firstAsrFinalAt: number
  lastAsrFinalAt: number
  lastSpeechActivityEndAt?: number
}

function finiteOrNow(value: number | undefined, now: () => number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : now()
}

function isWhitespace(value: string | undefined) {
  return value === undefined || /\s/u.test(value)
}

function isCjk(value: string | undefined) {
  return value !== undefined && /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u.test(value)
}

function isClosingPunctuation(value: string | undefined) {
  return value !== undefined && /[，。！？、；：,.!?;:）》」』】\]}]/u.test(value)
}

function isOpeningPunctuation(value: string | undefined) {
  return value !== undefined && '（(「『【[{'.includes(value)
}

/**
 * Joins ASR finals without text-based deduplication. Chinese/CJK boundaries
 * remain adjacent; Latin-word boundaries receive one separator only when the
 * supplied chunks did not already provide whitespace or punctuation.
 */
export function joinStreamingVoiceTranscriptSegments(segments: readonly string[]) {
  return segments.reduce((joined, segment) => {
    if (!joined)
      return segment
    if (!segment)
      return joined

    const previous = joined.at(-1)
    const next = segment.at(0)
    if (isWhitespace(previous) || isWhitespace(next) || isClosingPunctuation(next) || isOpeningPunctuation(previous) || isCjk(previous) || isCjk(next))
      return joined + segment

    return `${joined} ${segment}`
  }, '')
}

/**
 * Decides when streaming-ASR finals form one logical user turn. The grace
 * deadline is anchored to local VAD speech activity end, never to ASR final
 * arrival. All state and timers are bounded to one pending logical turn.
 */
export function createStreamingVoiceTurnEndpoint(options: StreamingVoiceTurnEndpointOptions) {
  const graceMs = options.graceMs ?? STREAMING_VOICE_ENDPOINT_GRACE_MS
  const maxAggregatedTextChars = options.maxAggregatedTextChars ?? MAX_STREAMING_VOICE_TURN_CHARS
  const now = options.now ?? (() => performance.now())
  const setTimer = options.setTimeout ?? ((handler, delayMs) => setTimeout(handler, delayMs))
  const clearTimer = options.clearTimeout ?? (handle => clearTimeout(handle))

  let disposed = false
  let speechActive = false
  let pendingTurn: PendingTurn | undefined
  let lastSpeechActivityEndAt: number | undefined
  let endpointTimer: ReturnType<typeof setTimeout> | undefined
  let timerGeneration = 0

  function clearEndpointTimer() {
    timerGeneration += 1
    if (endpointTimer !== undefined) {
      clearTimer(endpointTimer)
      endpointTimer = undefined
    }
  }

  function decide(reason: StreamingVoiceEndpointReason, at: number) {
    if (disposed || !pendingTurn)
      return

    clearEndpointTimer()
    const turn = pendingTurn
    pendingTurn = undefined
    lastSpeechActivityEndAt = undefined
    options.onEndpointDecision({
      aggregatedText: joinStreamingVoiceTranscriptSegments(turn.segments),
      telemetryTurnId: turn.telemetryTurnId,
      reason,
      at,
      firstAsrFinalAt: turn.firstAsrFinalAt,
      lastAsrFinalAt: turn.lastAsrFinalAt,
      lastSpeechActivityEndAt: turn.lastSpeechActivityEndAt,
    })
  }

  function scheduleFromSpeechEnd(at: number, currentTime = now()) {
    if (!pendingTurn || speechActive)
      return

    lastSpeechActivityEndAt = at
    pendingTurn.lastSpeechActivityEndAt = at
    const deadline = at + graceMs
    if (currentTime >= deadline) {
      decide('vad-grace-expired', currentTime)
      return
    }

    clearEndpointTimer()
    const generation = timerGeneration
    endpointTimer = setTimer(() => {
      if (disposed || generation !== timerGeneration || speechActive || !pendingTurn)
        return
      decide('vad-grace-expired', now())
    }, Math.max(0, deadline - currentTime))
  }

  function speechActivityStart(_at?: number) {
    if (disposed)
      return

    if (!pendingTurn)
      lastSpeechActivityEndAt = undefined
    speechActive = true
    clearEndpointTimer()
    // The timestamp is intentionally not retained without a finalized text;
    // it cannot become an endpoint authority for a future logical turn.
  }

  function speechActivityEnd(at?: number) {
    if (disposed)
      return

    speechActive = false
    const speechEndAt = finiteOrNow(at, now)
    lastSpeechActivityEndAt = speechEndAt
    scheduleFromSpeechEnd(speechEndAt, now())
  }

  function speechActivityCancel(at?: number) {
    speechActivityEnd(at)
  }

  function finalTranscript(text: string, at?: number) {
    if (disposed || !text || !text.trim())
      return

    const finalAt = finiteOrNow(at, now)
    if (!pendingTurn) {
      pendingTurn = {
        telemetryTurnId: options.createTelemetryTurnId(finalAt),
        segments: [],
        firstAsrFinalAt: finalAt,
        lastAsrFinalAt: finalAt,
        lastSpeechActivityEndAt,
      }
    }

    const currentLength = pendingTurn.segments.reduce((length, segment) => length + segment.length, 0)
    if (currentLength + text.length > maxAggregatedTextChars) {
      const turnId = pendingTurn.telemetryTurnId
      cancel()
      options.onOverflow?.(turnId)
      return
    }

    pendingTurn.segments.push(text)
    pendingTurn.lastAsrFinalAt = finalAt
    options.onFinalTranscript?.({
      text,
      at: finalAt,
      telemetryTurnId: pendingTurn.telemetryTurnId,
    })

    if (!speechActive && pendingTurn.lastSpeechActivityEndAt !== undefined)
      scheduleFromSpeechEnd(pendingTurn.lastSpeechActivityEndAt, now())
  }

  function forceFlush(reason: StreamingVoiceEndpointReason = 'explicit-flush', at?: number) {
    if (disposed || !pendingTurn)
      return undefined

    const decisionAt = finiteOrNow(at, now)
    const turnId = pendingTurn.telemetryTurnId
    decide(reason, decisionAt)
    return turnId
  }

  function cancel() {
    clearEndpointTimer()
    const turnId = pendingTurn?.telemetryTurnId
    pendingTurn = undefined
    lastSpeechActivityEndAt = undefined
    speechActive = false
    return turnId
  }

  function dispose() {
    if (disposed)
      return
    disposed = true
    cancel()
  }

  return {
    speechActivityStart,
    speechActivityEnd,
    speechActivityCancel,
    finalTranscript,
    forceFlush,
    cancel,
    dispose,
  }
}
