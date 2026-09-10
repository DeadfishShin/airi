import type { Qwen3TtsPcmAudioContext } from './qwen-tts-pcm-playback'
import type { Qwen3TtsStageSessionOptions } from './qwen-tts-stage-session'

import { describe, expect, it, vi } from 'vitest'

import {
  createQwen3TtsStreamingPreviewController,
  QWEN3_TTS_PREVIEW_MAX_TEXT_CHARS,
  validateQwen3TtsPreviewText,
} from './qwen-tts-streaming-preview'

function audioContext() {
  return {
    currentTime: 0,
    destination: {} as AudioNode,
    state: 'running' as AudioContextState,
    createBuffer: vi.fn(),
    createBufferSource: vi.fn(),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } as unknown as Qwen3TtsPcmAudioContext & { close: () => Promise<void> }
}

function fakeSessionFactory() {
  const sessions: Array<{
    options: Qwen3TtsStageSessionOptions
    appendText: ReturnType<typeof vi.fn>
    finishInput: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
  }> = []
  const createSession = vi.fn((options: Qwen3TtsStageSessionOptions) => {
    const session = {
      options,
      appendText: vi.fn(),
      finishInput: vi.fn(),
      cancel: vi.fn(),
    }
    sessions.push(session)
    return {
      intentId: options.intentId,
      appendText: session.appendText,
      appendSpecial: vi.fn(),
      finishInput: session.finishInput,
      end: vi.fn(),
      cancel: session.cancel,
    }
  })
  return { createSession, sessions }
}

describe('qwen3 settings streaming preview', () => {
  it('trims bounded plain text and rejects empty or over-limit input', () => {
    expect(validateQwen3TtsPreviewText('  hello  ')).toBe('hello')
    expect(() => validateQwen3TtsPreviewText('   ')).toThrow('required')
    expect(() => validateQwen3TtsPreviewText('x'.repeat(QWEN3_TTS_PREVIEW_MAX_TEXT_CHARS + 1))).toThrow('280')
  })

  it('starts exactly one isolated session with the selected model, provider voice id, and bounded text', () => {
    const factory = fakeSessionFactory()
    const controller = createQwen3TtsStreamingPreviewController({
      createAudioContext: audioContext,
      createSession: factory.createSession,
    })

    controller.start({ model: 'qwen3-tts-flash-realtime', voice: 'Jada', text: '  preview text  ' })

    expect(factory.createSession).toHaveBeenCalledTimes(1)
    expect(factory.sessions[0]?.options.snapshot).toMatchObject({ model: 'qwen3-tts-flash-realtime', voice: 'Jada' })
    expect(factory.sessions[0]?.appendText).toHaveBeenCalledWith('preview text')
    expect(factory.sessions[0]?.finishInput).toHaveBeenCalledTimes(1)
    expect((factory.sessions[0]?.options.audioContext.resume as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1)
    expect(controller.activeSnapshot()).toEqual({ model: 'qwen3-tts-flash-realtime', voice: 'Jada', text: 'preview text' })
  })

  it('cancels the previous preview before starting a replacement and ignores stale completion', () => {
    const factory = fakeSessionFactory()
    const states: string[] = []
    const controller = createQwen3TtsStreamingPreviewController({
      createAudioContext: audioContext,
      createSession: factory.createSession,
      onStateChange: state => states.push(state),
    })

    controller.start({ model: 'qwen3-tts-flash-realtime', voice: 'Cherry', text: 'first' })
    controller.start({ model: 'qwen3-tts-instruct-flash-realtime', voice: 'Jada', text: 'second' })

    expect(factory.sessions[0]?.cancel).toHaveBeenCalledWith('preview-replaced')
    expect(factory.createSession).toHaveBeenCalledTimes(2)
    factory.sessions[0]?.options.hooks?.onDone?.()
    expect(controller.state()).toBe('active')

    factory.sessions[1]?.options.hooks?.onDone?.()
    expect(controller.state()).toBe('idle')
    expect(states).toContain('cancelled')
  })

  it('returns to idle-equivalent terminal state after error and closes the preview context', () => {
    const factory = fakeSessionFactory()
    const onError = vi.fn()
    const context = audioContext()
    const controller = createQwen3TtsStreamingPreviewController({
      createAudioContext: () => context,
      createSession: factory.createSession,
      onError,
    })

    controller.start({ model: 'qwen3-tts-flash-realtime', voice: 'Cherry', text: 'failure' })
    factory.sessions[0]?.options.hooks?.onError?.(new Error('sanitized failure'))

    expect(controller.state()).toBe('idle')
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(controller.activeSnapshot()).toBeUndefined()
  })
})
