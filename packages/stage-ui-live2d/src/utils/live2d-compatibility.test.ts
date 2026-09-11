import { describe, expect, it, vi } from 'vitest'

import {
  bindLive2DFocusParameterTargets,
  createLive2DCompatibilityProfile,
  discoverLive2DParameterIds,
  migrateLegacyMotionOverrides,
  resolveLive2DMotionRequest,
  resolveModelMotionOverrides,
  setModelMotionOverride,
  shouldRestartResolvedIdleMotionOnFinish,
} from './live2d-compatibility'

function createCoreModel(parameterIds: string[]) {
  const values = new Map(parameterIds.map(id => [id, 0]))
  return {
    // Match pixi-live2d-display 0.4.0's real CubismModel surface. In
    // particular, do not provide the convenience APIs used by the old mock.
    getModel: () => ({
      parameters: {
        count: parameterIds.length,
        ids: parameterIds,
      },
    }),
    getParameterValueById: (id: string) => values.get(id) ?? 0,
    setParameterValueById: vi.fn((id: string, value: number) => values.set(id, value)),
  }
}

describe('live2d compatibility resolver', () => {
  it('discovers IDs from the exact Cubism runtime shape with guards', () => {
    const source = {
      getModel: () => ({
        parameters: {
          count: 5,
          ids: ['PARAM_ANGLE_X', 42, 'PARAM_ANGLE_X', '', 'ParamEyeBallX', 'ignored-after-count'],
        },
      }),
      getParameterIds: vi.fn(() => ['wrong-test-api']),
    }

    expect(discoverLive2DParameterIds(source)).toEqual(['PARAM_ANGLE_X', 'ParamEyeBallX'])
    expect(source.getParameterIds).not.toHaveBeenCalled()
  })

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

  it('binds canonical focus targets to resolved physical IDs', () => {
    const profile = createLive2DCompatibilityProfile({
      parameterIds: [
        'PARAM_ANGLE_X',
        'PARAM_ANGLE_Y',
        'PARAM_ANGLE_Z',
        'PARAM_BODY_ANGLE_X',
        'PARAM_EYE_BALL_X',
        'PARAM_EYE_BALL_Y',
      ],
    })
    const internalModel = {
      idParamAngleX: 'ParamAngleX',
      idParamAngleY: 'ParamAngleY',
      idParamAngleZ: 'ParamAngleZ',
      idParamBodyAngleX: 'ParamBodyAngleX',
      idParamEyeBallX: 'ParamEyeBallX',
      idParamEyeBallY: 'ParamEyeBallY',
    }

    bindLive2DFocusParameterTargets(internalModel, profile)

    expect(internalModel).toEqual({
      idParamAngleX: 'PARAM_ANGLE_X',
      idParamAngleY: 'PARAM_ANGLE_Y',
      idParamAngleZ: 'PARAM_ANGLE_Z',
      idParamBodyAngleX: 'PARAM_BODY_ANGLE_X',
      idParamEyeBallX: 'PARAM_EYE_BALL_X',
      idParamEyeBallY: 'PARAM_EYE_BALL_Y',
    })
  })

  it('isolates same-filename overrides by model identity', () => {
    const modelA = setModelMotionOverride({}, 'model-a', 'motions/foo.motion3.json', 'Happy')
    const bothModels = setModelMotionOverride(modelA, 'model-b', 'motions/foo.motion3.json', 'Angry')
    const motionDefinitions = {
      '': [{ File: 'motions/foo.motion3.json' }],
    }

    expect(resolveModelMotionOverrides(bothModels, 'model-a')).toEqual({
      'motions/foo.motion3.json': 'Happy',
    })
    expect(resolveModelMotionOverrides(bothModels, 'model-b')).toEqual({
      'motions/foo.motion3.json': 'Angry',
    })
    expect(resolveModelMotionOverrides(bothModels)).toEqual({})

    expect(createLive2DCompatibilityProfile({
      parameterIds: [],
      motionDefinitions,
      motionOverrides: resolveModelMotionOverrides(bothModels, 'model-a'),
    }).resolveMotion('Happy')).toMatchObject({ group: '', index: 0 })
    expect(createLive2DCompatibilityProfile({
      parameterIds: [],
      motionDefinitions,
      motionOverrides: resolveModelMotionOverrides(bothModels, 'model-b'),
    }).resolveMotion('Angry')).toMatchObject({ group: '', index: 0 })
  })

  it('migrates a legacy flat map only into an explicit current model', () => {
    const migrated = migrateLegacyMotionOverrides({ 'motions/foo.motion3.json': 'Happy' }, 'model-a')

    expect(migrated).toEqual({
      'model-a': { 'motions/foo.motion3.json': 'Happy' },
    })
    expect(resolveModelMotionOverrides(migrated, 'model-b')).toEqual({})
    expect(migrateLegacyMotionOverrides({ 'motions/foo.motion3.json': 'Happy' })).toBeUndefined()
  })

  it('keeps a semantic candidate physical index and preserves direct group indices', () => {
    const motionDefinitions = {
      '': Array.from({ length: 30 }, (_, index) => ({
        File: index === 0
          ? 'motions/00_Anger_03.motion3.json'
          : index === 1
            ? 'motions/00_Happy_03.motion3.json'
            : index === 14
              ? 'motions/00_Wait_01.motion3.json'
              : index === 29
                ? 'motions/00_Surprise_01.motion3.json'
                : `motions/other_${index}.motion3.json`,
      })),
    }
    const profile = createLive2DCompatibilityProfile({
      parameterIds: [],
      motionDefinitions,
    })

    expect(resolveLive2DMotionRequest(profile, 'Happy', 0, motionDefinitions)).toMatchObject({
      source: 'semantic',
      group: '',
      index: 1,
    })
    expect(resolveLive2DMotionRequest(profile, '', 2, motionDefinitions)).toMatchObject({
      source: 'physical',
      group: '',
      index: 2,
    })
  })

  it('restarts only the exact finite non-standard idle candidate', () => {
    const candidate = { group: '', index: 14 }

    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: true,
      manualMotionSelected: false,
      canonicalIdleGroup: 'Idle',
      candidate,
      finishedGroup: '',
      finishedIndex: 14,
    })).toBe(true)
    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: true,
      manualMotionSelected: false,
      canonicalIdleGroup: 'Idle',
      candidate,
      finishedGroup: '',
      finishedIndex: 1,
    })).toBe(false)
    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: false,
      manualMotionSelected: false,
      canonicalIdleGroup: 'Idle',
      candidate,
      finishedGroup: '',
      finishedIndex: 14,
    })).toBe(false)
    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: true,
      manualMotionSelected: false,
      looping: true,
      canonicalIdleGroup: 'Idle',
      candidate,
      finishedGroup: '',
      finishedIndex: 14,
    })).toBe(false)
    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: true,
      manualMotionSelected: true,
      canonicalIdleGroup: 'Idle',
      candidate,
      finishedGroup: '',
      finishedIndex: 14,
    })).toBe(false)
    expect(shouldRestartResolvedIdleMotionOnFinish({
      enabled: true,
      manualMotionSelected: false,
      canonicalIdleGroup: 'Idle',
      candidate: { group: 'Idle', index: 0 },
      finishedGroup: 'Idle',
      finishedIndex: 0,
    })).toBe(false)
  })
})
