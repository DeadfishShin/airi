export const DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION = 2 as const

export const LEGACY_DISPLAY_MODEL_BINARY_UNREADABLE = 'LEGACY_DISPLAY_MODEL_BINARY_UNREADABLE'
export const DISPLAY_MODEL_BINARY_UNREADABLE = 'DISPLAY_MODEL_BINARY_UNREADABLE'
export const DISPLAY_MODEL_PERSISTENCE_WRITE_FAILED = 'DISPLAY_MODEL_PERSISTENCE_WRITE_FAILED'

export interface RuntimeDisplayModelFileRecord {
  id: string
  format: string
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
}

export interface PersistedDisplayModelFileRecord {
  schemaVersion: typeof DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION
  id: string
  format: string
  type: 'file'
  name: string
  previewImage?: string
  importedAt: number
  fileName: string
  fileType: string
  fileLastModified: number
  fileSize: number
  fileBytes: ArrayBuffer
}

export class DisplayModelBinaryUnreadableError extends Error {
  readonly code: string
  readonly modelId: string
  readonly cause: unknown

  constructor(modelId: string, cause: unknown, code = DISPLAY_MODEL_BINARY_UNREADABLE) {
    super(`${code}: ${modelId}`)
    this.name = 'DisplayModelBinaryUnreadableError'
    this.code = code
    this.modelId = modelId
    this.cause = cause
  }
}

export class LegacyDisplayModelBinaryUnreadableError extends DisplayModelBinaryUnreadableError {
  constructor(modelId: string, cause: unknown) {
    super(modelId, cause, LEGACY_DISPLAY_MODEL_BINARY_UNREADABLE)
    this.name = 'LegacyDisplayModelBinaryUnreadableError'
  }
}

export class DisplayModelPersistenceWriteError extends Error {
  readonly code = DISPLAY_MODEL_PERSISTENCE_WRITE_FAILED
  readonly modelId: string
  readonly cause: unknown

  constructor(modelId: string, cause: unknown) {
    super(`${DISPLAY_MODEL_PERSISTENCE_WRITE_FAILED}: ${modelId}`)
    this.name = 'DisplayModelPersistenceWriteError'
    this.modelId = modelId
    this.cause = cause
  }
}

interface RuntimeFileInput {
  id: string
  format: string
  file: File
  name: string
  previewImage?: string
  importedAt: number
}

interface LegacyPersistedDisplayModelFileRecord {
  id?: string
  format: string
  type?: 'file'
  file: File
  name?: string
  previewImage?: string
  importedAt: number
}

export interface HydratedDisplayModelFileResult {
  model: RuntimeDisplayModelFileRecord
  migratedRecord?: PersistedDisplayModelFileRecord
}

function toOwnedArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer)
    return value.slice(0)

  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return bytes.slice().buffer
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value)
}

function hasCurrentSchema(value: unknown): value is PersistedDisplayModelFileRecord {
  if (!value || typeof value !== 'object')
    return false

  const record = value as Partial<PersistedDisplayModelFileRecord>
  return record.schemaVersion === DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION
    && typeof record.format === 'string'
    && record.type === 'file'
    && typeof record.name === 'string'
    && typeof record.importedAt === 'number'
    && typeof record.fileName === 'string'
    && typeof record.fileType === 'string'
    && typeof record.fileLastModified === 'number'
    && typeof record.fileSize === 'number'
    && (isArrayBuffer(record.fileBytes) || isArrayBufferView(record.fileBytes))
}

function hasLegacyFile(value: unknown): value is LegacyPersistedDisplayModelFileRecord {
  if (!value || typeof value !== 'object')
    return false

  const record = value as Partial<LegacyPersistedDisplayModelFileRecord>
  return typeof record.format === 'string'
    && typeof record.importedAt === 'number'
    && !!record.file
    && typeof record.file.arrayBuffer === 'function'
}

function createPersistedRecordFromBytes(input: {
  id: string
  format: string
  name: string
  previewImage?: string
  importedAt: number
  file: File
  fileBytes: ArrayBuffer
}): PersistedDisplayModelFileRecord {
  return {
    schemaVersion: DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION,
    id: input.id,
    format: input.format,
    type: 'file',
    name: input.name,
    previewImage: input.previewImage,
    importedAt: input.importedAt,
    fileName: input.file.name,
    fileType: input.file.type,
    fileLastModified: input.file.lastModified,
    fileSize: input.file.size,
    fileBytes: input.fileBytes,
  }
}

export function createRuntimeFile(record: PersistedDisplayModelFileRecord): File {
  return new File([record.fileBytes], record.fileName, {
    type: record.fileType,
    lastModified: record.fileLastModified,
  })
}

function createRuntimeModel(record: PersistedDisplayModelFileRecord): RuntimeDisplayModelFileRecord {
  return {
    id: record.id,
    format: record.format,
    type: 'file',
    file: createRuntimeFile(record),
    name: record.name,
    previewImage: record.previewImage,
    importedAt: record.importedAt,
  }
}

export async function serializeDisplayModelFile(input: RuntimeFileInput): Promise<PersistedDisplayModelFileRecord> {
  const fileBytes = toOwnedArrayBuffer(await input.file.arrayBuffer())
  return createPersistedRecordFromBytes({ ...input, fileBytes })
}

export async function hydratePersistedDisplayModelFile(id: string, value: unknown): Promise<HydratedDisplayModelFileResult> {
  if (hasCurrentSchema(value)) {
    const record: PersistedDisplayModelFileRecord = {
      ...value,
      id,
      fileBytes: toOwnedArrayBuffer(value.fileBytes),
    }
    return { model: createRuntimeModel(record) }
  }

  if (hasLegacyFile(value)) {
    let fileBytes: ArrayBuffer
    try {
      fileBytes = toOwnedArrayBuffer(await value.file.arrayBuffer())
    }
    catch (error) {
      throw new LegacyDisplayModelBinaryUnreadableError(id, error)
    }

    const legacy = value
    const migratedRecord = createPersistedRecordFromBytes({
      id,
      format: legacy.format,
      name: legacy.name ?? legacy.file.name,
      previewImage: legacy.previewImage,
      importedAt: legacy.importedAt,
      file: legacy.file,
      fileBytes,
    })

    return {
      model: createRuntimeModel(migratedRecord),
      migratedRecord,
    }
  }

  throw new DisplayModelBinaryUnreadableError(id, new Error('Invalid persisted display-model record'))
}
