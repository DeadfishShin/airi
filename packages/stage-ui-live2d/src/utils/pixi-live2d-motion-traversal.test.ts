import type { CubismSpec } from 'pixi-live2d-display/cubism4'

import { describe, expect, it } from 'vitest'

Object.assign(globalThis, { window: { Live2DCubismCore: {} } })
interface MotionModel {
  getParameterIndex: (id: string) => number
  getParameterValueByIndex: (index: number) => number
  setParameterValueByIndex: (index: number, value: number, weight?: number) => void
  getParameterValueById: (id: string) => number
  setParameterValueById: (id: string, value: number, weight?: number) => void
  setPartOpacityById: (id: string, value: number) => void
}

interface MotionQueueEntry {
  getStartTime: () => number
  getFadeInStartTime: () => number
  getEndTime: () => number
}

interface RuntimeMotion {
  doUpdateParameters: (model: MotionModel, userTimeSeconds: number, weight: number, motionQueueEntry: MotionQueueEntry) => void
}

const { CubismConfig, CubismMotion, CubismMotionCurveTarget } = await import('pixi-live2d-display/cubism4') as unknown as {
  CubismConfig: { setOpacityFromMotion: boolean }
  CubismMotion: { create: (json: CubismSpec.MotionJSON) => RuntimeMotion }
  CubismMotionCurveTarget: {
    CubismMotionCurveTarget_Model: number
    CubismMotionCurveTarget_Parameter: number
    CubismMotionCurveTarget_PartOpacity: number
  }
}

interface CurveSpec {
  target: 'Model' | 'Parameter' | 'PartOpacity'
  id: string
  value: number
}

interface ParameterCall {
  id: string
  index: number
  value: number
  weight?: number
}

function makeMotionJson(curves: CurveSpec[]): CubismSpec.MotionJSON {
  return {
    Version: 3,
    Meta: {
      Duration: 1,
      Fps: 30,
      Loop: false,
      FadeInTime: 0,
      FadeOutTime: 0,
      CurveCount: curves.length,
      TotalSegmentCount: curves.length,
      TotalPointCount: curves.length * 2,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves.map(curve => ({
      Target: curve.target,
      Id: curve.id,
      Segments: [0, curve.value, 0, 1, curve.value],
    })),
  }
}

function createMotionModel(parameterValues: Record<string, number>) {
  const parameterIds = Object.keys(parameterValues)
  const values = parameterIds.map(id => parameterValues[id])
  const parameterCalls: ParameterCall[] = []
  const partOpacities = new Map<string, number>()

  const model = {
    getParameterIndex(id: string) {
      return parameterIds.indexOf(id)
    },
    getParameterValueByIndex(index: number) {
      return values[index]
    },
    setParameterValueByIndex(index: number, value: number, weight?: number) {
      values[index] = value
      parameterCalls.push({ id: parameterIds[index], index, value, weight })
    },
    getParameterValueById(id: string) {
      const index = parameterIds.indexOf(id)
      return index === -1 ? 0 : values[index]
    },
    setParameterValueById(id: string, value: number, weight?: number) {
      const index = parameterIds.indexOf(id)
      if (index !== -1) {
        values[index] = value
        parameterCalls.push({ id, index, value, weight })
      }
    },
    setPartOpacityById(id: string, value: number) {
      partOpacities.set(id, value)
    },
  } as MotionModel

  return {
    model,
    parameterCalls,
    partOpacities,
    value(id: string) {
      return values[parameterIds.indexOf(id)]
    },
  }
}

function createQueueEntry(): MotionQueueEntry {
  return {
    getStartTime: () => 0,
    getFadeInStartTime: () => 0,
    getEndTime: () => -1,
  } as MotionQueueEntry
}

function updateMotion(curves: CurveSpec[], initialValues: Record<string, number>) {
  const motion = CubismMotion.create(makeMotionJson(curves))
  const runtimeModel = createMotionModel(initialValues)
  const previousOpacityMode = CubismConfig.setOpacityFromMotion
  CubismConfig.setOpacityFromMotion = true
  try {
    motion.doUpdateParameters(runtimeModel.model, 0.5, 1, createQueueEntry())
  }
  finally {
    CubismConfig.setOpacityFromMotion = previousOpacityMode
  }
  return { motion, ...runtimeModel }
}

describe('cubism motion curve traversal compatibility', () => {
  it('visits parameter curves after interleaved model and part-opacity curves', () => {
    const result = updateMotion([
      { target: 'Parameter', id: 'ParamA', value: 1 },
      { target: 'Model', id: 'Opacity', value: 0.5 },
      { target: 'Parameter', id: 'ParamB', value: 2 },
      { target: 'PartOpacity', id: 'PartA', value: 0.25 },
      { target: 'Parameter', id: 'ParamC', value: 0 },
    ], { ParamA: 0, ParamB: 0, ParamC: 5 })

    expect(result.parameterCalls.map(call => call.id)).toEqual(['ParamA', 'ParamB', 'ParamC'])
    expect(result.parameterCalls.map(call => call.value)).toEqual([1, 2, 0])
    expect(result.partOpacities.get('PartA')).toBe(0.25)
  })

  it('commits a zero target instead of treating it as an absent value', () => {
    const result = updateMotion([
      { target: 'Parameter', id: 'ParamSmile', value: 0 },
    ], { ParamSmile: 1 })

    expect(result.parameterCalls).toEqual([{ id: 'ParamSmile', index: 0, value: 0, weight: 1 }])
    expect(result.value('ParamSmile')).toBe(0)
  })

  it('handles Aqua-shaped face curves separated by a model curve', () => {
    const result = updateMotion([
      { target: 'Parameter', id: 'PARAM_EYE_R_SMILE', value: -1 },
      { target: 'Parameter', id: 'PARAM_EYE_L_SMILE', value: -1 },
      { target: 'Model', id: 'Opacity', value: 1 },
      { target: 'Parameter', id: 'PARAM_EYE_FORM', value: 0 },
      { target: 'PartOpacity', id: 'PART_EYE', value: 1 },
    ], {
      PARAM_EYE_R_SMILE: 2,
      PARAM_EYE_L_SMILE: 2,
      PARAM_EYE_FORM: 1,
    })

    expect(result.parameterCalls.map(call => call.id)).toEqual([
      'PARAM_EYE_R_SMILE',
      'PARAM_EYE_L_SMILE',
      'PARAM_EYE_FORM',
    ])
    expect(result.value('PARAM_EYE_R_SMILE')).toBe(-1)
    expect(result.value('PARAM_EYE_L_SMILE')).toBe(-1)
    expect(result.value('PARAM_EYE_FORM')).toBe(0)
  })

  it('preserves canonical model, parameter, and part-opacity traversal', () => {
    const result = updateMotion([
      { target: 'Model', id: 'EyeBlink', value: 1 },
      { target: 'Parameter', id: 'ParamA', value: 0.75 },
      { target: 'Parameter', id: 'ParamB', value: 0.25 },
      { target: 'PartOpacity', id: 'PartA', value: 0.5 },
    ], { ParamA: 0, ParamB: 0 })

    expect(result.parameterCalls.map(call => call.id)).toEqual(['ParamA', 'ParamB'])
    expect(result.partOpacities.get('PartA')).toBe(0.5)
  })

  it('keeps target classification sourced from the Cubism runtime enum', () => {
    expect(CubismMotionCurveTarget.CubismMotionCurveTarget_Model).toBe(0)
    expect(CubismMotionCurveTarget.CubismMotionCurveTarget_Parameter).toBe(1)
    expect(CubismMotionCurveTarget.CubismMotionCurveTarget_PartOpacity).toBe(2)
  })
})
