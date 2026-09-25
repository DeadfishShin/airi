<script setup lang="ts">
import type { Application } from '@pixi/app'

import type { PixiLive2DInternalModel } from '../../../composables/live2d'
import type { Live2DCompatibilityProfile, Live2DLogicalParameter, Live2DMotionLoopLease } from '../../../utils/live2d-compatibility'
import type { Live2DLoadRequest } from '../../../utils/live2d-load-ownership'

import { listenBeatSyncBeatSignal } from '@proj-airi/stage-shared/beat-sync'
import { useTheme } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { animate } from 'animejs'
import { formatHex } from 'culori'
import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { DropShadowFilter } from 'pixi-filters'
import { Live2DFactory, Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import { computed, onMounted, onUnmounted, ref, shallowRef, toRef, watch } from 'vue'

import {
  createBeatSyncController,
  createLive2DMotionSpring,
  disableLive2DSdkBreath,
  restoreLive2DModelParameterDefaults,
  useExpressionController,
  useLive2DIdleEyeFocus,
  useLive2DMotionManagerUpdate,
  useMotionUpdatePluginAutoEyeBlink,
  useMotionUpdatePluginBeatSync,
  useMotionUpdatePluginBreathControl,
  useMotionUpdatePluginExpression,
  useMotionUpdatePluginIdleDisable,
  useMotionUpdatePluginIdleFocus,
  useMotionUpdatePluginLipSync,
  useMotionUpdatePluginManualControl,
} from '../../../composables/live2d'
import { useFitModel } from '../../../composables/live2d/fit-model'
import { getLive2DMotionControlModelOffset, useL2dViewControl, useLive2DMotionControl, useLive2dParams } from '../../../stores'
import {
  acquireLive2DSemanticMotionLoopLease,
  bindLive2DFocusParameterTargets,
  createLive2DCompatibilityProfile,
  resolveCompletedSemanticMotionHandoff,
  resolveLive2DMotionRequest,
  shouldRestartResolvedIdleMotionOnFinish,
} from '../../../utils/live2d-compatibility'
import { createLive2DLoadOwnershipGuard, finalizeLive2DLoadState, shouldEmitLive2DLoadError } from '../../../utils/live2d-load-ownership'
import { clearSelectedLive2DMotion, readSelectedLive2DMotion } from '../../../utils/live2d-runtime-motion'

const props = withDefaults(defineProps<{
  modelSrc?: string
  modelId?: string

  app?: Application
  mouthOpenSize?: number
  nowSpeaking?: boolean
  width: number
  height: number
  paused?: boolean
  focusAt?: { x: number, y: number }
  eyeTracking?: boolean
  eyeFocusSourceActive?: boolean
  themeColorsHue?: number
  themeColorsHueDynamic?: boolean
  live2dIdleAnimationEnabled?: boolean
  live2dForceIdleEyeAnimation?: boolean
  live2dAutoBlinkEnabled?: boolean
  live2dForceAutoBlinkEnabled?: boolean
  live2dExpressionEnabled?: boolean
  live2dShadowEnabled?: boolean
}>(), {
  mouthOpenSize: 0,
  nowSpeaking: false,
  paused: false,
  focusAt: () => ({ x: 0, y: 0 }),
  eyeTracking: false,
  eyeFocusSourceActive: false,
  disableFocusAt: false,
  scale: 1,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
  live2dIdleAnimationEnabled: true,
  live2dForceIdleEyeAnimation: true,
  live2dAutoBlinkEnabled: true,
  live2dForceAutoBlinkEnabled: false,
  live2dExpressionEnabled: true,
  live2dShadowEnabled: true,
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'error', error: Error): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const { position, scale } = useL2dViewControl()
const {
  breathControl: manualBreathControl,
  control: manualMotionControl,
} = storeToRefs(useLive2DMotionControl())

const modelSrcRef = toRef(() => props.modelSrc)

const modelLoading = ref(false)
// Every in-flight load is also guarded by a generation. A newer request or
// unmount invalidates older async results before they can attach to the stage.
let isUnmounted = false
const loadOwnership = createLive2DLoadOwnershipGuard()
let refreshCompatibilityProfile: (() => void) | undefined

const modelLoadMutex = new Mutex()

const manualMotionSpring = createLive2DMotionSpring()
const manualControlOffset = computed(() => getLive2DMotionControlModelOffset(manualMotionSpring.output.value))
const offset = computed(() => ({
  x: (position.value.x / 100) * props.width + manualControlOffset.value.x,
  y: -(position.value.y / 100) * props.height + manualControlOffset.value.y,
}))

const pixiApp = toRef(() => props.app)
const paused = toRef(() => props.paused)
const focusAt = toRef(() => props.focusAt)
const model = shallowRef<Live2DModel<PixiLive2DInternalModel>>()
const compatibilityProfile = shallowRef<Live2DCompatibilityProfile>()
// Keep plugin registrations stable while allowing a model-scoped mapping to
// refresh the resolver in place. The proxy delegates every read to the latest
// resolved profile, so no model reload or duplicate motion pipeline is needed.
const compatibilityRuntime = new Proxy({} as Live2DCompatibilityProfile, {
  get(_target, property: keyof Live2DCompatibilityProfile) {
    const profile = compatibilityProfile.value
    return profile?.[property]
  },
})
const initialModelWidth = ref<number>(0)
const initialModelHeight = ref<number>(0)
const mouthOpenSize = computed(() => Math.max(0, Math.min(100, props.mouthOpenSize)))
const nowSpeaking = toRef(() => props.nowSpeaking)
const lastUpdateTime = ref(0)

const { isDark: dark } = useTheme()
const dropShadowFilter = shallowRef(new DropShadowFilter({
  alpha: 0.2,
  blur: 0,
  distance: 20,
  rotation: 45,
}))

let resizeAnimation: ReturnType<typeof animate> | undefined

const modelNormalizeParams = useFitModel(
  () => ({ width: props.width, height: props.height }),
  () => ({ width: initialModelWidth.value, height: initialModelHeight.value }),
)

watch([offset, scale, modelNormalizeParams], () => {
  setScaleAndPosition()
})

function setScaleAndPosition(animated = false) {
  if (!model.value)
    return

  const normalized = modelNormalizeParams.value

  if (!animated) {
    model.value.scale.set(normalized.scale * scale.value, normalized.scale * scale.value)
    model.value.x = normalized.x + offset.value.x
    model.value.y = normalized.y + offset.value.y
    return
  }

  resizeAnimation?.pause()

  const current = {
    scale: model.value.scale.x,
    x: model.value.x,
    y: model.value.y,
  }

  resizeAnimation = animate(current, {
    scale: normalized.scale * scale.value,
    x: normalized.x + offset.value.x,
    y: normalized.y + offset.value.y,
    duration: 200,
    ease: 'outQuad',
    onUpdate: () => {
      if (!model.value)
        return
      model.value.scale.set(current.scale, current.scale)
      model.value.x = current.x
      model.value.y = current.y
    },
  })
}

const live2dStore = useLive2dParams()
const {
  currentMotion,
  availableMotions,
  modelParameters,
} = storeToRefs(live2dStore)

const themeColorsHue = toRef(() => props.themeColorsHue)
const themeColorsHueDynamic = toRef(() => props.themeColorsHueDynamic)
const live2dIdleAnimationEnabled = toRef(() => props.live2dIdleAnimationEnabled)
const live2dEyeTrackingEnabled = toRef(() => props.eyeTracking)
const live2dEyeFocusSourceActive = toRef(() => props.eyeFocusSourceActive)
const live2dForceIdleEyeAnimation = toRef(() => props.live2dForceIdleEyeAnimation)
const live2dAutoBlinkEnabled = toRef(() => props.live2dAutoBlinkEnabled)
const live2dForceAutoBlinkEnabled = toRef(() => props.live2dForceAutoBlinkEnabled)
const live2dExpressionEnabled = toRef(() => props.live2dExpressionEnabled)
const live2dShadowEnabled = toRef(() => props.live2dShadowEnabled)

// --- Expression controller
const internalModelRef = shallowRef<PixiLive2DInternalModel>()
const expressionController = useExpressionController({
  internalModel: internalModelRef,
  modelId: props.modelId,
})
// Saved SDK manager references for runtime expression toggle (restore on disable)
const savedEyeBlink = shallowRef<any>(null)
const savedExpressionManager = shallowRef<any>(null)

const localCurrentMotion = ref<{ group: string, index: number }>({ group: 'Idle', index: 0 })
interface ActiveSemanticMotion {
  token: number
  group: string
  index: number
  loopLease: Live2DMotionLoopLease
}

let semanticMotionToken = 0
let activeSemanticMotion: ActiveSemanticMotion | undefined
let pendingSemanticMotion: Pick<ActiveSemanticMotion, 'token' | 'group' | 'index'> | undefined
let suppressCanonicalIdleAfterSemanticCompletion = false

function invalidateActiveSemanticMotion() {
  semanticMotionToken += 1
  suppressCanonicalIdleAfterSemanticCompletion = false
  activeSemanticMotion?.loopLease.restore()
  activeSemanticMotion = undefined
  pendingSemanticMotion = undefined
}

const beatSync = createBeatSyncController({
  baseAngles: () => ({
    x: modelParameters.value.angleX,
    y: modelParameters.value.angleY,
    z: modelParameters.value.angleZ,
  }),
  initialStyle: 'sway-sine',
})

// Listen for model reload requests (e.g., when runtime motion is uploaded)
const disposeShouldUpdateView = live2dStore.onShouldUpdateView(() => {
  loadModel()
})
const disposeMotionMappingChanged = live2dStore.onMotionMappingChanged(() => {
  refreshCompatibilityProfile?.()
})

async function loadModel() {
  refreshCompatibilityProfile = undefined
  const request = loadOwnership.begin(modelSrcRef.value, props.modelId)

  await until(modelLoading).not.toBeTruthy()

  await modelLoadMutex.acquire()
  try {
    await performModelLoad(request)
  }
  finally {
    modelLoadMutex.release()
  }
}

function isCurrentLoadRequest(request: Live2DLoadRequest, target?: { app?: Application, stage?: Application['stage'] }) {
  return loadOwnership.isCurrent(request, {
    currentModelSrc: modelSrcRef.value,
    currentModelId: props.modelId,
    isUnmounted,
    appIsCurrent: target?.app === undefined ? undefined : pixiApp.value === target.app,
    stageIsCurrent: target?.stage === undefined ? undefined : pixiApp.value?.stage === target.stage,
  })
}

function discardLoadedModel(candidate: Live2DModel<PixiLive2DInternalModel>) {
  if (model.value === candidate) {
    expressionController.dispose()
    internalModelRef.value = undefined
    compatibilityProfile.value = undefined
    model.value = undefined
  }

  try {
    candidate.parent?.removeChild(candidate)
  }
  catch (error) {
    console.warn('[Live2D] Failed to detach stale model candidate:', error)
  }

  try {
    candidate.destroy()
  }
  catch (error) {
    console.warn('[Live2D] Failed to destroy stale model candidate:', error)
  }
}

async function performModelLoad(request: Live2DLoadRequest) {
  if (!isCurrentLoadRequest(request))
    return

  modelLoading.value = true
  componentState.value = 'loading'
  invalidateActiveSemanticMotion()

  // Once the loading latch is raised, every terminal path below must pass
  // through the finalizer. This includes stale requests that resume after
  // waiting for a recreated PIXI stage.
  let targetApp: Application | undefined
  let targetStage: Application['stage'] | undefined

  try {
    if (!pixiApp.value || !pixiApp.value.stage) {
      try {
        // NOTICE: shouldUpdateView can fire while the canvas (pixiApp) is being torn down/recreated.
        // Wait briefly for the new stage instead of bailing out, otherwise we keep a blank screen.
        await until(() => !!pixiApp.value && !!pixiApp.value.stage).toBeTruthy({ timeout: 1500 })
      }
      catch {
        return
      }
    }

    targetApp = pixiApp.value
    targetStage = targetApp?.stage
    if (!targetApp || !targetStage || !isCurrentLoadRequest(request, { app: targetApp, stage: targetStage }))
      return

    // REVIEW: here as await until(...) guarded the pixiApp and stage to be valid.
    if (model.value && targetStage) {
      // Dispose expression controller before destroying the old model
      expressionController.dispose()
      internalModelRef.value = undefined
      compatibilityProfile.value = undefined

      try {
        targetStage.removeChild(model.value)
        model.value.destroy()
      }
      catch (error) {
        console.warn('Error removing old model:', error)
      }
      model.value = undefined
    }
    const requestModelSrc = request.modelSrc
    if (!requestModelSrc) {
      console.warn('No Live2D model source provided.')
      return
    }

    if (!isCurrentLoadRequest(request, { app: targetApp, stage: targetStage })) {
      return
    }

    const live2DModel = new Live2DModel<PixiLive2DInternalModel>()
    await Live2DFactory.setupLive2DModel(live2DModel, { url: requestModelSrc, id: request.modelId }, { autoInteract: false })

    // setupLive2DModel is asynchronous. A late candidate must never attach,
    // install listeners, or reclaim the stage after its request is obsolete.
    if (!isCurrentLoadRequest(request, { app: targetApp, stage: targetStage })) {
      discardLoadedModel(live2DModel)
      return
    }

    // --- Scene

    model.value = live2DModel
    targetStage.addChild(model.value)
    initialModelWidth.value = model.value.width
    initialModelHeight.value = model.value.height
    model.value.anchor.set(0.5, 0.5)
    setScaleAndPosition()

    // --- Interaction

    model.value.on('hit', (hitAreas) => {
      if (model.value && hitAreas.includes('body'))
        model.value.motion('tap_body')
    })

    // --- Motion

    const internalModel = model.value.internalModel
    const coreModel = internalModel.coreModel
    const motionManager = internalModel.motionManager
    const modelSettings = internalModel.settings as any
    refreshCompatibilityProfile = () => {
      const nextProfile = createLive2DCompatibilityProfile({
        coreModel,
        groups: modelSettings?.groups ?? modelSettings?.Groups,
        motionDefinitions: motionManager.definitions,
        motionOverrides: live2dStore.getMotionOverrides(request.modelId),
        modelId: request.modelId,
      })
      compatibilityProfile.value = nextProfile
      bindLive2DFocusParameterTargets(internalModel, nextProfile)
    }
    refreshCompatibilityProfile()
    // Keep pixi-live2d-display's focus geometry and smoothing as the only
    // pointer-coordinate authority. The compatibility layer only redirects
    // Cubism4InternalModel's physical focus targets for legacy IDs.
    disableLive2DSdkBreath(internalModel)
    compatibilityRuntime.setParameter(coreModel, 'mouthOpen', mouthOpenSize.value)

    availableMotions.value = Object
      .entries(motionManager.definitions)
      .flatMap(([motionName, definition]) => (definition?.map((motion: any, index: number) => ({
        motionName,
        motionIndex: index,
        fileName: motion.File,
      })) || []))
      .filter(Boolean)

    // A disabled idle setting is authoritative. Legacy profiles may still
    // contain the old group/index keys; clear them before they can regain
    // runtime authority. Invalid model-scoped selections fail closed.
    const persistedRuntimeMotion = readSelectedLive2DMotion()
    let selectedRuntimeMotion = persistedRuntimeMotion.motion
    if (!live2dIdleAnimationEnabled.value || persistedRuntimeMotion.invalid) {
      clearSelectedLive2DMotion()
      selectedRuntimeMotion = undefined
    }
    else if (selectedRuntimeMotion) {
      const groupIndex = (motionManager.groups as Record<string, any>)[selectedRuntimeMotion.group]
      const motion = groupIndex === undefined
        ? undefined
        : motionManager.motionGroups[groupIndex]?.[selectedRuntimeMotion.index]
      if (!motion) {
        clearSelectedLive2DMotion()
        selectedRuntimeMotion = undefined
      }
    }

    // Configure the selected motion to loop
    if (selectedRuntimeMotion) {
      const groupIndex = (motionManager.groups as Record<string, any>)[selectedRuntimeMotion.group]
      if (groupIndex !== undefined && motionManager.motionGroups[groupIndex]) {
        const motionIndex = selectedRuntimeMotion.index
        const motion = motionManager.motionGroups[groupIndex][motionIndex]
        if (motion && motion._looper) {
          // Force the motion to loop
          motion._looper.loopDuration = 0 // 0 means infinite loop
          console.info('Configured motion to loop infinitely:', selectedRuntimeMotion.group, motionIndex)
        }
      }
    }

    if (selectedRuntimeMotion && live2dIdleAnimationEnabled.value) {
      setTimeout(() => {
        console.info('Playing selected runtime motion:', selectedRuntimeMotion.group, selectedRuntimeMotion.index)
        currentMotion.value = {
          group: selectedRuntimeMotion.group,
          index: selectedRuntimeMotion.index,
        }
      }, 300)
    }

    const idleMotion = compatibilityRuntime.motionMap.idle
    const resolvedNonStandardIdle = idleMotion
      && idleMotion.confidence === 'high'
      && idleMotion.group !== motionManager.groups.idle
      ? idleMotion
      : undefined
    if (idleMotion && idleMotion.confidence === 'high' && !selectedRuntimeMotion && live2dIdleAnimationEnabled.value) {
      setTimeout(() => {
        currentMotion.value = { group: idleMotion.group, index: idleMotion.index }
      }, 300)
    }

    // Prevent idle eye curves from fighting pointer focus. For a mixed
    // non-standard source group, only protect the resolved idle candidate;
    // sibling Happy/Angry/etc. motions must keep their authored curves.
    const eyeBallIds = new Set([
      compatibilityRuntime.parameterId('eyeBallX'),
      compatibilityRuntime.parameterId('eyeBallY'),
    ].filter(Boolean))
    const protectIdleEyeCurves = (motion: any) => {
      motion?._motionData?.curves?.forEach((curve: any) => {
        if (eyeBallIds.has(curve.id))
          curve.id = `_${curve.id}`
      })
    }
    if (eyeBallIds.size > 0) {
      if (resolvedNonStandardIdle) {
        const idleMotionObject = motionManager.motionGroups[resolvedNonStandardIdle.group]?.[resolvedNonStandardIdle.index]
          ?? await motionManager.loadMotion(resolvedNonStandardIdle.group, resolvedNonStandardIdle.index)
        if (!isCurrentLoadRequest(request, { app: targetApp, stage: targetStage })) {
          if (model.value === live2DModel)
            model.value = undefined
          discardLoadedModel(live2DModel)
          return
        }
        protectIdleEyeCurves(idleMotionObject)
      }
      else {
        const canonicalIdleGroup = motionManager.groups.idle
        motionManager.motionGroups[canonicalIdleGroup]?.forEach(protectIdleEyeCurves)
      }
    }

    // This is hacky too
    const motionManagerUpdate = useLive2DMotionManagerUpdate({
      internalModel,
      motionManager,
      compatibility: compatibilityRuntime,
      modelParameters,
      live2dEyeTrackingEnabled,
      live2dEyeFocusSourceActive,
      live2dIdleAnimationEnabled,
      live2dForceIdleEyeAnimation,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      lastUpdateTime,
    })

    motionManagerUpdate.register(useMotionUpdatePluginBeatSync(beatSync), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleDisable(useLive2DIdleEyeFocus(compatibilityRuntime)), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleFocus(useLive2DIdleEyeFocus(compatibilityRuntime)), 'post')
    // Both run in 'final' stage (ignores handled state).
    // Expression first: sets desired parameter values (e.g. closed eyes = 0).
    // Blink second: reads post-expression eye values, Multiply-modulates on top.
    // This ensures blink respects expression state (0 × blinkFactor = 0).
    motionManagerUpdate.register(useMotionUpdatePluginExpression(expressionController), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginAutoEyeBlink(live2dExpressionEnabled), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginLipSync(mouthOpenSize, nowSpeaking), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginManualControl(manualMotionControl, manualMotionSpring), 'final')
    motionManagerUpdate.register(useMotionUpdatePluginBreathControl(manualBreathControl), 'final')

    const hookedUpdate = motionManager.update as (model: PixiLive2DInternalModel['coreModel'], now: number) => boolean
    motionManager.update = function (model: PixiLive2DInternalModel['coreModel'], now: number) {
      const result = motionManagerUpdate.hookUpdate(model, now, hookedUpdate)

      // Cubism can schedule its canonical Idle motion at the end of the same
      // update that emits motionFinish. A semantic action with idle disabled
      // explicitly suppresses that fallback for this frame only.
      if (suppressCanonicalIdleAfterSemanticCompletion) {
        suppressCanonicalIdleAfterSemanticCompletion = false
        if (motionManager.state.currentGroup === motionManager.groups.idle)
          motionManager.stopAllMotions()
      }

      return result
    }

    motionManager.on('motionStart', (group, index) => {
      localCurrentMotion.value = { group, index }
    })

    // Listen for semantic-action completion, selected runtime motion restart,
    // or a finite, non-standard compatibility idle. Every handoff is made by
    // exact group+index; the whole mixed source group is never randomized.
    motionManager.on('motionFinish', () => {
      const selectedMotion = readSelectedLive2DMotion().motion
      const finishedGroup = motionManager.state.currentGroup
      const finishedIndex = motionManager.state.currentIndex

      if (activeSemanticMotion) {
        const completedSemantic = activeSemanticMotion
        const isCurrentSemanticMotion = completedSemantic.group === finishedGroup
          && completedSemantic.index === finishedIndex

        // A completion from an older motion must never steal ownership from a
        // newer semantic action. The SDK emits this event without the motion
        // identity, so the current manager state is the authoritative check.
        if (!isCurrentSemanticMotion)
          return

        activeSemanticMotion = undefined
        completedSemantic.loopLease.restore()

        const completionToken = completedSemantic.token
        const queueExactMotion = (group: string, index: number) => {
          requestAnimationFrame(() => {
            if (semanticMotionToken !== completionToken)
              return
            currentMotion.value = { group, index }
          })
        }

        const handoff = resolveCompletedSemanticMotionHandoff({
          enabled: live2dIdleAnimationEnabled.value,
          selectedMotion,
          compatibilityIdle: resolvedNonStandardIdle,
          active: completedSemantic,
          finishedGroup,
          finishedIndex,
        })

        if (handoff.type === 'selected' || handoff.type === 'compatibility') {
          queueExactMotion(handoff.group, handoff.index)
        }
        else if (handoff.type === 'neutral') {
          restoreLive2DModelParameterDefaults(coreModel)
          suppressCanonicalIdleAfterSemanticCompletion = true
        }
        return
      }

      // A newer semantic request may still be loading its physical motion.
      // Ignore the older motion's finish event until that request establishes
      // its ownership; otherwise the SDK finish callback could queue idle and
      // steal playback from the newer semantic action.
      if (pendingSemanticMotion)
        return

      if (selectedMotion && live2dIdleAnimationEnabled.value) {
        // Restart the selected runtime motion immediately for seamless looping
        console.info('Motion finished, restarting runtime motion:', selectedMotion.group, selectedMotion.index)
        // Use requestAnimationFrame to restart on the next frame for smooth transition
        requestAnimationFrame(() => {
          currentMotion.value = {
            group: selectedMotion.group,
            index: selectedMotion.index,
          }
        })
        return
      }

      if (!resolvedNonStandardIdle)
        return

      const shouldRestartIdle = shouldRestartResolvedIdleMotionOnFinish({
        enabled: live2dIdleAnimationEnabled.value,
        manualMotionSelected: selectedMotion !== undefined,
        canonicalIdleGroup: motionManager.groups.idle,
        candidate: resolvedNonStandardIdle,
        finishedGroup,
        finishedIndex,
      })
      if (!shouldRestartIdle)
        return

      requestAnimationFrame(() => {
        if (!live2dIdleAnimationEnabled.value)
          return
        if (readSelectedLive2DMotion().motion)
          return
        const activeGroup = motionManager.state.currentGroup
        if (activeGroup && (activeGroup !== resolvedNonStandardIdle.group || motionManager.state.currentIndex !== resolvedNonStandardIdle.index))
          return
        currentMotion.value = {
          group: resolvedNonStandardIdle.group,
          index: resolvedNonStandardIdle.index,
        }
      })
    })

    // The SDK's own idle fallback only knows the canonical `Idle` group. A
    // resolved non-standard candidate therefore needs the listener above;
    // canonical groups remain owned by pixi-live2d-display.

    // Apply all stored parameters through the resolved logical compatibility map.
    const setLogical = (logical: Live2DLogicalParameter, value: number) => {
      compatibilityProfile.value?.setParameter(coreModel, logical, value)
    }
    const setPhysical = (id: string, value: number) => {
      compatibilityProfile.value?.setPhysicalParameter(coreModel, id, value)
    }
    setLogical('angleX', modelParameters.value.angleX)
    setLogical('angleY', modelParameters.value.angleY)
    setLogical('angleZ', modelParameters.value.angleZ)
    setLogical('eyeLeftOpen', modelParameters.value.leftEyeOpen)
    setLogical('eyeRightOpen', modelParameters.value.rightEyeOpen)
    setPhysical('ParamEyeSmile', modelParameters.value.leftEyeSmile)
    setPhysical('ParamBrowLX', modelParameters.value.leftEyebrowLR)
    setPhysical('ParamBrowRX', modelParameters.value.rightEyebrowLR)
    setPhysical('ParamBrowLY', modelParameters.value.leftEyebrowY)
    setPhysical('ParamBrowRY', modelParameters.value.rightEyebrowY)
    setPhysical('ParamBrowLAngle', modelParameters.value.leftEyebrowAngle)
    setPhysical('ParamBrowRAngle', modelParameters.value.rightEyebrowAngle)
    setPhysical('ParamBrowLForm', modelParameters.value.leftEyebrowForm)
    setPhysical('ParamBrowRForm', modelParameters.value.rightEyebrowForm)
    setLogical('mouthOpen', modelParameters.value.mouthOpen)
    setLogical('mouthForm', modelParameters.value.mouthForm)
    setPhysical('ParamCheek', modelParameters.value.cheek)
    setLogical('bodyAngleX', modelParameters.value.bodyAngleX)
    setLogical('bodyAngleY', modelParameters.value.bodyAngleY)
    setLogical('bodyAngleZ', modelParameters.value.bodyAngleZ)
    setLogical('breath', modelParameters.value.breath)

    // Save SDK manager references so they can be restored if expression is
    // toggled off at runtime.
    savedEyeBlink.value = internalModel.eyeBlink
    savedExpressionManager.value = motionManager.expressionManager

    // --- Expression controller initialisation (conditional)
    if (live2dExpressionEnabled.value) {
      // Disable built-in Cubism expression manager — our expression-controller
      // replaces it. The SDK's manager runs after motionManager.update() and
      // would overwrite our final-plugin values every frame.
      if (motionManager.expressionManager) {
        ;(motionManager as any).expressionManager = null
      }
      // Disable SDK eyeBlink — it runs on frames where motionUpdated=false and
      // would conflict with expression eye parameter overrides. Our auto-blink
      // plugin (Force Auto Blink setting) provides the replacement for models
      // without idle-motion blink curves.
      if (internalModel.eyeBlink) {
        ;(internalModel as any).eyeBlink = null
      }

      internalModelRef.value = internalModel
    }

    emits('modelLoaded')
  }
  catch (error) {
    console.error('[Live2D] Failed to load model:', error)
    const requestIsCurrent = isCurrentLoadRequest(request, { app: targetApp, stage: targetStage })
    if (!shouldEmitLive2DLoadError(requestIsCurrent)) {
      console.warn('[Live2D] Suppressed stale load error:', error)
      return
    }

    emits('error', error instanceof Error ? error : new Error(String(error)))
  }
  finally {
    const finalizedState = finalizeLive2DLoadState({
      modelLoading: modelLoading.value,
      componentState: componentState.value,
    }, isUnmounted)
    modelLoading.value = finalizedState.modelLoading
    componentState.value = finalizedState.componentState
    await initExpressionController(internalModelRef.value).catch((err) => {
      console.warn('[Model.vue] Expression controller initialization failed:', err)
    })
  }
}

/**
 * Initialise the expression controller by reading expression definitions from
 * the model settings (model3.json) and parsing each referenced exp3.json file.
 *
 * This is intentionally fire-and-forget from loadModel so that a failure in
 * expression loading does not prevent the model itself from rendering.
 */
async function initExpressionController(internalModel?: PixiLive2DInternalModel) {
  // Dispose any previous state (handles model reloads)
  expressionController.dispose()

  const settings = internalModel?.settings as any
  if (!settings)
    return

  // model3.json stores expressions as { Name, File }[] under settings.expressions
  const expressionRefs: { Name: string, File: string }[] = settings.expressions ?? []
  if (expressionRefs.length === 0)
    return

  // Build a function that can read exp3 files relative to the model root.
  // For URL-loaded models, resolveURL gives us the full URL. For ZIP-loaded
  // models the resolved URL points to an in-memory blob/object URL.
  const readExpFile = async (filePath: string): Promise<string> => {
    const resolvedUrl: string = settings.resolveURL?.(filePath) ?? filePath
    const response = await fetch(resolvedUrl)
    if (!response.ok)
      throw new Error(`Failed to fetch exp3 file: ${filePath} (${response.status})`)
    return response.text()
  }

  await expressionController.initialise(expressionRefs, readExpFile)
}

async function setMotion(motionName: string, index?: number) {
  // TODO: motion? Not every Live2D model has motion, we do need to help users to set motion
  const currentModel = model.value
  if (!currentModel) {
    console.warn('Cannot set motion: model not loaded')
    return
  }

  const motionDefinitions = currentModel.internalModel.motionManager.definitions
  const resolvedRequest = resolveLive2DMotionRequest(
    compatibilityRuntime,
    motionName,
    index,
    motionDefinitions,
  )
  if (!resolvedRequest) {
    console.warn('Cannot resolve Live2D motion:', motionName)
    return
  }

  invalidateActiveSemanticMotion()
  const requestToken = semanticMotionToken

  const resolvedGroup = resolvedRequest.group
  const resolvedIndex = resolvedRequest.index
  console.info('Setting motion:', resolvedGroup, 'index:', resolvedIndex)

  // The model's motion metadata is authoritative for direct/manual playback,
  // but AIRI semantic emotions are transient actions. Temporarily disabling a
  // looping semantic motion lets the normal SDK finish path run, after which
  // the listener above hands the model back to the exact resolved idle motion.
  let loopLease: Live2DMotionLoopLease | undefined
  if (resolvedRequest.source === 'semantic') {
    pendingSemanticMotion = {
      token: requestToken,
      group: resolvedGroup,
      index: resolvedIndex,
    }
    let motion: Awaited<ReturnType<typeof currentModel.internalModel.motionManager.loadMotion>> | undefined
    try {
      motion = await currentModel.internalModel.motionManager.loadMotion(resolvedGroup, resolvedIndex)
    }
    catch (error) {
      if (pendingSemanticMotion?.token === requestToken)
        pendingSemanticMotion = undefined
      console.error('Failed to load semantic Live2D motion:', resolvedGroup, resolvedIndex, error)
      return
    }
    if (semanticMotionToken !== requestToken) {
      return
    }
    if (!motion) {
      if (pendingSemanticMotion?.token === requestToken)
        pendingSemanticMotion = undefined
      console.warn('Cannot load Live2D motion:', resolvedGroup, resolvedIndex)
      return
    }
    pendingSemanticMotion = undefined
    loopLease = acquireLive2DSemanticMotionLoopLease(motion)
    activeSemanticMotion = {
      token: requestToken,
      group: resolvedGroup,
      index: resolvedIndex,
      loopLease,
    }
  }

  try {
    if (semanticMotionToken !== requestToken) {
      loopLease?.restore()
      return
    }
    const started = await currentModel.motion(resolvedGroup, resolvedIndex, MotionPriority.FORCE)
    if (semanticMotionToken !== requestToken) {
      loopLease?.restore()
      return
    }
    if (!started) {
      loopLease?.restore()
      if (activeSemanticMotion?.token === requestToken)
        activeSemanticMotion = undefined
      return
    }
    console.info('Motion started successfully:', resolvedGroup)
  }
  catch (error) {
    loopLease?.restore()
    if (activeSemanticMotion?.token === requestToken)
      activeSemanticMotion = undefined
    console.error('Failed to start motion:', resolvedGroup, error)
  }
}

const dropShadowColorComputer = ref<HTMLDivElement>()
const dropShadowAnimationId = ref(0)

function updateDropShadowFilter() {
  if (!model.value)
    return

  if (!live2dShadowEnabled.value) {
    model.value.filters = []
    return
  }

  if (!dropShadowColorComputer.value)
    return

  const color = getComputedStyle(dropShadowColorComputer.value).backgroundColor
  dropShadowFilter.value.color = Number(formatHex(color)!.replace('#', '0x'))
  model.value.filters = [dropShadowFilter.value]
}

watch([modelSrcRef, () => props.modelId], async () => await loadModel(), { immediate: true })
watch(dark, updateDropShadowFilter, { immediate: true })
watch([model, themeColorsHue], updateDropShadowFilter)
watch(live2dShadowEnabled, updateDropShadowFilter)

// TODO: This is hacky!
function updateDropShadowFilterLoop() {
  updateDropShadowFilter()
  if (!live2dShadowEnabled.value) {
    dropShadowAnimationId.value = 0
    return
  }

  dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
}

watch([themeColorsHueDynamic, live2dShadowEnabled], ([dynamic, shadowEnabled]) => {
  if (dynamic && shadowEnabled) {
    dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
  }
  else {
    cancelAnimationFrame(dropShadowAnimationId.value)
    dropShadowAnimationId.value = 0
  }
}, { immediate: true })

watch(currentMotion, value => setMotion(value.group, value.index))
watch(paused, value => value ? pixiApp.value?.stop() : pixiApp.value?.start())

// Watch and apply model parameters
function setCurrentLogicalParameter(logical: Live2DLogicalParameter, value: number) {
  const coreModel = model.value?.internalModel.coreModel
  if (!coreModel)
    return
  compatibilityProfile.value?.setParameter(coreModel, logical, value)
}

function setCurrentPhysicalParameter(id: string, value: number) {
  const coreModel = model.value?.internalModel.coreModel
  if (!coreModel)
    return
  compatibilityProfile.value?.setPhysicalParameter(coreModel, id, value)
}

watch(() => modelParameters.value.angleX, (value) => {
  setCurrentLogicalParameter('angleX', value)
})

watch(() => modelParameters.value.angleY, (value) => {
  setCurrentLogicalParameter('angleY', value)
})

watch(() => modelParameters.value.angleZ, (value) => {
  setCurrentLogicalParameter('angleZ', value)
})

watch(() => modelParameters.value.leftEyeOpen, (value) => {
  setCurrentLogicalParameter('eyeLeftOpen', value)
})

watch(() => modelParameters.value.rightEyeOpen, (value) => {
  setCurrentLogicalParameter('eyeRightOpen', value)
})

watch(() => modelParameters.value.mouthOpen, (value) => {
  setCurrentLogicalParameter('mouthOpen', value)
})

watch(() => modelParameters.value.mouthForm, (value) => {
  setCurrentLogicalParameter('mouthForm', value)
})

watch(() => modelParameters.value.cheek, (value) => {
  setCurrentPhysicalParameter('ParamCheek', value)
})

watch(() => modelParameters.value.bodyAngleX, (value) => {
  setCurrentLogicalParameter('bodyAngleX', value)
})

watch(() => modelParameters.value.bodyAngleY, (value) => {
  setCurrentLogicalParameter('bodyAngleY', value)
})

watch(() => modelParameters.value.bodyAngleZ, (value) => {
  setCurrentLogicalParameter('bodyAngleZ', value)
})

watch(() => modelParameters.value.breath, (value) => {
  setCurrentLogicalParameter('breath', value)
})

// Watch eyebrow parameters
watch(() => modelParameters.value.leftEyebrowLR, (value) => {
  setCurrentPhysicalParameter('ParamBrowLX', value)
})

watch(() => modelParameters.value.rightEyebrowLR, (value) => {
  setCurrentPhysicalParameter('ParamBrowRX', value)
})

watch(() => modelParameters.value.leftEyebrowY, (value) => {
  setCurrentPhysicalParameter('ParamBrowLY', value)
})

watch(() => modelParameters.value.rightEyebrowY, (value) => {
  setCurrentPhysicalParameter('ParamBrowRY', value)
})

watch(() => modelParameters.value.leftEyebrowAngle, (value) => {
  setCurrentPhysicalParameter('ParamBrowLAngle', value)
})

watch(() => modelParameters.value.rightEyebrowAngle, (value) => {
  setCurrentPhysicalParameter('ParamBrowRAngle', value)
})

watch(() => modelParameters.value.leftEyebrowForm, (value) => {
  setCurrentPhysicalParameter('ParamBrowLForm', value)
})

watch(() => modelParameters.value.rightEyebrowForm, (value) => {
  setCurrentPhysicalParameter('ParamBrowRForm', value)
})

// Watch for idle animation setting changes and stop motions if disabled
watch(live2dIdleAnimationEnabled, (enabled) => {
  if (!enabled && model.value) {
    const internalModel = model.value.internalModel
    if (internalModel?.motionManager) {
      internalModel.motionManager.stopAllMotions()
    }
  }
})

// Watch for expression system toggle — nullify/restore SDK managers at runtime
watch(live2dExpressionEnabled, (enabled) => {
  if (!model.value)
    return
  const im = model.value.internalModel
  const mm = im.motionManager
  if (enabled) {
    if (mm.expressionManager) {
      (mm as any).expressionManager = null
    }
    if (im.eyeBlink) {
      (im as any).eyeBlink = null
    }

    internalModelRef.value = im
    initExpressionController(im).catch((err) => {
      console.warn('[Model.vue] Expression controller initialisation failed:', err)
    })
  }
  else {
    mm.expressionManager = savedExpressionManager.value
    im.eyeBlink = savedEyeBlink.value
    expressionController.dispose()
    internalModelRef.value = undefined
  }
})

watch(focusAt, (value) => {
  if (!model.value)
    return
  if (!props.eyeTracking)
    return

  model.value.focus(value.x, value.y)
})

onMounted(() => {
  const removeListener = listenBeatSyncBeatSignal(() => beatSync.scheduleBeat())
  onUnmounted(() => removeListener())
})

onMounted(async () => {
  updateDropShadowFilter()
})

onUnmounted(() => {
  isUnmounted = true
  loadOwnership.invalidate()
  invalidateActiveSemanticMotion()
  resizeAnimation?.pause()
  disposeShouldUpdateView?.()
  disposeMotionMappingChanged?.()
  expressionController.dispose()
  compatibilityProfile.value = undefined
})

function listMotionGroups() {
  return availableMotions.value
}

defineExpose({
  setMotion,
  listMotionGroups,
  modelNormalizeParams,
  initialModelHeight,
  initialModelWidth,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <div ref="dropShadowColorComputer" hidden bg="primary-400 dark:primary-500" />
  <slot />
</template>
