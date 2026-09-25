import type { LegacyDisplayModelBinaryUnreadableError } from './display-model-persistence'

import { describe, expect, it, vi } from 'vitest'

import {
  DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION,
  hydratePersistedDisplayModelFile,
  serializeDisplayModelFile,
} from './display-model-persistence'

function bytesOf(value: ArrayBuffer) {
  return [...new Uint8Array(value)]
}

describe('display-model persistence', () => {
  it('round-trips durable bytes and runtime file metadata', async () => {
    const source = new File([new Uint8Array([1, 2, 3, 4])], 'model.zip', {
      type: 'application/zip',
      lastModified: 123,
    })

    const persisted = await serializeDisplayModelFile({
      id: 'display-model-round-trip',
      format: 'live2d-zip',
      file: source,
      name: 'Renamed model',
      importedAt: 456,
      previewImage: 'data:image/png;base64,preview',
    })
    const hydrated = await hydratePersistedDisplayModelFile('display-model-round-trip', persisted)

    expect(persisted.schemaVersion).toBe(DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION)
    expect(persisted.fileName).toBe('model.zip')
    expect(persisted.fileType).toBe('application/zip')
    expect(persisted.fileLastModified).toBe(123)
    expect(persisted.fileSize).toBe(source.size)
    expect(hydrated.migratedRecord).toBeUndefined()
    expect(hydrated.model.file).toBeInstanceOf(File)
    expect(hydrated.model.name).toBe('Renamed model')
    expect(hydrated.model.previewImage).toBe('data:image/png;base64,preview')
    expect(hydrated.model.importedAt).toBe(456)
    expect(bytesOf(await hydrated.model.file.arrayBuffer())).toEqual([1, 2, 3, 4])
  })

  it('migrates a readable legacy File without changing its model id', async () => {
    const legacyFile = new File(['legacy bytes'], 'legacy.zip', { type: 'application/zip', lastModified: 789 })
    const hydrated = await hydratePersistedDisplayModelFile('display-model-legacy', {
      format: 'live2d-zip',
      type: 'file',
      file: legacyFile,
      name: 'Legacy display name',
      importedAt: 987,
      previewImage: 'legacy-preview',
    })

    expect(hydrated.model.id).toBe('display-model-legacy')
    expect(hydrated.migratedRecord?.schemaVersion).toBe(DISPLAY_MODEL_PERSISTENCE_SCHEMA_VERSION)
    expect(hydrated.migratedRecord?.id).toBe('display-model-legacy')
    expect(hydrated.model.name).toBe('Legacy display name')
    expect(hydrated.model.file.name).toBe('legacy.zip')
    expect(hydrated.model.file.type).toBe('application/zip')
    expect(hydrated.model.file.lastModified).toBe(789)
    expect(await hydrated.model.file.text()).toBe('legacy bytes')
  })

  it('fails closed for an unreadable legacy File', async () => {
    const readError = new DOMException('The backing file is gone', 'NotFoundError')
    const unreadableFile = {
      name: 'missing.zip',
      type: 'application/zip',
      size: 10,
      lastModified: 1,
      arrayBuffer: vi.fn().mockRejectedValue(readError),
    } as unknown as File

    await expect(hydratePersistedDisplayModelFile('display-model-unreadable', {
      format: 'live2d-zip',
      type: 'file',
      file: unreadableFile,
      importedAt: 1,
    })).rejects.toMatchObject({
      name: 'LegacyDisplayModelBinaryUnreadableError',
      code: 'LEGACY_DISPLAY_MODEL_BINARY_UNREADABLE',
      modelId: 'display-model-unreadable',
      cause: readError,
    } satisfies Partial<LegacyDisplayModelBinaryUnreadableError>)
  })

  it('supports object URL body reads after hydration', async () => {
    const persisted = await serializeDisplayModelFile({
      id: 'display-model-object-url',
      format: 'live2d-zip',
      file: new File([new Uint8Array([9, 8, 7])], 'object-url.zip', { type: 'application/zip' }),
      name: 'Object URL model',
      importedAt: 1,
    })
    const hydrated = await hydratePersistedDisplayModelFile('display-model-object-url', persisted)
    const objectUrl = URL.createObjectURL(hydrated.model.file)

    try {
      const response = await fetch(objectUrl)
      expect(response.ok).toBe(true)
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 8, 7])
    }
    finally {
      URL.revokeObjectURL(objectUrl)
    }
  })
})
