import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import {
  clearModelMotionOverride,
  migrateLegacyMotionOverrides,
  resolveModelMotionOverrides,
  setModelMotionOverride,
} from '../utils/live2d-compatibility'
import { supportedControl, useL2dViewControl } from './view-control'

export type Live2DMotionMapByModel = Record<string, Record<string, string>>

type BroadcastChannelEvents
  = | BroadcastChannelEventShouldUpdateView
    | BroadcastChannelEventMotionMappingChanged

interface BroadcastChannelEventShouldUpdateView {
  type: 'live2d-should-update-view'
}

interface BroadcastChannelEventMotionMappingChanged {
  type: 'live2d-motion-mapping-changed'
}

export const defaultModelParameters = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  leftEyeOpen: 1,
  rightEyeOpen: 1,
  leftEyeSmile: 0,
  rightEyeSmile: 0,
  leftEyebrowLR: 0,
  rightEyebrowLR: 0,
  leftEyebrowY: 0,
  rightEyebrowY: 0,
  leftEyebrowAngle: 0,
  rightEyebrowAngle: 0,
  leftEyebrowForm: 0,
  rightEyebrowForm: 0,
  mouthOpen: 0,
  mouthForm: 0,
  cheek: 0,
  bodyAngleX: 0,
  bodyAngleY: 0,
  bodyAngleZ: 0,
  breath: 0,
}

export const useLive2dParams = defineStore('live2d', () => {
  const { post, data } = useBroadcastChannel<BroadcastChannelEvents, BroadcastChannelEvents>({ name: 'airi-stores-stage-ui-live2d' })
  const shouldUpdateViewHooks = ref(new Set<() => void>())
  const motionMappingChangedHooks = ref(new Set<() => void>())

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView() {
    post({ type: 'live2d-should-update-view' })
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  const onMotionMappingChanged = (hook: () => void) => {
    motionMappingChangedHooks.value.add(hook)
    return () => {
      motionMappingChangedHooks.value.delete(hook)
    }
  }

  function notifyMotionMappingChanged() {
    post({ type: 'live2d-motion-mapping-changed' })
    motionMappingChangedHooks.value.forEach(hook => hook())
  }

  watch(data, (event) => {
    if (event?.type === 'live2d-should-update-view') {
      shouldUpdateViewHooks.value.forEach(hook => hook())
    }
    if (event?.type === 'live2d-motion-mapping-changed') {
      motionMappingChangedHooks.value.forEach(hook => hook())
    }
  })

  const currentMotion = useLocalStorageManualReset<{ group: string, index?: number }>('settings/live2d/current-motion', () => ({ group: 'Idle', index: 0 }))
  const availableMotions = useLocalStorageManualReset<{ motionName: string, motionIndex: number, fileName: string }[]>('settings/live2d/available-motions', () => [])
  // The existing key is retained for compatibility, but its value is now a
  // modelId -> filename -> semantic map. A legacy flat map is migrated only
  // when a concrete current modelId is supplied by the renderer.
  const motionMap = useLocalStorageManualReset<Live2DMotionMapByModel>('settings/live2d/motion-map', {})
  const { position, scale, set: setViewControl } = useL2dViewControl()

  // Live2D model parameters
  const modelParameters = useLocalStorageManualReset<Record<string, number>>('settings/live2d/parameters', defaultModelParameters)

  function resetState() {
    supportedControl.forEach(c => setViewControl(c))
    currentMotion.reset()
    availableMotions.reset()
    motionMap.reset()
    modelParameters.reset()
    shouldUpdateView()
  }

  function getMotionOverrides(modelId?: string): Record<string, string> {
    const scoped = resolveModelMotionOverrides(motionMap.value, modelId)
    if (Object.keys(scoped).length > 0 || !modelId)
      return scoped

    const migrated = migrateLegacyMotionOverrides(motionMap.value, modelId)
    if (!migrated)
      return scoped

    motionMap.value = migrated
    return resolveModelMotionOverrides(motionMap.value, modelId)
  }

  function setMotionOverride(modelId: string | undefined, fileName: string, semantic: string) {
    motionMap.value = setModelMotionOverride(motionMap.value, modelId, fileName, semantic)
  }

  function clearMotionOverride(modelId: string | undefined, fileName: string) {
    motionMap.value = clearModelMotionOverride(motionMap.value, modelId, fileName)
  }

  return {
    position,
    currentMotion,
    availableMotions,
    motionMap,
    getMotionOverrides,
    setMotionOverride,
    clearMotionOverride,
    onMotionMappingChanged,
    notifyMotionMappingChanged,
    scale,
    modelParameters,

    onShouldUpdateView,
    shouldUpdateView,
    resetState,
  }
})
export { useL2dViewControl }
