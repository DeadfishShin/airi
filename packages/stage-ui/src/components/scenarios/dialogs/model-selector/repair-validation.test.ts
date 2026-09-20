import { describe, expect, it } from 'vitest'

import { DisplayModelFormat } from '../../../../stores/display-models'
import { validateDisplayModelReplacement } from './repair-validation'

describe('display model replacement validation', () => {
  it('rejects an empty replacement before persistence', async () => {
    const result = await validateDisplayModelReplacement(
      DisplayModelFormat.Live2dZip,
      new File([], 'empty.zip', { type: 'application/zip' }),
    )

    expect(result).toEqual({ valid: false, message: 'Choose a non-empty model file.' })
  })

  it('accepts a non-empty non-Live2D replacement for the generic repair path', async () => {
    const result = await validateDisplayModelReplacement(
      DisplayModelFormat.VRM,
      new File(['vrm bytes'], 'avatar.vrm', { type: 'model/vrm' }),
    )

    expect(result).toEqual({ valid: true })
  })
})
