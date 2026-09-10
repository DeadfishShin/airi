import { describe, expect, it, vi } from 'vitest'

import {
  createLive2DCompatibilityProfile,
} from './live2d-compatibility'

function createCoreModel(parameterIds: string[]) {
  const values = new Map(parameterIds.map(id => [id, 0]))
  return {
    getParameterIds: () => parameterIds,
    getParameterValueById: (id: string) => values.get(id) ?? 0,
    setParameterValueById: vi.fn((id: string, value: number) => values.set(id, value)),
  }
}

describe('live2d compatibility resolver', () => {
  it('preserves modern parameter and Idle group behavior', () => {
    const model = createCoreModel([
      'ParamAngleX',
      'ParamEyeBallX',
      'ParamEyeBallY',
      'ParamEyeLOpen',
      'ParamEyeROpen',
      'ParamMouthOpenY',
      'ParamMouthForm',
      'ParamBreath',
    ])
    const profile = createLive2DCompatibilityProfile({
      coreModel: model,
      motionDefinitions: {
        Idle: [{ File: 'motions/idle.motion3.json' }],
      },
    })

    expect(profile.parameterMap).toMatchObject({
      angleX: 'ParamAngleX',
      eyeBallX: 'ParamEyeBallX',
      eyeLeftOpen: 'ParamEyeLOpen',
      mouthOpen: 'ParamMouthOpenY',
    })
    expect(profile.capabilities.gazeTracking).toBe(true)
    expect(profile.capabilities.blinking).toBe(true)
    expect(profile.motionMap.idle).toMatchObject({ group: 'Idle', index: 0, confidence: 'high' })
    expect(profile.setParameter(model, 'mouthOpen', 0.8)).toBe(true)
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamMouthOpenY', 0.8)
  })

  it('resolves Aqua-like legacy IDs from model-declared groups and wait motion', () => {
    const model = createCoreModel([
      'PARAM_ANGLE_X',
      'PARAM_ANGLE_Y',
      'PARAM_ANGLE_Z',
      'PARAM_BODY_ANGLE_X',
      'PARAM_BODY_ANGLE_Y',
      'PARAM_BODY_ANGLE_Z',
      'PARAM_EYE_BALL_X',
      'PARAM_EYE_BALL_Y',
      'PARAM_EYE_L_OPEN',
      'PARAM_EYE_R_OPEN',
      'PARAM_MOUTH_OPEN_Y',
      'PARAM_BREATH',
    ])
    const profile = createLive2DCompatibilityProfile({
      coreModel: model,
      groups: [
        { Name: 'EyeBlink', Ids: ['PARAM_EYE_L_OPEN', 'PARAM_EYE_R_OPEN'] },
        { Name: 'LipSync', Ids: ['PARAM_MOUTH_OPEN_Y'] },
      ],
      motionDefinitions: {
        '': [
          { File: 'motions/00_Anger_03.motion3.json' },
          { File: 'motions/00_Happy_03.motion3.json' },
          { File: 'motions/00_Wait_01.motion3.json' },
        ],
      },
    })

    expect(profile.parameterMap).toMatchObject({
      angleX: 'PARAM_ANGLE_X',
      bodyAngleZ: 'PARAM_BODY_ANGLE_Z',
      eyeBallX: 'PARAM_EYE_BALL_X',
      eyeLeftOpen: 'PARAM_EYE_L_OPEN',
      eyeRightOpen: 'PARAM_EYE_R_OPEN',
      mouthOpen: 'PARAM_MOUTH_OPEN_Y',
      breath: 'PARAM_BREATH',
    })
    expect(profile.capabilities).toEqual({
      gazeTracking: true,
      blinking: true,
      lipSync: true,
      headMotion: true,
      bodyMotion: true,
      breath: true,
    })
    expect(profile.motionMap.idle).toMatchObject({
      group: '',
      index: 2,
      fileName: 'motions/00_Wait_01.motion3.json',
      confidence: 'high',
    })
    expect(profile.resolveMotion('Happy')).toMatchObject({ group: '', index: 1 })
  })

  it('degrades safely when optional parameters are absent', () => {
    const model = createCoreModel(['ParamAngleX', 'ParamMouthOpenY'])
    const profile = createLive2DCompatibilityProfile({ coreModel: model })

    expect(profile.capabilities.gazeTracking).toBe(false)
    expect(profile.capabilities.breath).toBe(false)
    expect(profile.setParameter(model, 'eyeBallX', 0.5)).toBe(false)
    expect(profile.setParameter(model, 'mouthOpen', 0.5)).toBe(true)
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamMouthOpenY', 0.5)
  })

  it('does not guess an idle motion when filenames are opaque', () => {
    const profile = createLive2DCompatibilityProfile({
      parameterIds: ['PARAM_ANGLE_X'],
      motionDefinitions: {
        '': [
          { File: 'motions/a.motion3.json' },
          { File: 'motions/b.motion3.json' },
        ],
      },
    })

    expect(profile.motionMap.idle).toBeUndefined()
    expect(profile.resolveMotion('Idle')).toBeUndefined()
  })

  it('prefers an existing persisted motion override over filename heuristics', () => {
    const profile = createLive2DCompatibilityProfile({
      parameterIds: ['PARAM_ANGLE_X'],
      motionDefinitions: {
        '': [
          { File: 'motions/custom_01.motion3.json' },
        ],
      },
      motionOverrides: {
        'motions/custom_01.motion3.json': 'Happy',
      },
    })

    expect(profile.resolveMotion('Happy')).toMatchObject({
      group: '',
      index: 0,
      confidence: 'high',
    })
  })
})
