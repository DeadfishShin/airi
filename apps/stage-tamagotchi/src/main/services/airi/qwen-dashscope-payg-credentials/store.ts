import type {
  QwenDashScopePaygPublicProfile,
  QwenDashScopePaygSavePayload,
  QwenDashScopeRegion,
} from '@proj-airi/stage-ui/libs/providers/qwen-dashscope-payg-ipc'

import { Buffer } from 'node:buffer'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface DashScopeSecureStorageBackend {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export interface QwenDashScopePaygRuntimeProfile {
  apiKey: string
  workspaceId: string
  region: QwenDashScopeRegion
}

interface PersistedDashScopePaygProfile {
  version: 1
  apiKeyCiphertext: string
  workspaceId: string
  region: QwenDashScopeRegion
}

export interface DashScopePaygCredentialStoreOptions {
  filePath: string
  secureStorage: DashScopeSecureStorageBackend
}

export const QWEN_DASHSCOPE_PAYG_PROFILE_VERSION = 1 as const
export const QWEN_DASHSCOPE_PAYG_WORKSPACE_ID_PATTERN = /^[a-z0-9-]+$/i

function emptyPublicProfile(): QwenDashScopePaygPublicProfile {
  return {
    hasApiKey: false,
    workspaceId: '',
    workspaceIdValid: false,
    region: null,
    regionConfigured: false,
    ready: false,
  }
}

function isRegion(value: unknown): value is QwenDashScopeRegion {
  return value === 'beijing' || value === 'singapore'
}

function isWorkspaceIdValid(value: string): boolean {
  return Boolean(value) && QWEN_DASHSCOPE_PAYG_WORKSPACE_ID_PATTERN.test(value)
}

function parsePersistedProfile(value: string): PersistedDashScopePaygProfile | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<PersistedDashScopePaygProfile>
    if (
      parsed.version !== QWEN_DASHSCOPE_PAYG_PROFILE_VERSION
      || typeof parsed.apiKeyCiphertext !== 'string'
      || !parsed.apiKeyCiphertext
      || typeof parsed.workspaceId !== 'string'
      || !isRegion(parsed.region)
    ) {
      return undefined
    }

    return {
      version: 1,
      apiKeyCiphertext: parsed.apiKeyCiphertext,
      workspaceId: parsed.workspaceId,
      region: parsed.region,
    }
  }
  catch {
    return undefined
  }
}

function decryptPersistedApiKey(
  persisted: PersistedDashScopePaygProfile,
  secureStorage: DashScopeSecureStorageBackend,
): string | undefined {
  try {
    const apiKey = secureStorage.decryptString(Buffer.from(persisted.apiKeyCiphertext, 'base64')).trim()
    return apiKey || undefined
  }
  catch {
    return undefined
  }
}

function validateSavePayload(payload: QwenDashScopePaygSavePayload): QwenDashScopePaygSavePayload {
  const apiKey = payload.apiKey.trim()
  const workspaceId = payload.workspaceId.trim()
  const region = payload.region

  if (!isWorkspaceIdValid(workspaceId))
    throw new Error('Qwen DashScope PAYG workspace ID is invalid.')
  if (!isRegion(region))
    throw new Error('Qwen DashScope PAYG region is invalid.')

  return { apiKey, workspaceId, region }
}

export function createDashScopePaygCredentialStore(options: DashScopePaygCredentialStoreOptions) {
  const { filePath, secureStorage } = options

  const readPersisted = (): PersistedDashScopePaygProfile | undefined => {
    if (!existsSync(filePath))
      return undefined
    return parsePersistedProfile(readFileSync(filePath, 'utf8'))
  }

  const publicProfile = (): QwenDashScopePaygPublicProfile => {
    if (!secureStorage.isEncryptionAvailable())
      return emptyPublicProfile()

    const persisted = readPersisted()
    if (!persisted)
      return emptyPublicProfile()

    // Validate the ciphertext without returning its plaintext to the renderer.
    // A readable JSON envelope alone must never make a corrupt credential appear ready.
    const apiKey = decryptPersistedApiKey(persisted, secureStorage)
    if (!apiKey)
      return emptyPublicProfile()

    const workspaceIdValid = isWorkspaceIdValid(persisted.workspaceId)
    return {
      hasApiKey: true,
      workspaceId: persisted.workspaceId,
      workspaceIdValid,
      region: persisted.region,
      regionConfigured: true,
      ready: workspaceIdValid,
    }
  }

  const runtimeProfile = (): QwenDashScopePaygRuntimeProfile => {
    if (!secureStorage.isEncryptionAvailable())
      throw new Error('Qwen DashScope PAYG secure storage is unavailable.')

    const persisted = readPersisted()
    if (!persisted)
      throw new Error('Qwen DashScope PAYG credential is not configured.')

    const apiKey = decryptPersistedApiKey(persisted, secureStorage)
    if (!apiKey || !isWorkspaceIdValid(persisted.workspaceId))
      throw new Error('Qwen DashScope PAYG credential is invalid.')

    return {
      apiKey,
      workspaceId: persisted.workspaceId,
      region: persisted.region,
    }
  }

  const persist = (profile: PersistedDashScopePaygProfile) => {
    mkdirSync(dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, filePath)
    chmodSync(filePath, 0o600)
  }

  const save = (payload: QwenDashScopePaygSavePayload): QwenDashScopePaygPublicProfile => {
    if (!secureStorage.isEncryptionAvailable())
      throw new Error('Qwen DashScope PAYG secure storage is unavailable.')

    const validated = validateSavePayload(payload)
    const existing = readPersisted()
    let apiKeyCiphertext = existing?.apiKeyCiphertext

    // An empty API key on an already configured profile means “save the
    // non-secret settings” and preserves the existing ciphertext. A first
    // save still requires a key, and a replacement always re-encrypts it.
    if (validated.apiKey) {
      apiKeyCiphertext = secureStorage.encryptString(validated.apiKey).toString('base64')
    }
    else if (!existing || !decryptPersistedApiKey(existing, secureStorage)) {
      throw new Error('Qwen DashScope PAYG API key is missing.')
    }

    if (!apiKeyCiphertext)
      throw new Error('Qwen DashScope PAYG API key is missing.')

    persist({
      version: 1,
      apiKeyCiphertext,
      workspaceId: validated.workspaceId,
      region: validated.region,
    })
    return publicProfile()
  }

  const clear = (): QwenDashScopePaygPublicProfile => {
    if (existsSync(filePath))
      unlinkSync(filePath)
    const temporaryPath = `${filePath}.tmp`
    if (existsSync(temporaryPath))
      unlinkSync(temporaryPath)
    return emptyPublicProfile()
  }

  return {
    clear,
    getPublicProfile: publicProfile,
    getRuntimeProfile: runtimeProfile,
    save,
  }
}
