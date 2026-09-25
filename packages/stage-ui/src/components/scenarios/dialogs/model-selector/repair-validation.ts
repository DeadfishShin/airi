import type { DisplayModelFormat } from '../../../../stores/display-models'

import { errorMessageFromUnknown } from '@proj-airi/stage-shared'

import { DisplayModelFormat as DisplayModelFormatValue } from '../../../../stores/display-models'

export interface DisplayModelReplacementValidation {
  valid: boolean
  message?: string
}

/** Validates a replacement before the existing model record can be overwritten. */
export async function validateDisplayModelReplacement(format: DisplayModelFormat, file: File): Promise<DisplayModelReplacementValidation> {
  if (!(file instanceof File) || file.size === 0)
    return { valid: false, message: 'Choose a non-empty model file.' }

  if (format !== DisplayModelFormatValue.Live2dZip)
    return { valid: true }

  try {
    const { validateLive2DZip } = await import('@proj-airi/stage-ui-live2d/utils/live2d-validator')
    const report = await validateLive2DZip(file)
    if (report.status === 'INVALID')
      return { valid: false, message: report.issues[0]?.message ?? 'The Live2D archive is not readable.' }
    return { valid: true }
  }
  catch (error) {
    return {
      valid: false,
      message: errorMessageFromUnknown(error, 'The model archive could not be read.'),
    }
  }
}
