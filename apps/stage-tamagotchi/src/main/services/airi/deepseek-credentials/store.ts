import type {
  DeepSeekCredentialPublicProfile,
  DeepSeekCredentialSavePayload,
} from '@proj-airi/stage-ui/libs/providers/deepseek-credential-ipc'

import { Buffer } from 'node:buffer'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface DeepSeekSecureStorageBackend {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

interface PersistedDeepSeekCredential {
  version: 1
  apiKeyCiphertext: string
}

export interface DeepSeekCredentialStoreOptions {
  filePath: string
  secureStorage: DeepSeekSecureStorageBackend
}

export const DEEPSEEK_CREDENTIAL_PROFILE_VERSION = 1 as const

function emptyPublicProfile(): DeepSeekCredentialPublicProfile {
  return { hasCredential: false, ready: false }
}

function parsePersisted(value: string): PersistedDeepSeekCredential | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<PersistedDeepSeekCredential>
    if (
      parsed.version !== DEEPSEEK_CREDENTIAL_PROFILE_VERSION
      || typeof parsed.apiKeyCiphertext !== 'string'
      || !parsed.apiKeyCiphertext
    ) {
      return undefined
    }

    return { version: 1, apiKeyCiphertext: parsed.apiKeyCiphertext }
  }
  catch {
    return undefined
  }
}

export function createDeepSeekCredentialStore(options: DeepSeekCredentialStoreOptions) {
  const { filePath, secureStorage } = options

  const readPersisted = (): PersistedDeepSeekCredential | undefined => {
    if (!existsSync(filePath))
      return undefined
    try {
      return parsePersisted(readFileSync(filePath, 'utf8'))
    }
    catch {
      return undefined
    }
  }

  const decryptPersisted = (persisted: PersistedDeepSeekCredential): string | undefined => {
    try {
      const apiKey = secureStorage.decryptString(Buffer.from(persisted.apiKeyCiphertext, 'base64')).trim()
      return apiKey || undefined
    }
    catch {
      return undefined
    }
  }

  const getPublicProfile = (): DeepSeekCredentialPublicProfile => {
    const persisted = readPersisted()
    if (!persisted || !secureStorage.isEncryptionAvailable())
      return emptyPublicProfile()

    return decryptPersisted(persisted)
      ? { hasCredential: true, ready: true }
      : emptyPublicProfile()
  }

  const getRuntimeCredential = (): string => {
    const persisted = readPersisted()
    if (!persisted)
      throw new Error('DeepSeek credential is not configured.')
    if (!secureStorage.isEncryptionAvailable())
      throw new Error('DeepSeek secure storage is unavailable.')

    const apiKey = decryptPersisted(persisted)
    if (!apiKey)
      throw new Error('DeepSeek credential is invalid.')
    return apiKey
  }

  const persist = (profile: PersistedDeepSeekCredential) => {
    mkdirSync(dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, filePath)
    chmodSync(filePath, 0o600)
  }

  const save = (payload: DeepSeekCredentialSavePayload): DeepSeekCredentialPublicProfile => {
    if (!secureStorage.isEncryptionAvailable())
      throw new Error('DeepSeek secure storage is unavailable.')

    const apiKey = payload.apiKey.trim()
    if (!apiKey)
      throw new Error('DeepSeek API key is missing.')

    persist({
      version: 1,
      apiKeyCiphertext: secureStorage.encryptString(apiKey).toString('base64'),
    })
    return getPublicProfile()
  }

  const clear = (): DeepSeekCredentialPublicProfile => {
    if (existsSync(filePath))
      unlinkSync(filePath)
    const temporaryPath = `${filePath}.tmp`
    if (existsSync(temporaryPath))
      unlinkSync(temporaryPath)
    return emptyPublicProfile()
  }

  return {
    clear,
    getPublicProfile,
    getRuntimeCredential,
    save,
  }
}
