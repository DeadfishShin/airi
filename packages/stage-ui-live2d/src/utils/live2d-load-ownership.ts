export interface Live2DLoadRequest {
  generation: number
  modelSrc?: string
  modelId?: string
}

export interface Live2DLoadOwnershipState {
  currentModelSrc?: string
  currentModelId?: string
  isUnmounted: boolean
  appIsCurrent?: boolean
  stageIsCurrent?: boolean
}

export type Live2DComponentState = 'pending' | 'loading' | 'mounted'

export interface Live2DLoadState {
  modelLoading: boolean
  componentState: Live2DComponentState
}

/**
 * Releases the load latch for every terminal load path. An unmounted
 * component must not be moved back to `mounted` after teardown.
 */
export function finalizeLive2DLoadState(state: Live2DLoadState, isUnmounted: boolean): Live2DLoadState {
  return {
    modelLoading: false,
    componentState: isUnmounted ? state.componentState : 'mounted',
  }
}

/**
 * Load failures are renderer-visible only while the corresponding request
 * still owns the current model slot. Ownership itself is evaluated by the
 * generation/identity/app/stage guard at the call site.
 */
export function shouldEmitLive2DLoadError(requestIsCurrent: boolean): boolean {
  return requestIsCurrent
}

/**
 * Gives every model-load attempt an ownership generation. A completed async
 * load may commit only while its generation and model identity are current.
 */
export function createLive2DLoadOwnershipGuard() {
  let generation = 0

  function begin(modelSrc?: string, modelId?: string): Live2DLoadRequest {
    generation += 1
    return { generation, modelSrc, modelId }
  }

  function invalidate() {
    generation += 1
  }

  function isCurrent(request: Live2DLoadRequest, state: Live2DLoadOwnershipState): boolean {
    if (request.generation !== generation || state.isUnmounted)
      return false

    if (request.modelSrc !== state.currentModelSrc || request.modelId !== state.currentModelId)
      return false

    if (state.appIsCurrent === false || state.stageIsCurrent === false)
      return false

    return true
  }

  return {
    begin,
    invalidate,
    isCurrent,
  }
}
