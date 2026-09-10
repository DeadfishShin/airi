import type { Qwen3TtsPcmAudioContext } from './qwen-tts-pcm-playback'
import type { Qwen3TtsStageSessionOptions } from './qwen-tts-stage-session'
import type { StageTtsSession } from './tts-session'

import { createQwen3TtsStageSession } from './qwen-tts-stage-session'

/** Preview text is intentionally much smaller than the production text buffer. */
export const QWEN3_TTS_PREVIEW_MAX_TEXT_CHARS = 280

export type Qwen3TtsStreamingPreviewState = 'idle' | 'starting' | 'active' | 'completed' | 'cancelled' | 'failed'

export interface Qwen3TtsStreamingPreviewInput {
  model: string
  voice: string
  text: string
}

export interface Qwen3TtsStreamingPreviewSnapshot {
  model: string
  voice: string
  text: string
}

export interface Qwen3TtsStreamingPreviewAudioContext extends Qwen3TtsPcmAudioContext {
  close?: () => Promise<void> | void
}

export interface Qwen3TtsStreamingPreviewControllerOptions {
  createAudioContext: () => Qwen3TtsStreamingPreviewAudioContext
  createSession?: (options: Qwen3TtsStageSessionOptions) => StageTtsSession
  onStateChange?: (state: Qwen3TtsStreamingPreviewState) => void
  onError?: (error: Error) => void
  onComplete?: (snapshot: Qwen3TtsStreamingPreviewSnapshot) => void
}

export interface Qwen3TtsStreamingPreviewController {
  start: (input: Qwen3TtsStreamingPreviewInput) => void
  cancel: (reason?: string) => void
  state: () => Qwen3TtsStreamingPreviewState
  activeSnapshot: () => Qwen3TtsStreamingPreviewSnapshot | undefined
}

export function normalizeQwen3TtsPreviewText(value: string): string {
  return value.trim()
}

export function validateQwen3TtsPreviewText(value: string): string {
  const text = normalizeQwen3TtsPreviewText(value)
  if (!text)
    throw new Error('Preview text is required.')
  if (text.length > QWEN3_TTS_PREVIEW_MAX_TEXT_CHARS)
    throw new Error(`Preview text must be ${QWEN3_TTS_PREVIEW_MAX_TEXT_CHARS} characters or fewer.`)
  return text
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Qwen3 realtime preview failed.')
}

/**
 * Owns one settings-only Qwen preview session. It reuses the production
 * Stage adapter and PCM bridge while keeping the conversational TTS lane
 * completely separate.
 */
export function createQwen3TtsStreamingPreviewController(
  options: Qwen3TtsStreamingPreviewControllerOptions,
): Qwen3TtsStreamingPreviewController {
  const createSession = options.createSession ?? createQwen3TtsStageSession
  let currentState: Qwen3TtsStreamingPreviewState = 'idle'
  let active: { token: number, session?: StageTtsSession, audioContext: Qwen3TtsStreamingPreviewAudioContext, snapshot: Qwen3TtsStreamingPreviewSnapshot } | undefined
  let nextToken = 0

  const setState = (state: Qwen3TtsStreamingPreviewState) => {
    currentState = state
    options.onStateChange?.(state)
  }

  const closeAudioContext = (audioContext: Qwen3TtsStreamingPreviewAudioContext) => {
    try {
      void Promise.resolve(audioContext.close?.()).catch(() => {})
    }
    catch {}
  }

  const cancel = (reason = 'preview-cancelled') => {
    const previous = active
    if (!previous)
      return

    active = undefined
    nextToken++
    previous.session?.cancel(reason)
    closeAudioContext(previous.audioContext)
    setState('cancelled')
    setState('idle')
  }

  const start = (input: Qwen3TtsStreamingPreviewInput) => {
    const text = validateQwen3TtsPreviewText(input.text)
    cancel('preview-replaced')

    const snapshot: Qwen3TtsStreamingPreviewSnapshot = {
      model: input.model,
      voice: input.voice,
      text,
    }
    const token = ++nextToken
    const audioContext = options.createAudioContext()
    const current: { token: number, session?: StageTtsSession, audioContext: Qwen3TtsStreamingPreviewAudioContext, snapshot: Qwen3TtsStreamingPreviewSnapshot } = { token, audioContext, snapshot }
    active = current
    setState('starting')

    // The settings button is an explicit user gesture. Invoke resume before
    // creating/queuing the session so Chromium's activation is on this path.
    try {
      const resume = audioContext.resume?.()
      void resume?.catch((reason) => {
        if (active?.token !== token)
          return
        const error = errorFrom(reason)
        active.session?.cancel('preview-audio-context-resume-failed')
        active = undefined
        closeAudioContext(audioContext)
        setState('failed')
        options.onError?.(error)
        setState('idle')
      })

      const session = createSession({
        intentId: `settings-preview-${token}`,
        snapshot: {
          model: snapshot.model,
          voice: snapshot.voice,
          voiceType: 'official_selected',
          bufferEntireSession: false,
          extraBody: {},
          onImmediateSpecial: () => {},
        },
        audioContext,
        hooks: {
          onError: (reason) => {
            if (active?.token !== token)
              return
            active = undefined
            closeAudioContext(audioContext)
            setState('failed')
            options.onError?.(errorFrom(reason))
            setState('idle')
          },
          onDone: () => {
            if (active?.token !== token)
              return
            active = undefined
            closeAudioContext(audioContext)
            setState('completed')
            options.onComplete?.(snapshot)
            setState('idle')
          },
        },
      })

      if (active?.token !== token) {
        session.cancel('preview-invalidated-before-start')
        closeAudioContext(audioContext)
        return
      }

      current.session = session
      setState('active')
      session.appendText(snapshot.text)
      session.finishInput()
    }
    catch (reason) {
      if (active?.token !== token)
        return
      active = undefined
      closeAudioContext(audioContext)
      setState('failed')
      options.onError?.(errorFrom(reason))
      setState('idle')
      throw reason
    }
  }

  return {
    start,
    cancel,
    state: () => currentState,
    activeSnapshot: () => active?.snapshot,
  }
}
