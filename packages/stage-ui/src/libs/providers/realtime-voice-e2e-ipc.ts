import { defineInvokeEventa } from '@moeru/eventa'

export type RealtimeVoiceTranscriptIngressMode = 'streaming-sentence-end' | 'buffered-recorder'
export type RealtimeVoiceEndpointReason = 'vad-grace-expired' | 'explicit-flush'

/** Renderer-clock, content-free summary for one completed voice turn. */
export interface RealtimeVoiceE2eTurnTelemetryPayload {
  turnId: string
  transcriptIngressMode: RealtimeVoiceTranscriptIngressMode
  endpointReason?: RealtimeVoiceEndpointReason
  asrFinalToTranscriptFlushMs?: number
  transcriptFlushToChatSubmissionMs?: number
  asrFinalToChatSubmissionMs?: number
  firstAsrFinalToEndpointDecisionMs?: number
  lastAsrFinalToEndpointDecisionMs?: number
  endpointDecisionToChatSubmissionMs?: number
  endpointDecisionToFirstTtsPlaybackScheduleMs?: number
  lastSpeechActivityEndToEndpointDecisionMs?: number
  chatSubmissionToFirstLlmTextMs?: number
  firstLlmTextToFirstTtsAppendMs?: number
  firstLlmTextToFirstTtsAudioEventMs?: number
  firstLlmTextToFirstTtsPlaybackScheduleMs?: number
  firstAudioEventRelativeToInputFinishMs?: number
  firstAudioScheduledRelativeToInputFinishMs?: number
  asrFinalToFirstTtsPlaybackScheduleMs?: number
  speechEndToFirstTtsPlaybackScheduleMs?: number
}

export const realtimeVoiceE2eTurnTelemetry = defineInvokeEventa<void, RealtimeVoiceE2eTurnTelemetryPayload>('eventa:invoke:electron:realtime-voice:e2e-turn-telemetry')
