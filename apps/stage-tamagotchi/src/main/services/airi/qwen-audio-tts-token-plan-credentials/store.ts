import type {
  QwenAudioTtsTokenPlanCredentialDiagnostic,
  QwenAudioTtsTokenPlanPublicProfile,
  QwenAudioTtsTokenPlanSavePayload,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-credential-ipc'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface QwenAudioTtsTokenPlanSecureStorageBackend {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export interface QwenAudioTtsTokenPlanRuntimeProfile {
  apiKey: string
}

interface PersistedProfile {
  version: 1
  apiKeyCiphertext: string
}

export interface QwenAudioTtsTokenPlanCredentialStoreOptions {
  filePath: string
  secureStorage: QwenAudioTtsTokenPlanSecureStorageBackend
  environment?: NodeJS.ProcessEnv
}

export const QWEN_AUDIO_TTS_TOKEN_PLAN_PROFILE_VERSION = 1 as const

function emptyProfile(secureStorageAvailable = false): QwenAudioTtsTokenPlanPublicProfile {
  return {
    hasApiKey: false,
    ready: false,
    source: 'none',
    secureStorageAvailable,
  }
}

interface PersistedInspection {
  persisted?: PersistedProfile
  diagnostic: QwenAudioTtsTokenPlanCredentialDiagnostic
}

function inspectPersisted(value: string): PersistedInspection {
  let parsed: Partial<PersistedProfile>
  try {
    parsed = JSON.parse(value) as Partial<PersistedProfile>
  }
  catch {
    return {
      diagnostic: {
        reason: 'PAYLOAD_PARSE_FAILED',
        recordPresent: true,
        recordSchema: 'unreadable',
        decryption: 'not-attempted',
        profile: 'unavailable',
      },
    }
  }

  if (parsed.version !== QWEN_AUDIO_TTS_TOKEN_PLAN_PROFILE_VERSION || typeof parsed.apiKeyCiphertext !== 'string' || !parsed.apiKeyCiphertext) {
    return {
      diagnostic: {
        reason: 'SCHEMA_INVALID',
        recordPresent: true,
        recordSchema: 'invalid',
        decryption: 'not-attempted',
        profile: 'unavailable',
      },
    }
  }

  return {
    persisted: { version: 1, apiKeyCiphertext: parsed.apiKeyCiphertext },
    diagnostic: {
      reason: 'RECORD_PRESENT',
      recordPresent: true,
      recordSchema: 'valid',
      decryption: 'not-attempted',
      profile: 'unavailable',
    },
  }
}

function decryptApiKey(persisted: PersistedProfile | undefined, secureStorage: QwenAudioTtsTokenPlanSecureStorageBackend): string | undefined {
  if (!persisted)
    return undefined
  const apiKey = secureStorage.decryptString(Buffer.from(persisted.apiKeyCiphertext, 'base64')).trim()
  return apiKey || undefined
}

function validateSavePayload(payload: QwenAudioTtsTokenPlanSavePayload): QwenAudioTtsTokenPlanSavePayload {
  const apiKey = payload.apiKey.trim()
  if (!apiKey)
    throw new Error('Qwen Audio Token Plan API key is missing.')
  if (/[\r\n]/.test(apiKey))
    throw new Error('Qwen Audio Token Plan API key is invalid.')
  return { apiKey }
}

export function createQwenAudioTtsTokenPlanCredentialStore(options: QwenAudioTtsTokenPlanCredentialStoreOptions) {
  const environment = options.environment ?? process.env
  const inspectSecureProfile = (): PersistedInspection => {
    if (!options.secureStorage.isEncryptionAvailable()) {
      return {
        diagnostic: {
          reason: 'ENCRYPTION_UNAVAILABLE',
          recordPresent: existsSync(options.filePath),
          recordSchema: existsSync(options.filePath) ? 'unreadable' : 'absent',
          decryption: 'not-attempted',
          profile: 'unavailable',
        },
      }
    }

    if (!existsSync(options.filePath)) {
      return {
        diagnostic: {
          reason: 'RECORD_ABSENT',
          recordPresent: false,
          recordSchema: 'absent',
          decryption: 'not-attempted',
          profile: 'absent',
        },
      }
    }

    let inspection: PersistedInspection
    try {
      inspection = inspectPersisted(readFileSync(options.filePath, 'utf8'))
    }
    catch {
      return {
        diagnostic: {
          reason: 'UNKNOWN_ERROR',
          recordPresent: true,
          recordSchema: 'unreadable',
          decryption: 'not-attempted',
          profile: 'unavailable',
        },
      }
    }

    if (!inspection.persisted)
      return inspection

    try {
      const apiKey = decryptApiKey(inspection.persisted, options.secureStorage)
      if (!apiKey) {
        return {
          diagnostic: {
            ...inspection.diagnostic,
            reason: 'PROFILE_NOT_FOUND',
            decryption: 'succeeded',
            profile: 'absent',
          },
        }
      }
      return {
        persisted: inspection.persisted,
        diagnostic: {
          ...inspection.diagnostic,
          reason: 'PROFILE_PRESENT_CONFIGURED',
          decryption: 'succeeded',
          profile: 'configured',
        },
      }
    }
    catch {
      return {
        persisted: inspection.persisted,
        diagnostic: {
          ...inspection.diagnostic,
          reason: 'DECRYPT_FAILED',
          decryption: 'failed',
          profile: 'unavailable',
        },
      }
    }
  }

  const secureRuntimeProfile = (): QwenAudioTtsTokenPlanRuntimeProfile | undefined => {
    const inspection = inspectSecureProfile()
    if (inspection.diagnostic.reason !== 'PROFILE_PRESENT_CONFIGURED' || !inspection.persisted)
      return undefined
    const apiKey = decryptApiKey(inspection.persisted, options.secureStorage)
    return apiKey ? { apiKey } : undefined
  }

  const environmentRuntimeProfile = (): QwenAudioTtsTokenPlanRuntimeProfile | undefined => {
    const apiKey = environment.TOKEN_PLAN_API_KEY?.trim() ?? ''
    return apiKey && !/[\r\n]/.test(apiKey) ? { apiKey } : undefined
  }

  const getRuntimeProfile = (): QwenAudioTtsTokenPlanRuntimeProfile => {
    const profile = secureRuntimeProfile() ?? environmentRuntimeProfile()
    if (!profile)
      throw new Error('Qwen Audio Token Plan TTS API key is unavailable.')
    return profile
  }

  const getPublicProfile = (): QwenAudioTtsTokenPlanPublicProfile => {
    const secureAvailable = options.secureStorage.isEncryptionAvailable()
    const secureInspection = inspectSecureProfile()
    if (secureInspection.diagnostic.reason === 'PROFILE_PRESENT_CONFIGURED') {
      return { hasApiKey: true, ready: true, source: 'secure-store', secureStorageAvailable: secureAvailable }
    }
    if (environmentRuntimeProfile()) {
      return { hasApiKey: true, ready: true, source: 'environment', secureStorageAvailable: secureAvailable }
    }
    return emptyProfile(secureAvailable)
  }

  const getPublicDiagnostic = (): QwenAudioTtsTokenPlanCredentialDiagnostic => {
    const secureInspection = inspectSecureProfile()
    if (secureInspection.diagnostic.reason === 'PROFILE_PRESENT_CONFIGURED')
      return secureInspection.diagnostic
    if (environmentRuntimeProfile()) {
      return {
        reason: 'ENVIRONMENT_CONFIGURED',
        recordPresent: secureInspection.diagnostic.recordPresent,
        recordSchema: secureInspection.diagnostic.recordSchema,
        decryption: secureInspection.diagnostic.decryption,
        profile: 'environment',
      }
    }
    return secureInspection.diagnostic
  }

  const persist = (profile: PersistedProfile) => {
    mkdirSync(dirname(options.filePath), { recursive: true })
    const temporaryPath = `${options.filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, options.filePath)
    chmodSync(options.filePath, 0o600)
  }

  const save = (payload: QwenAudioTtsTokenPlanSavePayload) => {
    if (!options.secureStorage.isEncryptionAvailable())
      throw new Error('Qwen Audio Token Plan secure storage is unavailable.')
    const validated = validateSavePayload(payload)
    persist({
      version: QWEN_AUDIO_TTS_TOKEN_PLAN_PROFILE_VERSION,
      apiKeyCiphertext: options.secureStorage.encryptString(validated.apiKey).toString('base64'),
    })
    return getPublicProfile()
  }

  const clear = () => {
    if (existsSync(options.filePath))
      unlinkSync(options.filePath)
    const temporaryPath = `${options.filePath}.tmp`
    if (existsSync(temporaryPath))
      unlinkSync(temporaryPath)
    return getPublicProfile()
  }

  return { clear, getPublicDiagnostic, getPublicProfile, getRuntimeProfile, save }
}
