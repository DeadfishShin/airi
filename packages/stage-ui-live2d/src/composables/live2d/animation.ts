import type { InternalModel } from 'pixi-live2d-display/cubism4'

import type { Live2DCompatibilityProfile, Live2DCoreModelParameterTarget } from '../../utils/live2d-compatibility'

import { MathUtils } from 'three'

import { randomSaccadeInterval } from '../../utils'

/**
 * This is to simulate idle eye saccades and focus (head) movements in a *pretty* naive way.
 * Not using any reactivity here as it's not yet needed.
 * Keeping it here as a composable for future extension.
 */
export function useLive2DIdleEyeFocus(compatibility?: Live2DCompatibilityProfile) {
  let nextSaccadeAfter = -1
  let focusTarget: [number, number] | undefined
  let lastSaccadeAt = -1

  // Function to handle idle eye saccades and focus (head) movements
  function update(model: InternalModel, now: number) {
    if (now >= nextSaccadeAfter || now < lastSaccadeAt) {
      focusTarget = [MathUtils.randFloat(-1, 1), MathUtils.randFloat(-1, 0.7)]
      lastSaccadeAt = now
      nextSaccadeAfter = now + (randomSaccadeInterval() / 1000)
      model.focusController.focus(focusTarget![0] * 0.5, focusTarget![1] * 0.5, false)
    }

    model.focusController.update(now - lastSaccadeAt)
    const coreModel = model.coreModel as unknown as Live2DCoreModelParameterTarget
    const currentX = compatibility?.getParameter(coreModel, 'eyeBallX', 0)
      ?? coreModel.getParameterValueById('ParamEyeBallX')
    const currentY = compatibility?.getParameter(coreModel, 'eyeBallY', 0)
      ?? coreModel.getParameterValueById('ParamEyeBallY')
    if (compatibility) {
      compatibility.setParameter(coreModel, 'eyeBallX', MathUtils.lerp(currentX, focusTarget![0], 0.3))
      compatibility.setParameter(coreModel, 'eyeBallY', MathUtils.lerp(currentY, focusTarget![1], 0.3))
    }
    else {
      coreModel.setParameterValueById('ParamEyeBallX', MathUtils.lerp(currentX, focusTarget![0], 0.3))
      coreModel.setParameterValueById('ParamEyeBallY', MathUtils.lerp(currentY, focusTarget![1], 0.3))
    }
  }

  return { update }
}
