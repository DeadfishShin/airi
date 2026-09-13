import type { Cubism4InternalModel, InternalModel } from 'pixi-live2d-display/cubism4'
import type { Ref } from 'vue'

import type { Live2DBreathControlState, Live2DMotionControlState } from '../../stores/motion-control'
import type { Live2DCompatibilityProfile, Live2DFocusParameterTarget, Live2DLogicalParameter } from '../../utils/live2d-compatibility'
import type { BeatSyncController } from './beat-sync'
import type { useExpressionController } from './expression-controller'
import type { Live2DMotionSpringController } from './motion-control-spring'

import { sampleLive2DBreath } from '../../stores/motion-control'
import { useLive2DIdleEyeFocus } from './animation'

type CubismModel = Cubism4InternalModel['coreModel']
type CubismEyeBlink = Cubism4InternalModel['eyeBlink']

/** The Pixi internal-model surface that AIRI motion plugins consume. */
export type PixiLive2DInternalModel = InternalModel & Live2DFocusParameterTarget & {
  /** Cubism's breath controller, which AIRI removes before it applies its own curve. */
  breath?: unknown
  eyeBlink?: CubismEyeBlink
  coreModel: CubismModel
}

export interface MotionManagerUpdateContext {
  model: CubismModel
  // in seconds
  now: number
  // in seconds
  timeDelta: number
  hookedUpdate?: (model: CubismModel, now: number) => boolean
}

export type MotionManagerPluginContext = MotionManagerUpdateContext & {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  compatibility?: Live2DCompatibilityProfile
  modelParameters: Ref<any>
  live2dEyeTrackingEnabled: Ref<boolean>
  live2dEyeFocusSourceActive: Ref<boolean>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dForceIdleEyeAnimation: Ref<boolean>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  isIdleMotion: boolean
  handled: boolean
  markHandled: () => void
}

export type MotionManagerPlugin = (ctx: MotionManagerPluginContext) => void

export interface UseLive2DMotionManagerUpdateOptions {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  compatibility?: Live2DCompatibilityProfile
  modelParameters: Ref<any>
  live2dEyeTrackingEnabled: Ref<boolean>
  live2dEyeFocusSourceActive: Ref<boolean>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dForceIdleEyeAnimation: Ref<boolean>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  lastUpdateTime: Ref<number>
}

/**
 * Disables the periodic breath pass that the Cubism runtime applies after AIRI's motion plugins.
 */
export function disableLive2DSdkBreath(internalModel: { breath?: unknown }) {
  delete internalModel.breath
}

export function isLive2DIdleMotion(options: {
  currentGroup?: string
  currentIndex?: number
  canonicalIdleGroup?: string
  selectedMotion?: { group: string, index?: number }
  compatibilityIdle?: { group: string, index: number }
}): boolean {
  const { currentGroup, currentIndex, canonicalIdleGroup, selectedMotion, compatibilityIdle } = options
  if (currentGroup === undefined)
    return true
  if (canonicalIdleGroup && currentGroup === canonicalIdleGroup)
    return true

  const selectedMatches = selectedMotion
    && currentGroup === selectedMotion.group
    && (selectedMotion.index === undefined || currentIndex === selectedMotion.index)
  if (selectedMatches)
    return true

  return Boolean(
    compatibilityIdle
    && currentGroup === compatibilityIdle.group
    && currentIndex === compatibilityIdle.index,
  )
}

function setLogicalParameter(
  ctx: MotionManagerPluginContext,
  logical: Live2DLogicalParameter,
  modernId: string,
  value: number,
): boolean {
  if (ctx.compatibility)
    return ctx.compatibility.setParameter(ctx.model, logical, value)
  ctx.model.setParameterValueById(modernId, value)
  return true
}

function getLogicalParameter(
  ctx: MotionManagerPluginContext,
  logical: Live2DLogicalParameter,
  modernId: string,
  fallback = 0,
): number {
  if (ctx.compatibility)
    return ctx.compatibility.getParameter(ctx.model, logical, fallback)
  return ctx.model.getParameterValueById(modernId) as number
}

/**
 * Applies AIRI's manual breath curve after normal motion updates.
 *
 * A release restores the configured static breath value once. Normal model
 * motion can own the parameter again on later frames.
 */
export function useMotionUpdatePluginBreathControl(
  control: Ref<Live2DBreathControlState>,
  nowMs: () => number = Date.now,
): MotionManagerPlugin {
  let activeOwnerId: string | null = null

  return (ctx) => {
    const state = control.value
    if (!state.active) {
      if (activeOwnerId !== null)
        setLogicalParameter(ctx, 'breath', 'ParamBreath', ctx.modelParameters.value.breath)
      activeOwnerId = null
      return
    }

    activeOwnerId = state.ownerId
    const elapsedSeconds = Math.max(0, nowMs() - state.startedAtMs) / 1000
    const sample = sampleLive2DBreath(state.options, elapsedSeconds)
    setLogicalParameter(ctx, 'breath', 'ParamBreath', sample.value)
  }
}

export function useLive2DMotionManagerUpdate(options: UseLive2DMotionManagerUpdateOptions) {
  const {
    internalModel,
    motionManager,
    compatibility,
    modelParameters,
    live2dEyeTrackingEnabled,
    live2dEyeFocusSourceActive,
    live2dIdleAnimationEnabled,
    live2dForceIdleEyeAnimation,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    lastUpdateTime,
  } = options

  const prePlugins: MotionManagerPlugin[] = []
  const postPlugins: MotionManagerPlugin[] = []
  const finalPlugins: MotionManagerPlugin[] = []

  function register(plugin: MotionManagerPlugin, stage: 'pre' | 'post' | 'final' = 'pre') {
    if (stage === 'pre')
      prePlugins.push(plugin)
    else if (stage === 'final')
      finalPlugins.push(plugin)
    else
      postPlugins.push(plugin)
  }

  function runPlugins(plugins: MotionManagerPlugin[], ctx: MotionManagerPluginContext) {
    for (const plugin of plugins) {
      if (ctx.handled)
        break
      plugin(ctx)
    }
  }

  function hookUpdate(model: CubismModel, now: number, hookedUpdate?: (model: CubismModel, now: number) => boolean) {
    const timeDelta = lastUpdateTime.value ? now - lastUpdateTime.value : 0
    const selectedMotionGroup = localStorage.getItem('selected-runtime-motion-group')
    const selectedMotionIndex = localStorage.getItem('selected-runtime-motion-index')
    const selectedMotion = selectedMotionGroup === null
      ? undefined
      : {
          group: selectedMotionGroup,
          index: selectedMotionIndex === null ? undefined : Number.parseInt(selectedMotionIndex),
        }
    const isIdleMotion = isLive2DIdleMotion({
      currentGroup: motionManager.state.currentGroup,
      currentIndex: motionManager.state.currentIndex,
      canonicalIdleGroup: motionManager.groups.idle,
      selectedMotion,
      compatibilityIdle: compatibility?.motionMap.idle,
    })

    const ctx: MotionManagerPluginContext = {
      model,
      now,
      timeDelta,
      hookedUpdate,
      internalModel,
      motionManager,
      compatibility,
      modelParameters,
      live2dEyeTrackingEnabled,
      live2dEyeFocusSourceActive,
      live2dIdleAnimationEnabled,
      live2dForceIdleEyeAnimation,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      isIdleMotion,
      handled: false,
      markHandled: () => {
        ctx.handled = true
      },
    }

    runPlugins(prePlugins, ctx)

    if (!ctx.handled && ctx.hookedUpdate) {
      const result = ctx.hookedUpdate.call(motionManager, model, now)
      if (result)
        ctx.handled = true
    }

    runPlugins(postPlugins, ctx)

    // Final plugins always run regardless of handled state (e.g. expression overrides)
    for (const plugin of finalPlugins) {
      plugin(ctx)
    }

    lastUpdateTime.value = now
    return ctx.handled
  }

  return {
    register,
    hookUpdate,
  }
}

// -- Plugins ---------------------------------------------------------------

export function useMotionUpdatePluginBeatSync(beatSync: BeatSyncController): MotionManagerPlugin {
  return (ctx) => {
    beatSync.updateTargets(ctx.now)

    // Semi-implicit Euler approach
    const stiffness = 120 // Higher -> Snappier
    const damping = 16 // Higher -> Less bounce
    const mass = 1

    let paramAngleX = getLogicalParameter(ctx, 'angleX', 'ParamAngleX')
    let paramAngleY = getLogicalParameter(ctx, 'angleY', 'ParamAngleY')
    let paramAngleZ = getLogicalParameter(ctx, 'angleZ', 'ParamAngleZ')

    // X
    {
      const target = beatSync.targetX.value
      const pos = paramAngleX
      const vel = beatSync.velocityX.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityX.value = vel + accel * ctx.timeDelta
      paramAngleX = pos + beatSync.velocityX.value * ctx.timeDelta

      if (Math.abs(target - paramAngleX) < 0.01 && Math.abs(beatSync.velocityX.value) < 0.01) {
        paramAngleX = target
        beatSync.velocityX.value = 0
      }
    }

    // Y
    {
      const target = beatSync.targetY.value
      const pos = paramAngleY
      const vel = beatSync.velocityY.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityY.value = vel + accel * ctx.timeDelta
      paramAngleY = pos + beatSync.velocityY.value * ctx.timeDelta

      // Snap
      if (Math.abs(target - paramAngleY) < 0.01 && Math.abs(beatSync.velocityY.value) < 0.01) {
        paramAngleY = target
        beatSync.velocityY.value = 0
      }
    }

    // Z
    {
      const target = beatSync.targetZ.value
      const pos = paramAngleZ
      const vel = beatSync.velocityZ.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityZ.value = vel + accel * ctx.timeDelta
      paramAngleZ = pos + beatSync.velocityZ.value * ctx.timeDelta

      // Snap
      if (Math.abs(target - paramAngleZ) < 0.01 && Math.abs(beatSync.velocityZ.value) < 0.01) {
        paramAngleZ = target
        beatSync.velocityZ.value = 0
      }
    }

    setLogicalParameter(ctx, 'angleX', 'ParamAngleX', paramAngleX)
    setLogicalParameter(ctx, 'angleY', 'ParamAngleY', paramAngleY)
    setLogicalParameter(ctx, 'angleZ', 'ParamAngleZ', paramAngleZ)
  }
}

export function useMotionUpdatePluginIdleDisable(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (ctx.handled)
      return

    // Stop idle motions if they're disabled
    if (!ctx.live2dIdleAnimationEnabled.value && ctx.isIdleMotion) {
      ctx.motionManager.stopAllMotions()

      if (ctx.live2dForceIdleEyeAnimation.value && (!ctx.live2dEyeTrackingEnabled.value || !ctx.live2dEyeFocusSourceActive.value))
        idleEyeFocus.update(ctx.internalModel, ctx.now)
      if (ctx.internalModel.eyeBlink != null) {
        ctx.internalModel.eyeBlink.updateParameters(ctx.model, ctx.timeDelta / 1000)
      }

      // Apply manual eye parameters after auto eye blink
      setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', ctx.modelParameters.value.leftEyeOpen)
      setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', ctx.modelParameters.value.rightEyeOpen)

      ctx.markHandled()
    }
  }
}

export function useMotionUpdatePluginIdleFocus(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (!ctx.isIdleMotion || ctx.handled)
      return
    if (!ctx.live2dForceIdleEyeAnimation.value)
      return
    if (ctx.live2dEyeTrackingEnabled.value && ctx.live2dEyeFocusSourceActive.value)
      return

    idleEyeFocus.update(ctx.internalModel, ctx.now)
  }
}

export function useMotionUpdatePluginAutoEyeBlink(
  live2dExpressionEnabled?: Ref<boolean>,
): MotionManagerPlugin {
  const blinkState = {
    phase: 'idle' as 'idle' | 'closing' | 'opening',
    progress: 0,
    startLeft: 1,
    startRight: 1,
    delayMs: 0,
    openDurationMs: 300,
  }

  // Eye values captured at blink start.  Used as the base during
  // closing/opening so that models without eye motion curves don't
  // get stuck at 0 (since 0 × factor = 0 forever).
  let preBlinkLeft = 1.0
  let preBlinkRight = 1.0
  const blinkCloseDuration = 75 // ms
  const minBlinkOpenDuration = 150 // ms
  const maxBlinkOpenDuration = 300 // ms
  const minDelay = 3000
  const maxDelay = 8000

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
  const randomBlinkOpenDuration = () => minBlinkOpenDuration + Math.random() * (maxBlinkOpenDuration - minBlinkOpenDuration)

  function resetBlinkState() {
    blinkState.phase = 'idle'
    blinkState.progress = 0
    blinkState.delayMs = minDelay + Math.random() * (maxDelay - minDelay)
  }
  resetBlinkState()

  function easeOutQuad(t: number) {
    return 1 - (1 - t) * (1 - t)
  }
  function easeInQuad(t: number) {
    return t * t
  }

  function updateForcedBlink(dt: number, baseLeft: number, baseRight: number) {
    // Idle: count down delay to next blink.
    if (blinkState.phase === 'idle') {
      blinkState.delayMs = Math.max(0, blinkState.delayMs - dt)
      if (blinkState.delayMs === 0) {
        blinkState.phase = 'closing'
        blinkState.progress = 0
        blinkState.startLeft = baseLeft
        blinkState.startRight = baseRight
      }

      return { eyeLOpen: baseLeft, eyeROpen: baseRight }
    }

    // Closing: move toward zero with ease-out.
    if (blinkState.phase === 'closing') {
      blinkState.progress = Math.min(1, blinkState.progress + dt / blinkCloseDuration)
      const eased = easeOutQuad(blinkState.progress)
      const eyeLOpen = clamp01(blinkState.startLeft * (1 - eased))
      const eyeROpen = clamp01(blinkState.startRight * (1 - eased))

      if (blinkState.progress >= 1) {
        blinkState.phase = 'opening'
        blinkState.progress = 0
        blinkState.openDurationMs = randomBlinkOpenDuration()
      }

      return { eyeLOpen, eyeROpen }
    }

    // Opening: move back to the base with ease-in.
    blinkState.progress = Math.min(1, blinkState.progress + dt / blinkState.openDurationMs)
    const eased = easeInQuad(blinkState.progress)
    const eyeLOpen = clamp01(blinkState.startLeft * eased)
    const eyeROpen = clamp01(blinkState.startRight * eased)

    if (blinkState.progress >= 1) {
      resetBlinkState()
    }

    return { eyeLOpen, eyeROpen }
  }

  return (ctx) => {
    // ===== EXPRESSION OFF: MAIN-IDENTICAL BEHAVIOR =====
    // When the expression system is disabled, replicate the exact auto-blink
    // logic from main so that hookUpdate returns the same handled state and
    // the SDK eyeBlink/motion pipeline is not disrupted.
    if (!live2dExpressionEnabled?.value) {
      if (!ctx.isIdleMotion || (ctx.handled && !ctx.live2dForceAutoBlinkEnabled.value))
        return

      const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
      const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

      // Auto-blink OFF: absolute write + markHandled (same as main).
      if (!ctx.live2dAutoBlinkEnabled.value) {
        resetBlinkState()
        setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', baseLeft)
        setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', baseRight)
        ctx.markHandled()
        return
      }

      // Force ON or eyeBlink null: timer blink + markHandled.
      if (ctx.live2dForceAutoBlinkEnabled.value || !ctx.internalModel.eyeBlink) {
        const safeDt = ctx.timeDelta * 1000 || 16
        const { eyeLOpen, eyeROpen } = updateForcedBlink(safeDt, baseLeft, baseRight)
        setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', eyeLOpen)
        setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', eyeROpen)
        ctx.markHandled()
        return
      }

      // SDK eyeBlink path: explicit call → read back → multiply by base → markHandled.
      ctx.internalModel.eyeBlink!.updateParameters(ctx.model, ctx.timeDelta / 1000)
      const blinkLeft = getLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', baseLeft)
      const blinkRight = getLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', baseRight)
      setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', clamp01(blinkLeft * baseLeft))
      setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', clamp01(blinkRight * baseRight))
      ctx.markHandled()
      return
    }

    // ===== EXPRESSION ON: MULTIPLY-MODULATE BEHAVIOR =====
    // Run during idle motion only (non-idle motions control eyes via curves).
    if (!ctx.isIdleMotion)
      return

    const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
    const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

    // Auto-blink OFF: apply manual base values only (multiply with current).
    if (!ctx.live2dAutoBlinkEnabled.value) {
      resetBlinkState()
      const currentLeft = getLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', baseLeft)
      const currentRight = getLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', baseRight)
      setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', clamp01(currentLeft * baseLeft))
      setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', clamp01(currentRight * baseRight))
      return
    }

    // Force OFF and SDK eyeBlink alive: should not happen when expression ON
    // (eyeBlink is nullified), but guard defensively — just apply multiplier.
    if (!ctx.live2dForceAutoBlinkEnabled.value && ctx.internalModel.eyeBlink != null) {
      resetBlinkState()
      const currentLeft = getLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', baseLeft)
      const currentRight = getLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', baseRight)
      setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', clamp01(currentLeft * baseLeft))
      setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', clamp01(currentRight * baseRight))
      return
    }

    // --- Force Auto Blink: stateful blink for models without idle blink curves ---

    const currentLeft = getLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', baseLeft)
    const currentRight = getLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', baseRight)

    // Skip blink when eyes are already nearly/fully closed (e.g. by expression).
    const BLINK_THRESHOLD = 0.15
    if (blinkState.phase === 'idle' && currentLeft <= BLINK_THRESHOLD && currentRight <= BLINK_THRESHOLD) {
      resetBlinkState()
      return
    }

    // Track post-expression eye values during idle as the blink baseline.
    if (blinkState.phase === 'idle') {
      preBlinkLeft = currentLeft
      preBlinkRight = currentRight
    }

    // Advance blink timer.
    const wasActive = blinkState.phase !== 'idle'
    const safeDt = ctx.timeDelta * 1000 || 16
    const { eyeLOpen: blinkFactorL, eyeROpen: blinkFactorR } = updateForcedBlink(safeDt, 1.0, 1.0)

    // Blink cycle complete: restore exact pre-blink values.
    if (wasActive && blinkState.phase === 'idle') {
      setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', clamp01(preBlinkLeft * baseLeft))
      setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', clamp01(preBlinkRight * baseRight))
      return
    }

    // Idle: don't write (avoids feedback-loop decay).
    if (blinkState.phase === 'idle')
      return

    // Active blink: saved pre-blink values × blinkFactor.
    setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', clamp01(preBlinkLeft * blinkFactorL * baseLeft))
    setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', clamp01(preBlinkRight * blinkFactorR * baseRight))
  }
}

/**
 * Post-plugin that applies expression parameter overrides from the expression
 * store onto the Live2D model every frame.
 *
 * This plugin intentionally ignores `ctx.handled` so that expression values
 * are always applied on top of whatever the motion / blink plugins produced.
 * It also does NOT call `ctx.markHandled()` so it never blocks other plugins.
 */
export function useMotionUpdatePluginExpression(
  controller: ReturnType<typeof useExpressionController>,
): MotionManagerPlugin {
  return (ctx) => {
    // Always apply regardless of handled state – expressions layer on top.
    controller.applyExpressions(ctx.model)
  }
}

/**
 * Applies the active manual pose after normal Live2D motion updates.
 *
 * The normalized joystick range maps to each standard parameter range. Models
 * that omit one of these parameters ignore that write through the Cubism API.
 */
export function useMotionUpdatePluginManualControl(
  control: Ref<Live2DMotionControlState>,
  spring: Live2DMotionSpringController,
): MotionManagerPlugin {
  return (ctx) => {
    const output = spring.step(control.value, ctx.timeDelta)
    if (!output.active)
      return

    const { eyeX, eyeY, eyeSquint, headX, headY, headZ, bodyX, bodyY, bodyZ, mouthForm, mouthOpen } = output.pose
    setLogicalParameter(ctx, 'eyeBallX', 'ParamEyeBallX', eyeX)
    setLogicalParameter(ctx, 'eyeBallY', 'ParamEyeBallY', eyeY)
    const remainingEyeOpen = 1 - eyeSquint
    setLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', getLogicalParameter(ctx, 'eyeLeftOpen', 'ParamEyeLOpen', 1) * remainingEyeOpen)
    setLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', getLogicalParameter(ctx, 'eyeRightOpen', 'ParamEyeROpen', 1) * remainingEyeOpen)
    setLogicalParameter(ctx, 'angleX', 'ParamAngleX', headX * 30)
    setLogicalParameter(ctx, 'angleY', 'ParamAngleY', headY * 30)
    setLogicalParameter(ctx, 'angleZ', 'ParamAngleZ', headZ * 30)
    setLogicalParameter(ctx, 'bodyAngleX', 'ParamBodyAngleX', bodyX * 10)
    setLogicalParameter(ctx, 'bodyAngleY', 'ParamBodyAngleY', bodyY * 10)
    setLogicalParameter(ctx, 'bodyAngleZ', 'ParamBodyAngleZ', bodyZ * 10)
    setLogicalParameter(ctx, 'mouthForm', 'ParamMouthForm', mouthForm)
    setLogicalParameter(ctx, 'mouthOpen', 'ParamMouthOpenY', mouthOpen)
  }
}

/**
 * Final-phase plugin that owns ParamMouthOpenY while speech is active and
 * smoothly cross-fades back to the motion-driven value when speech ends.
 *
 * `nowSpeaking` (not `mouthOpenSize > 0`) is the speech boundary, so silent
 * gaps between phonemes write 0 directly instead of triggering the release.
 *
 * After the release tail elapses, the plugin keeps forcing ParamMouthOpenY to 0
 * for a short handoff hold (HANDOFF_HOLD_MS) before handing control back to
 * motion/expression plugins. This reliably closes the mouth after speech even
 * when an idle motion curve leaves a non-zero resting value, while still
 * letting idle mouth expressions take over shortly after speech ends (rather
 * than overriding them forever).
 */
export function useMotionUpdatePluginLipSync(
  mouthOpenSize: Ref<number>,
  nowSpeaking: Ref<boolean>,
): MotionManagerPlugin {
  // 200 ms covers a typical phoneme tail without lagging behind the next utterance.
  const RELEASE_DURATION_MS = 200
  // After the release tail, keep forcing the mouth shut for this long before
  // handing control back to motion/expression plugins. This guarantees the
  // mouth actually closes even on the first idle frame, where a non-zero
  // resting motion curve would otherwise reopen it immediately.
  const HANDOFF_HOLD_MS = 500

  let releaseRemainingMs = 0
  let handoffRemainingMs = 0
  let lastForcedValue = 0

  // Smoothstep: 3t^2 - 2t^3, eases in/out with zero slope at endpoints.
  const smoothstep = (t: number) => t * t * (3 - 2 * t)

  return (ctx) => {
    if (nowSpeaking.value) {
      lastForcedValue = mouthOpenSize.value
      releaseRemainingMs = RELEASE_DURATION_MS
      handoffRemainingMs = HANDOFF_HOLD_MS
      setLogicalParameter(ctx, 'mouthOpen', 'ParamMouthOpenY', mouthOpenSize.value)
      return
    }

    if (releaseRemainingMs <= 0) {
      if (handoffRemainingMs > 0) {
        // Release tail elapsed. Keep forcing the mouth shut through the handoff
        // hold so a non-zero idle motion curve cannot reopen it on the first
        // idle frame. After the hold we stop owning the parameter and let
        // motion/expression plugins drive it again.
        handoffRemainingMs = Math.max(0, handoffRemainingMs - ctx.timeDelta * 1000)
        setLogicalParameter(ctx, 'mouthOpen', 'ParamMouthOpenY', 0)
      }
      return
    }

    releaseRemainingMs = Math.max(0, releaseRemainingMs - ctx.timeDelta * 1000)
    const blend = smoothstep(1 - releaseRemainingMs / RELEASE_DURATION_MS)

    // ParamMouthOpenY was already written by motion + expression plugins this frame.
    const motionValue = getLogicalParameter(ctx, 'mouthOpen', 'ParamMouthOpenY')
    const blended = lastForcedValue * (1 - blend) + motionValue * blend

    setLogicalParameter(ctx, 'mouthOpen', 'ParamMouthOpenY', blended)
  }
}
