import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const stageSource = readFileSync(new URL('../../../../../packages/stage-ui/src/components/scenes/Stage.vue', import.meta.url), 'utf8')
const speechOutputControlSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/speech-output-control.ts', import.meta.url), 'utf8')
const chatSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/chat.ts', import.meta.url), 'utf8')
const orchestratorSource = readFileSync(new URL('../../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts', import.meta.url), 'utf8')
const hearingSource = readFileSync(new URL('../../../../../packages/stage-ui/src/stores/modules/hearing.ts', import.meta.url), 'utf8')

describe('voice transcript ingress telemetry source contract', () => {
  it('streaming_asr_direct_boundary_test routes VAD finals through the endpoint controller', () => {
    const start = source.indexOf('function handleStreamingSentenceEnd')
    const end = source.indexOf('/** Replaces the caption', start)
    const streamingPath = source.slice(start, end)

    expect(streamingPath).toContain('streamingVoiceTurnEndpoint.finalTranscript(delta)')
    expect(streamingPath).not.toContain('sendVoiceInputTextToChat(finalText, turnId)')
    expect(streamingPath).not.toContain('voiceTranscriptBuffer')
    expect(source).toContain('streamingVoiceTurnEndpoint.speechActivityStart()')
    expect(source).toContain('streamingVoiceTurnEndpoint.speechActivityEnd()')
    expect(source).toContain('sendVoiceInputTextToChat(decision.aggregatedText, decision.telemetryTurnId)')
  })

  it('buffered_recorder_1200ms_attribution_test keeps recorder finals on the existing buffer', () => {
    const start = source.indexOf('onTranscriptionResult:')
    const end = source.indexOf('onTranscriptionEmpty:', start)
    const recorderPath = source.slice(start, end)

    expect(recorderPath).toContain('markRealtimeVoiceAsrFinal(\'buffered-recorder\')')
    expect(recorderPath).toContain('voiceTranscriptBuffer.push(text)')
    expect(source).toContain('flushDelayMs: 1200')
    expect(source).toContain('maxBufferedTextLength: 90')
  })

  it('vad activity callbacks are distinct from text-bearing final callbacks', () => {
    expect(source).toContain('onSpeechActivityStart: handleStreamingSpeechActivityStart')
    expect(source).toContain('onSpeechActivityEnd: handleStreamingSpeechActivityEnd')
    expect(source).toContain('onSpeechActivityCancel: handleStreamingSpeechActivityCancel')
    expect(source).toContain('onSentenceEnd: handleStreamingSentenceEnd')
  })

  it('current_now_speaking_keeps_realtime_local_listening_but_preserves_recorder_suppression', () => {
    const watcherStart = source.indexOf('watch(nowSpeaking')
    const watcherEnd = source.indexOf('onMounted(() =>', watcherStart)
    const watcher = source.slice(watcherStart, watcherEnd)
    const gateStart = source.indexOf('function inspectVoiceInputStreamingRequestGate')
    const gateEnd = source.indexOf('/** Clears the pending assistant-speech resume timer.', gateStart)
    const gate = source.slice(gateStart, gateEnd)

    expect(watcher).toContain('if (speaking)')
    expect(watcher).toContain('voiceInputInteractionLifecycle.stop({ flushTranscript: false })')
    expect(watcher).toContain('bargeInController.assistantPlaybackStarted()')
    expect(watcher).toContain('if (isRealtimeBargeInMode.value)')
    expect(source).toContain('assistantSpeechSuppressedUntil.value = assistantSpeechCooldownDeadline()')
    expect(gate).toContain('const suppressed = isVoiceInputSuppressed()')
    expect(gate).toContain('skip: !audioEnabled || (suppressed && !localListeningAllowed)')
    expect(gate).toContain('localListeningAllowed')
  })

  it('output_stop_is_not_an_llm_generation_abort_authority', () => {
    const stopStart = stageSource.indexOf('function stopSpeechOutput')
    const stopEnd = stageSource.indexOf('\n}\n', stopStart) + 2
    const stop = stageSource.slice(stopStart, stopEnd)

    expect(stop).toContain('currentSession?.cancel(reason)')
    expect(stop).toContain('speechPipeline.stopAll(reason)')
    expect(stop).toContain('playbackManager.stopAll(reason)')
    expect(stop).toContain('resetAssistantSpeechSurface(reason)')
    expect(speechOutputControlSource).toContain('without cancelling chat text generation')
    expect(chatSource).toContain('function cancelPendingSends(sessionId?: string)')
    expect(orchestratorSource).toContain('function cancelPendingSends(sessionId?: string)')
    expect(orchestratorSource).toContain('getSessionGeneration(sessionId)')
  })

  it('microphone_requests_browser_aec_noise_suppression_and_agc', () => {
    const audioDeviceSource = readFileSync(new URL('../../../../../packages/stage-ui/src/composables/audio/audio-device.ts', import.meta.url), 'utf8')
    const microphoneConstraintsSource = readFileSync(new URL('../../../../../packages/stage-ui/src/composables/audio/microphone-constraints.ts', import.meta.url), 'utf8')

    expect(audioDeviceSource).toContain('PRODUCTION_MICROPHONE_AUDIO_CONSTRAINTS')
    expect(microphoneConstraintsSource).toContain('autoGainControl: true')
    expect(microphoneConstraintsSource).toContain('echoCancellation: true')
    expect(microphoneConstraintsSource).toContain('noiseSuppression: true')
  })

  it('endpoint_cancel_and_vad_segment_prefix_seams_are_explicit', () => {
    expect(source).toContain('const cancelledTurnId = streamingVoiceTurnEndpoint.cancel()')
    expect(source).toContain('streamingVoiceTurnEndpoint.forceFlush(\'explicit-flush\')')
    expect(hearingSource).toContain('activeSegment = { audioChunks: [] }')
    expect(hearingSource).toContain('segment.audioChunks.push(chunk)')
    expect(hearingSource).toContain('for (const chunk of segment.audioChunks)')
    expect(hearingSource).toContain('segment.audioChunks.length = 0')
  })

  it('barge_in_gates_remote_authority_and_invalidates_stale_assistant_output', () => {
    expect(source).toContain('bargeInController.speechStart()')
    expect(source).toContain('registerAssistantTurnStartHandler')
    expect(source).toContain('assistantTurnStarted(turnId)')
    expect(source).toContain('speechOutputControlStore.requestStopSpeaking(\'barge-in\')')
    expect(source).toContain('chatStore.cancelActiveGenerations(chatSession.activeSessionId)')
    expect(source).toContain('recordBargeInRemoteAsrAuthorization()')
    expect(source).toContain('canStartRemoteAsr: () => !isVoiceInputSuppressed() || bargeInController.isInterruptionActive()')
    expect(stageSource).toContain('registerImmediateStopHandler')
    expect(stageSource).toContain('consumeImmediatelyHandledRequest(request.id)')
    expect(stageSource).toContain('currentSessionTurnId !== turnId')
    expect(stageSource).toContain('setSpeakingForCurrentSession')
    expect(stageSource).toContain('announceAssistantTurnStarted(context.turnId)')
    expect(stageSource).toContain('recordBargeInStaleOutputSuppressed()')
    expect(speechOutputControlSource).toContain('announceAssistantTurnStarted')
    expect(orchestratorSource).toContain('cancelActiveGenerations(sessionId?: string)')
    expect(orchestratorSource).toContain('generationAbortController.signal')
    expect(orchestratorSource).toContain('sessionGenerationEpochs')
    expect(hearingSource).toContain('canStart: options.canStartRemoteAsr')
  })
})
