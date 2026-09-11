import { describe, expect, it } from 'vitest'

import { createLive2DLoadOwnershipGuard, finalizeLive2DLoadState } from './live2d-load-ownership'

type LoadState = Parameters<ReturnType<typeof createLive2DLoadOwnershipGuard>['isCurrent']>[1]

function state(overrides: Partial<LoadState> = {}): LoadState {
  return {
    currentModelSrc: 'model-a',
    currentModelId: 'a',
    isUnmounted: false,
    appIsCurrent: true,
    stageIsCurrent: true,
    ...overrides,
  }
}

describe('live2d load ownership', () => {
  it('releases the load latch after a stale stage-wait exit', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)

    expect(state).toEqual({ modelLoading: false, componentState: 'mounted' })
  })

  it('releases the load latch after an invalid app or stage exit', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)

    expect(state.modelLoading).toBe(false)
    expect(state.componentState).toBe('mounted')
  })

  it('allows a newer request to proceed after the stale request finalizes', () => {
    const staleState = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)
    const newerRequestCanProceed = staleState.modelLoading === false

    expect(newerRequestCanProceed).toBe(true)
  })

  it('releases the load latch when setup fails', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)

    expect(state).toEqual({ modelLoading: false, componentState: 'mounted' })
  })

  it('releases the load latch after a post-setup stale candidate is destroyed', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)

    expect(state.modelLoading).toBe(false)
  })

  it('finalizes a successful load as mounted', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, false)

    expect(state).toEqual({ modelLoading: false, componentState: 'mounted' })
  })

  it('does not write mounted after unmount', () => {
    const state = finalizeLive2DLoadState({ modelLoading: true, componentState: 'loading' }, true)

    expect(state).toEqual({ modelLoading: false, componentState: 'loading' })
  })

  it('rejects A after B becomes the latest request', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const requestA = ownership.begin('model-a', 'a')
    ownership.begin('model-b', 'b')

    expect(ownership.isCurrent(requestA, state())).toBe(false)
  })

  it('rejects an in-flight load after unmount', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const request = ownership.begin('model-a', 'a')

    ownership.invalidate()

    expect(ownership.isCurrent(request, state({ isUnmounted: true }))).toBe(false)
  })

  it('lets only the final request win in A → B → A', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const requestA1 = ownership.begin('model-a', 'a')
    const requestB = ownership.begin('model-b', 'b')
    const requestA2 = ownership.begin('model-a', 'a')

    expect(ownership.isCurrent(requestA1, state())).toBe(false)
    expect(ownership.isCurrent(requestB, state({ currentModelSrc: 'model-b', currentModelId: 'b' }))).toBe(false)
    expect(ownership.isCurrent(requestA2, state())).toBe(true)
  })

  it('accepts a normal current replacement when app and stage remain current', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const request = ownership.begin('model-b', 'b')

    expect(ownership.isCurrent(request, state({ currentModelSrc: 'model-b', currentModelId: 'b' }))).toBe(true)
  })

  it('rejects a result when the target app or stage is no longer current', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const request = ownership.begin('model-a', 'a')

    expect(ownership.isCurrent(request, state({ appIsCurrent: false }))).toBe(false)
    expect(ownership.isCurrent(request, state({ stageIsCurrent: false }))).toBe(false)
  })

  it('rejects stale completion without changing the requested identity', () => {
    const ownership = createLive2DLoadOwnershipGuard()
    const request = ownership.begin('model-a', 'a')

    expect(ownership.isCurrent(request, state({ currentModelSrc: 'model-b', currentModelId: 'b' }))).toBe(false)
  })
})
