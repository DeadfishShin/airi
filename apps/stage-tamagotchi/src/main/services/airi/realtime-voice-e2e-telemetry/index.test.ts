import { createContext, defineInvoke } from '@moeru/eventa'
import { realtimeVoiceE2eTurnTelemetry } from '@proj-airi/stage-ui/libs/providers/realtime-voice-e2e-ipc'
import { describe, expect, it, vi } from 'vitest'

import { createRealtimeVoiceE2eTelemetryService } from './index'

vi.mock('electron', () => ({ ipcMain: {} }))

describe('realtime voice E2E main telemetry sink', () => {
  it('logs one bounded content-free summary and preserves signed metrics', async () => {
    const context = createContext()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const service = createRealtimeVoiceE2eTelemetryService({ context: context as never })
    const report = defineInvoke(context, realtimeVoiceE2eTurnTelemetry)
    const payload = {
      turnId: '012345678901234567890123456789',
      transcriptIngressMode: 'buffered-recorder' as const,
      endpointReason: 'vad-grace-expired' as const,
      asrFinalToTranscriptFlushMs: 1200,
      firstAsrFinalToEndpointDecisionMs: 700,
      lastAsrFinalToEndpointDecisionMs: 500,
      endpointDecisionToChatSubmissionMs: 10,
      endpointDecisionToFirstTtsPlaybackScheduleMs: 100,
      lastSpeechActivityEndToEndpointDecisionMs: 400,
      firstAudioEventRelativeToInputFinishMs: -500,
      firstAudioScheduledRelativeToInputFinishMs: -500,
      firstLlmTextToFirstTtsPlaybackScheduleMs: 350,
    }

    await report(payload)
    await report(payload)

    expect(payload.firstAudioEventRelativeToInputFinishMs).toBe(-500)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('[Realtime Voice E2E] turn finished', expect.objectContaining({
      turnId: '678901234567890123456789',
      transcriptIngressMode: 'buffered-recorder',
      endpointReason: 'vad-grace-expired',
      firstAudioEventRelativeToInputFinishMs: -500,
      firstAudioScheduledRelativeToInputFinishMs: -500,
    }))
    expect(service.getLoggedTurnCount()).toBe(1)

    service.dispose()
    info.mockRestore()
  })

  it('omits non-finite metrics and never logs payload content or credentials', async () => {
    const context = createContext()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const service = createRealtimeVoiceE2eTelemetryService({ context: context as never })
    const report = defineInvoke(context, realtimeVoiceE2eTurnTelemetry)

    await report({
      turnId: 'voice-safe',
      transcriptIngressMode: 'streaming-sentence-end',
      asrFinalToChatSubmissionMs: Number.NaN,
      firstLlmTextToFirstTtsAudioEventMs: Number.POSITIVE_INFINITY,
      transcript: 'must not be logged',
      audio: 'must not be logged',
      apiKey: 'must not be logged',
    } as never)

    const serialized = JSON.stringify(info.mock.calls[0])
    expect(serialized).not.toContain('NaN')
    expect(serialized).not.toContain('Infinity')
    expect(serialized).not.toContain('Authorization')
    expect(serialized).not.toContain('Bearer')
    expect(serialized).not.toContain('api-key')
    expect(serialized).not.toContain('must not be logged')

    service.dispose()
    info.mockRestore()
  })

  it('preserves signed endpoint metrics and rejects an unbounded endpoint reason', async () => {
    const context = createContext()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const service = createRealtimeVoiceE2eTelemetryService({ context: context as never })
    const report = defineInvoke(context, realtimeVoiceE2eTurnTelemetry)

    await report({
      turnId: 'endpoint-signed',
      transcriptIngressMode: 'streaming-sentence-end',
      endpointReason: 'vad-grace-expired',
      firstAsrFinalToEndpointDecisionMs: 500,
      lastAsrFinalToEndpointDecisionMs: 400,
      endpointDecisionToChatSubmissionMs: -500,
      firstAudioScheduledRelativeToInputFinishMs: -500,
    })

    expect(info).toHaveBeenCalledWith('[Realtime Voice E2E] turn finished', expect.objectContaining({
      endpointReason: 'vad-grace-expired',
      endpointDecisionToChatSubmissionMs: -500,
      firstAudioScheduledRelativeToInputFinishMs: -500,
    }))

    await expect(report({
      turnId: 'invalid-reason',
      transcriptIngressMode: 'streaming-sentence-end',
      endpointReason: 'not-allowed',
    } as never)).rejects.toThrow('Realtime voice E2E telemetry turn ID is invalid.')

    service.dispose()
    info.mockRestore()
  })
})
