import type { StreamingVoiceEndpointDecision } from './streaming-voice-turn-endpoint'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createStreamingVoiceTurnEndpoint,
  joinStreamingVoiceTranscriptSegments,
  MAX_STREAMING_VOICE_TURN_CHARS,
  STREAMING_VOICE_ENDPOINT_GRACE_MS,
} from './streaming-voice-turn-endpoint'

class FakeClock {
  private nextTimerId = 0
  private readonly timers = new Map<number, { at: number, handler: () => void }>()
  nowValue = 0

  now = () => this.nowValue

  setTimeout = (handler: () => void, delayMs: number) => {
    const timerId = ++this.nextTimerId
    this.timers.set(timerId, { at: this.nowValue + delayMs, handler })
    return timerId as unknown as ReturnType<typeof setTimeout>
  }

  clearTimeout = (handle: ReturnType<typeof setTimeout>) => {
    // Keep cancelled callbacks available so tests can simulate a stale timer
    // racing with a newer endpoint generation.
    void handle
  }

  advanceBy(durationMs: number) {
    this.nowValue += durationMs
    for (const [timerId, timer] of [...this.timers].sort(([, first], [, second]) => first.at - second.at)) {
      if (timer.at > this.nowValue)
        continue
      this.timers.delete(timerId)
      timer.handler()
    }
  }

  fire(timerId: number) {
    this.timers.get(timerId)?.handler()
  }
}

function createHarness(clock = new FakeClock()) {
  const decisions: StreamingVoiceEndpointDecision[] = []
  let turnSequence = 0
  const endpoint = createStreamingVoiceTurnEndpoint({
    createTelemetryTurnId: vi.fn(() => `voice-turn-${++turnSequence}`),
    onEndpointDecision: decision => decisions.push(decision),
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { clock, decisions, endpoint }
}

function at(clock: FakeClock, time: number, operation: () => void) {
  clock.nowValue = time
  operation()
}

describe('streaming voice turn endpoint controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('single_segment_endpoint_test emits one turn after VAD-anchored grace', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('你好', 150))

    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS - 51)
    expect(decisions).toHaveLength(0)
    clock.advanceBy(1)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      aggregatedText: '你好',
      reason: 'vad-grace-expired',
      at: 600,
      firstAsrFinalAt: 150,
      lastAsrFinalAt: 150,
      lastSpeechActivityEndAt: 100,
    })
  })

  it('two_segment_aggregation_test cancels the first timer and preserves ordered text', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('你好', 150))
    at(clock, 300, () => endpoint.speechActivityStart(300))
    at(clock, 400, () => endpoint.speechActivityEnd(400))
    at(clock, 450, () => endpoint.finalTranscript('world', 450))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS - 51)
    expect(decisions).toHaveLength(0)
    clock.advanceBy(1)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.aggregatedText).toBe('你好world')
    expect(decisions[0]?.telemetryTurnId).toBe('voice-turn-1')
  })

  it('speech_restart_before_first_final_test keeps a late final in the restarted segment turn', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 300, () => endpoint.speechActivityStart(300))
    at(clock, 350, () => endpoint.finalTranscript('前一句', 350))
    at(clock, 400, () => endpoint.speechActivityEnd(400))
    at(clock, 450, () => endpoint.finalTranscript('后一句', 450))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.aggregatedText).toBe('前一句后一句')
    expect(decisions[0]?.lastSpeechActivityEndAt).toBe(400)
  })

  it('true_two_turn_separation_test creates a new logical turn after the first endpoint', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('第一轮', 150))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS)

    at(clock, 700, () => endpoint.speechActivityStart(700))
    at(clock, 800, () => endpoint.speechActivityEnd(800))
    at(clock, 850, () => endpoint.finalTranscript('第二轮', 850))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS)

    expect(decisions.map(decision => decision.aggregatedText)).toEqual(['第一轮', '第二轮'])
    expect(decisions.map(decision => decision.telemetryTurnId)).toEqual(['voice-turn-1', 'voice-turn-2'])
  })

  it('stale_timer_cannot_flush_new_turn_test ignores an old callback after restart', () => {
    const clock = new FakeClock()
    const { decisions, endpoint } = createHarness(clock)

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('旧', 150))
    at(clock, 200, () => endpoint.speechActivityStart(200))
    at(clock, 300, () => endpoint.speechActivityEnd(300))
    at(clock, 350, () => endpoint.finalTranscript('新', 350))

    clock.fire(1)
    expect(decisions).toHaveLength(0)
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS - 101)
    expect(decisions).toHaveLength(0)
    clock.advanceBy(51)
    expect(decisions.map(decision => decision.aggregatedText)).toEqual(['旧新'])
  })

  it('empty_final_test does not create a chat turn', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('   ', 150))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS)

    expect(decisions).toHaveLength(0)
  })

  it('speech_cancel_during_grace_test pauses the timer and resumes with prior text', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('保留', 150))
    at(clock, 200, () => endpoint.speechActivityStart(200))
    at(clock, 250, () => endpoint.speechActivityCancel(250))
    clock.advanceBy(STREAMING_VOICE_ENDPOINT_GRACE_MS - 1)
    expect(decisions).toHaveLength(0)
    clock.advanceBy(1)

    expect(decisions).toHaveLength(1)
    expect(decisions[0]?.aggregatedText).toBe('保留')
  })

  it('force_flush_test emits one explicit decision immediately', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 0, () => endpoint.speechActivityStart(0))
    at(clock, 100, () => endpoint.finalTranscript('立即发送', 100))
    at(clock, 125, () => endpoint.forceFlush('explicit-flush', 125))

    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({ reason: 'explicit-flush', at: 125 })
  })

  it('cancel_without_flush_test discards pending text and prevents later timer output', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('不要发送', 150))
    expect(endpoint.cancel()).toBe('voice-turn-1')
    clock.advanceBy(500)

    expect(decisions).toHaveLength(0)
  })

  it('endpoint_reason_closed_enum_test only emits bounded endpoint reasons', () => {
    const { clock, decisions, endpoint } = createHarness()

    at(clock, 100, () => endpoint.speechActivityEnd(100))
    at(clock, 150, () => endpoint.finalTranscript('explicit', 150))
    at(clock, 200, () => endpoint.forceFlush('explicit-flush', 200))

    expect(['vad-grace-expired', 'explicit-flush']).toContain(decisions[0]?.reason)
  })

  it('does not emit an empty decision when a logical turn exceeds its bounded text limit', () => {
    const onOverflow = vi.fn()
    const endpoint = createStreamingVoiceTurnEndpoint({
      createTelemetryTurnId: () => 'voice-overflow',
      onEndpointDecision: () => {},
      onOverflow,
      maxAggregatedTextChars: MAX_STREAMING_VOICE_TURN_CHARS,
    })

    endpoint.finalTranscript('a'.repeat(MAX_STREAMING_VOICE_TURN_CHARS))
    endpoint.finalTranscript('b')

    expect(onOverflow).toHaveBeenCalledWith('voice-overflow')
  })

  it('joins CJK without a separator and Latin words with a deterministic separator', () => {
    expect(joinStreamingVoiceTranscriptSegments(['你好', '世界'])).toBe('你好世界')
    expect(joinStreamingVoiceTranscriptSegments(['hello', 'world'])).toBe('hello world')
    expect(joinStreamingVoiceTranscriptSegments(['你好，', '世界'])).toBe('你好，世界')
    expect(joinStreamingVoiceTranscriptSegments(['hello ', 'world'])).toBe('hello world')
  })
})
