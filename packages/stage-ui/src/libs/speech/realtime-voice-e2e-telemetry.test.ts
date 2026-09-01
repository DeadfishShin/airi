import { beforeEach, describe, expect, it } from 'vitest'

import {
  cancelRealtimeVoiceTurn,
  completeRealtimeVoiceTurn,
  createRealtimeVoiceTurn,
  failRealtimeVoiceTurn,
  getRealtimeVoiceTurnTelemetry,
  recordRealtimeVoiceTurnMilestone,
  resetRealtimeVoiceE2eTelemetry,
} from './realtime-voice-e2e-telemetry'

describe('realtime voice E2E telemetry', () => {
  beforeEach(() => {
    resetRealtimeVoiceE2eTelemetry()
  })

  it('buffered_recorder_1200ms_attribution_test correlates one buffered voice turn', () => {
    const turnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'buffered-recorder', turnId: 'voice-turn-1', at: 100 })
    recordRealtimeVoiceTurnMilestone(turnId, 'transcriptFlushRequestedAt', 1300)
    recordRealtimeVoiceTurnMilestone(turnId, 'chatSubmissionAt', 1301)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstLlmTextAt', 1401)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsAppendAt', 1401.25)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsAudioEventAt', 1501)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsPlaybackScheduleAt', 1501.5)

    expect(completeRealtimeVoiceTurn(turnId)).toEqual({
      turnId: 'voice-turn-1',
      transcriptIngressMode: 'buffered-recorder',
      asrFinalToTranscriptFlushMs: 1200,
      transcriptFlushToChatSubmissionMs: 1,
      asrFinalToChatSubmissionMs: 1201,
      chatSubmissionToFirstLlmTextMs: 100,
      firstLlmTextToFirstTtsAppendMs: 0.25,
      firstLlmTextToFirstTtsAudioEventMs: 100,
      firstLlmTextToFirstTtsPlaybackScheduleMs: 100.5,
      asrFinalToFirstTtsPlaybackScheduleMs: 1401.5,
    })
  })

  it('preserves signed, zero, and sub-millisecond intervals without clamping', () => {
    const turnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'streaming-sentence-end', turnId: 'voice-turn-2', at: 100.25 })
    recordRealtimeVoiceTurnMilestone(turnId, 'transcriptFlushRequestedAt', 100.25)
    recordRealtimeVoiceTurnMilestone(turnId, 'chatSubmissionAt', 100.25)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstLlmTextAt', 100.25)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsAppendAt', 100.25)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsAudioEventAt', 99.75)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsPlaybackScheduleAt', 99.5)

    expect(completeRealtimeVoiceTurn(turnId)).toMatchObject({
      firstLlmTextToFirstTtsAppendMs: 0,
      firstLlmTextToFirstTtsAudioEventMs: -0.5,
      firstLlmTextToFirstTtsPlaybackScheduleMs: -0.75,
      asrFinalToFirstTtsPlaybackScheduleMs: -0.75,
    })
  })

  it('requires completion milestones, ignores duplicate completion, and isolates turns', () => {
    const firstTurnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'buffered-recorder', turnId: 'voice-turn-first', at: 1 })
    recordRealtimeVoiceTurnMilestone(firstTurnId, 'chatSubmissionAt', 2)
    recordRealtimeVoiceTurnMilestone(firstTurnId, 'firstLlmTextAt', 3)
    expect(completeRealtimeVoiceTurn(firstTurnId)).toBeUndefined()
    expect(getRealtimeVoiceTurnTelemetry(firstTurnId)?.status).toBe('active')

    recordRealtimeVoiceTurnMilestone(firstTurnId, 'firstTtsPlaybackScheduleAt', 4)
    expect(completeRealtimeVoiceTurn(firstTurnId)).toBeDefined()
    expect(completeRealtimeVoiceTurn(firstTurnId)).toBeUndefined()

    const secondTurnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'streaming-sentence-end', turnId: 'voice-turn-second', at: 10 })
    recordRealtimeVoiceTurnMilestone(secondTurnId, 'chatSubmissionAt', 11)
    recordRealtimeVoiceTurnMilestone(secondTurnId, 'firstLlmTextAt', 12)
    recordRealtimeVoiceTurnMilestone(secondTurnId, 'firstTtsPlaybackScheduleAt', 13)
    expect(completeRealtimeVoiceTurn(secondTurnId)).toMatchObject({
      turnId: 'voice-turn-second',
      asrFinalToFirstTtsPlaybackScheduleMs: 3,
    })
  })

  it('does not produce a successful report after cancel or failure', () => {
    const cancelledTurnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'buffered-recorder', turnId: 'voice-cancelled', at: 1 })
    cancelRealtimeVoiceTurn(cancelledTurnId)
    expect(completeRealtimeVoiceTurn(cancelledTurnId)).toBeUndefined()

    const failedTurnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'streaming-sentence-end', turnId: 'voice-failed', at: 1 })
    failRealtimeVoiceTurn(failedTurnId)
    expect(completeRealtimeVoiceTurn(failedTurnId)).toBeUndefined()
  })

  it('ignores non-finite timestamps and keeps the payload content-free', () => {
    const turnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'buffered-recorder', turnId: 'voice-safe', at: Number.NaN })
    recordRealtimeVoiceTurnMilestone(turnId, 'transcriptFlushRequestedAt', Number.POSITIVE_INFINITY)
    recordRealtimeVoiceTurnMilestone(turnId, 'chatSubmissionAt', 1)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstLlmTextAt', 2)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsPlaybackScheduleAt', 3)

    const payload = completeRealtimeVoiceTurn(turnId)
    expect(payload).toEqual({
      turnId: 'voice-safe',
      transcriptIngressMode: 'buffered-recorder',
      asrFinalToTranscriptFlushMs: undefined,
      transcriptFlushToChatSubmissionMs: undefined,
      asrFinalToChatSubmissionMs: undefined,
      chatSubmissionToFirstLlmTextMs: 1,
      firstLlmTextToFirstTtsAppendMs: undefined,
      firstLlmTextToFirstTtsAudioEventMs: undefined,
      firstLlmTextToFirstTtsPlaybackScheduleMs: 1,
      asrFinalToFirstTtsPlaybackScheduleMs: undefined,
    })
    expect(JSON.stringify(payload)).not.toContain('must not be logged')
  })

  it('streaming_asr_direct_boundary_test labels the direct sentence-end boundary without a buffer delay', () => {
    const turnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'streaming-sentence-end', turnId: 'streaming-boundary', at: 500 })
    recordRealtimeVoiceTurnMilestone(turnId, 'transcriptFlushRequestedAt', 500)
    recordRealtimeVoiceTurnMilestone(turnId, 'chatSubmissionAt', 500)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstLlmTextAt', 510)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsPlaybackScheduleAt', 520)

    expect(completeRealtimeVoiceTurn(turnId)).toMatchObject({
      transcriptIngressMode: 'streaming-sentence-end',
      asrFinalToTranscriptFlushMs: 0,
      transcriptFlushToChatSubmissionMs: 0,
    })
  })

  it('buffered_recorder_1200ms_attribution_test labels the recorder path that waits for the configured buffer', () => {
    const turnId = createRealtimeVoiceTurn({ transcriptIngressMode: 'buffered-recorder', turnId: 'buffered-recorder', at: 100 })
    recordRealtimeVoiceTurnMilestone(turnId, 'transcriptFlushRequestedAt', 1300)
    recordRealtimeVoiceTurnMilestone(turnId, 'chatSubmissionAt', 1300)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstLlmTextAt', 1310)
    recordRealtimeVoiceTurnMilestone(turnId, 'firstTtsPlaybackScheduleAt', 1320)

    expect(completeRealtimeVoiceTurn(turnId)).toMatchObject({
      transcriptIngressMode: 'buffered-recorder',
      asrFinalToTranscriptFlushMs: 1200,
    })
  })
})
