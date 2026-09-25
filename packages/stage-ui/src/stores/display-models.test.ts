import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from './display-models'

const localforageState = vi.hoisted(() => ({ records: new Map<string, unknown>(), writeError: undefined as unknown }))

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => localforageState.records.get(key)),
    keys: vi.fn(async () => [...localforageState.records.keys()]),
    removeItem: vi.fn(async (key: string) => {
      localforageState.records.delete(key)
    }),
    setItem: vi.fn(async (key: string, value: unknown) => {
      if (localforageState.writeError)
        throw localforageState.writeError
      localforageState.records.set(key, value)
      return value
    }),
  },
}))

/**
 * @example
 * describe('display models store', () => {})
 */
describe('display models store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localforageState.records.clear()
    localforageState.writeError = undefined
  })

  /**
   * @example
   * it('resolves newly imported display models from memory before IndexedDB', async () => {})
   */
  it('resolves newly imported display models from memory before IndexedDB', async () => {
    const store = useDisplayModelsStore()
    const model = {
      id: 'display-model-pending-idb-write',
      format: DisplayModelFormat.Live2dZip,
      type: 'file' as const,
      file: new File(['model'], 'model.zip'),
      name: 'model.zip',
      importedAt: 1,
    }

    store.displayModels = [model]

    const resolved = await store.getDisplayModel(model.id)

    expect(resolved).toEqual(model)
  })

  it('repairs an unreadable legacy record in place and keeps its id and metadata', async () => {
    const modelId = 'display-model-aqua'
    const unreadableFile = {
      name: '1014100aqua.zip',
      type: 'application/zip',
      size: 123,
      lastModified: 11,
      arrayBuffer: vi.fn().mockRejectedValue(new DOMException('gone', 'NotFoundError')),
    } as unknown as File
    localforageState.records.set(modelId, {
      format: DisplayModelFormat.Live2dZip,
      type: 'file',
      file: unreadableFile,
      name: 'Aqua',
      importedAt: 22,
      previewImage: 'aqua-preview',
    })

    const store = useDisplayModelsStore()
    await store.loadDisplayModelsFromIndexedDB()

    await expect(store.getDisplayModel(modelId)).rejects.toMatchObject({ code: 'LEGACY_DISPLAY_MODEL_BINARY_UNREADABLE' })
    expect(store.displayModelLoadErrorMetadata[modelId]).toEqual(expect.objectContaining({
      id: modelId,
      format: DisplayModelFormat.Live2dZip,
      name: 'Aqua',
      fileName: '1014100aqua.zip',
      importedAt: 22,
    }))

    const repaired = await store.replaceDisplayModelFilePayload(modelId, new File(['replacement'], 'replacement.zip', { type: 'application/zip' }))
    expect(repaired.id).toBe(modelId)
    expect(repaired.name).toBe('Aqua')
    expect(repaired.previewImage).toBe('aqua-preview')
    expect(await repaired.file.text()).toBe('replacement')

    const persisted = localforageState.records.get(modelId) as { schemaVersion: number, id: string, fileBytes: ArrayBuffer }
    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.id).toBe(modelId)
    expect([...new Uint8Array(persisted.fileBytes)]).toEqual([...new TextEncoder().encode('replacement')])
    expect(await store.getDisplayModel(modelId)).toEqual(repaired)
  })

  it('lazily migrates a readable legacy record before publishing it', async () => {
    const modelId = 'display-model-readable-legacy'
    localforageState.records.set(modelId, {
      format: DisplayModelFormat.Live2dZip,
      type: 'file',
      file: new File(['legacy payload'], 'legacy.zip', { type: 'application/zip' }),
      name: 'Legacy model',
      importedAt: 12,
      previewImage: 'legacy-preview',
    })

    const store = useDisplayModelsStore()
    await store.loadDisplayModelsFromIndexedDB()

    const migrated = store.displayModels.find(model => model.id === modelId)
    expect(migrated?.type).toBe('file')
    if (migrated?.type !== 'file')
      throw new Error('Expected the migrated model to be a file model')
    expect(await migrated.file.text()).toBe('legacy payload')

    const persisted = localforageState.records.get(modelId) as { schemaVersion: number, id: string }
    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.id).toBe(modelId)
  })

  it('persists durable bytes before publishing a new runtime model', async () => {
    const store = useDisplayModelsStore()
    const imported = await store.addDisplayModel(
      DisplayModelFormat.Live2dDirectory,
      new File(['new durable bytes'], 'new-model.zip', { type: 'application/zip' }),
    )

    expect(store.displayModels[0]).toEqual(imported)
    expect(imported.file).toBeInstanceOf(File)
    expect(await imported.file.text()).toBe('new durable bytes')

    const persisted = localforageState.records.get(imported.id) as { schemaVersion: number, fileBytes: ArrayBuffer }
    expect(persisted.schemaVersion).toBe(2)
    expect(new TextDecoder().decode(persisted.fileBytes)).toBe('new durable bytes')
  })

  it('does not publish a replacement when durable persistence fails', async () => {
    const modelId = 'display-model-write-failure'
    const originalFile = new File(['original'], 'original.zip', { type: 'application/zip' })
    localforageState.records.set(modelId, {
      schemaVersion: 2,
      id: modelId,
      format: DisplayModelFormat.Live2dZip,
      type: 'file',
      name: 'Original',
      importedAt: 1,
      fileName: originalFile.name,
      fileType: originalFile.type,
      fileLastModified: originalFile.lastModified,
      fileSize: originalFile.size,
      fileBytes: await originalFile.arrayBuffer(),
    })

    const store = useDisplayModelsStore()
    await store.loadDisplayModelsFromIndexedDB()
    const before = await store.getDisplayModel(modelId)
    localforageState.writeError = new Error('quota exceeded')

    await expect(
      store.replaceDisplayModelFilePayload(modelId, new File(['replacement'], 'replacement.zip')),
    ).rejects.toMatchObject({ code: 'DISPLAY_MODEL_PERSISTENCE_WRITE_FAILED' })
    expect(await store.getDisplayModel(modelId)).toEqual(before)
  })
})
