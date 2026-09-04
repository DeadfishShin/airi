import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type SpeechOutputStopReason = 'manual-chat' | 'manual-all' | 'muted' | 'barge-in'

type ImmediateStopHandler = (reason: SpeechOutputStopReason) => void
type AssistantTurnStartHandler = (turnId: string) => void

/**
 * Represents a user-requested stop-speaking command for the stage output host.
 */
export interface SpeechOutputStopRequest {
  /** Monotonic sequence number so repeated requests with the same reason still notify watchers. */
  id: number
  /** Source of the stop-speaking request. */
  reason: SpeechOutputStopReason
}

export const useSpeechOutputControlStore = defineStore('speech-output-control', () => {
  const speechMuted = useLocalStorage('settings/speech/output-muted', false, {
    window: typeof window === 'undefined' ? undefined : window,
  })
  const latestStopRequest = ref<SpeechOutputStopRequest>()
  let nextRequestId = 1
  let immediateStopHandler: ImmediateStopHandler | undefined
  let immediatelyHandledRequestId = 0
  let assistantTurnStartHandler: AssistantTurnStartHandler | undefined

  /**
   * Requests that the active speech output host stops assistant audio playback.
   *
   * Use when:
   * - A UI control should stop TTS playback without cancelling chat text generation.
   *
   * Expects:
   * - A mounted Stage host is watching {@link latestStopRequest}.
   *
   * Returns:
   * - Nothing. The latest request is published for the Stage host to consume.
   */
  function requestStopSpeaking(reason: SpeechOutputStopReason) {
    const request = {
      id: nextRequestId++,
      reason,
    }
    latestStopRequest.value = request

    // Barge-in is latency-sensitive: a mounted Stage host can execute the
    // existing cancellation primitive synchronously in the same renderer
    // turn. The reactive request remains as a fallback for a host that is
    // between mounts.
    if (reason === 'barge-in' && immediateStopHandler) {
      immediateStopHandler(reason)
      immediatelyHandledRequestId = request.id
    }
  }

  function registerImmediateStopHandler(handler: ImmediateStopHandler) {
    immediateStopHandler = handler
    return () => {
      if (immediateStopHandler === handler)
        immediateStopHandler = undefined
    }
  }

  function consumeImmediatelyHandledRequest(requestId: number) {
    if (immediatelyHandledRequestId !== requestId)
      return false

    immediatelyHandledRequestId = 0
    return true
  }

  /** Announces a new assistant turn to synchronous renderer coordination seams. */
  function announceAssistantTurnStarted(turnId: string) {
    assistantTurnStartHandler?.(turnId)
  }

  function registerAssistantTurnStartHandler(handler: AssistantTurnStartHandler) {
    assistantTurnStartHandler = handler
    return () => {
      if (assistantTurnStartHandler === handler)
        assistantTurnStartHandler = undefined
    }
  }

  /**
   * Enables or disables automatic assistant speech output.
   *
   * Enabling mute also publishes a stop request so an active Stage host can
   * cancel synthesis, streaming transport, queued audio, and current playback.
   */
  function setSpeechMuted(muted: boolean) {
    if (speechMuted.value === muted)
      return

    speechMuted.value = muted
    if (muted)
      requestStopSpeaking('muted')
  }

  function toggleSpeechMuted() {
    setSpeechMuted(!speechMuted.value)
  }

  return {
    latestStopRequest,
    speechMuted,
    requestStopSpeaking,
    registerImmediateStopHandler,
    consumeImmediatelyHandledRequest,
    announceAssistantTurnStarted,
    registerAssistantTurnStartHandler,
    setSpeechMuted,
    toggleSpeechMuted,
  }
})
