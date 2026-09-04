import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createBargeInController,
  getBargeInTelemetry,
  resetBargeInTelemetry,
} from './barge-in'

describe('createBargeInController', () => {
  beforeEach(() => {
    resetBargeInTelemetry()
  })

  it('keeps local VAD active without authorizing ASR during ordinary playback', () => {
    const onBargeIn = vi.fn()
    const controller = createBargeInController({ onBargeIn })

    controller.setLocalVadActive(true)
    controller.assistantTurnStarted()
    controller.assistantPlaybackStarted()

    expect(controller.snapshot()).toMatchObject({
      localVadActiveDuringPlayback: true,
      triggerCount: 0,
      remoteAsrAuthorizeCount: 0,
    })
    expect(onBargeIn).not.toHaveBeenCalled()
  })

  it('fires one transaction for the first credible speech-start and suppresses duplicates', () => {
    const onBargeIn = vi.fn()
    const controller = createBargeInController({ onBargeIn })

    controller.setLocalVadActive(true)
    controller.assistantTurnStarted()
    controller.assistantPlaybackStarted()
    expect(controller.speechStart()).toEqual({
      triggered: true,
      duplicateSuppressed: false,
      epoch: 1,
    })
    expect(controller.speechStart()).toEqual({
      triggered: false,
      duplicateSuppressed: true,
      epoch: 1,
    })
    controller.assistantPlaybackEnded()

    expect(onBargeIn).toHaveBeenCalledTimes(1)
    expect(controller.isInterruptionActive()).toBe(true)
    expect(getBargeInTelemetry()).toMatchObject({
      triggerCount: 1,
      duplicateTriggerSuppressedCount: 1,
      localVadActiveDuringPlayback: false,
    })
  })

  it('uses a new epoch for a later assistant playback turn', () => {
    const onBargeIn = vi.fn()
    const controller = createBargeInController({ onBargeIn })

    controller.assistantTurnStarted()
    controller.assistantPlaybackStarted()
    controller.speechStart()
    controller.assistantPlaybackEnded()
    controller.assistantPlaybackStarted()
    expect(controller.speechStart()).toEqual({
      triggered: false,
      duplicateSuppressed: true,
      epoch: 1,
    })
    controller.assistantPlaybackEnded()
    controller.assistantTurnStarted()
    controller.assistantPlaybackStarted()
    controller.speechStart()

    expect(onBargeIn.mock.calls.map(([event]) => event.epoch)).toEqual([1, 2])
    expect(controller.snapshot().epoch).toBe(2)
  })

  it('does not treat speech-start as a barge-in when playback is inactive', () => {
    const onBargeIn = vi.fn()
    const controller = createBargeInController({ onBargeIn })

    expect(controller.speechStart()).toEqual({
      triggered: false,
      duplicateSuppressed: false,
      epoch: 0,
    })
    expect(onBargeIn).not.toHaveBeenCalled()
  })

  it('does not restart the epoch when the same assistant turn is announced twice', () => {
    const controller = createBargeInController({ onBargeIn: vi.fn() })

    controller.assistantTurnStarted('turn-1')
    controller.assistantTurnStarted('turn-1')

    expect(controller.snapshot().epoch).toBe(1)
  })

  it('keeps barge-in telemetry bounded and content-free', () => {
    const controller = createBargeInController({ onBargeIn: vi.fn() })

    controller.setLocalVadActive(true)
    controller.assistantTurnStarted()
    controller.assistantPlaybackStarted()
    controller.speechStart()

    expect(Object.keys(getBargeInTelemetry()).sort()).toEqual([
      'duplicateTriggerSuppressedCount',
      'epoch',
      'generationCancelOrInvalidateCount',
      'localVadActiveDuringPlayback',
      'remoteAsrAuthorizeCount',
      'staleOutputSuppressedCount',
      'triggerCount',
      'ttsCancelCount',
    ])
  })
})
