import localforage from 'localforage'

import { until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  createRuntimeFile,
  DisplayModelBinaryUnreadableError,
  DisplayModelPersistenceWriteError,
  hydratePersistedDisplayModelFile,
  serializeDisplayModelFile,
} from './display-model-persistence'

export enum DisplayModelFormat {
  Live2dZip = 'live2d-zip',
  Live2dDirectory = 'live2d-directory',
  VRM = 'vrm',
  SpineZip = 'spine-zip',
  TachieZip = 'tachie-zip',
  PMXZip = 'pmx-zip',
  PMXDirectory = 'pmx-directory',
  PMD = 'pmd',
}

export type DisplayModel
  = | DisplayModelFile
    | DisplayModelURL

const presetLive2dProUrl = new URL('../assets/live2d/models/hiyori_pro_zh.zip', import.meta.url).href
const presetLive2dFreeUrl = new URL('../assets/live2d/models/hiyori_free_zh.zip', import.meta.url).href
const presetLive2dPreview = new URL('../assets/live2d/models/hiyori/preview.png', import.meta.url).href
const presetVrmAvatarAUrl = new URL('../assets/vrm/models/AvatarSample-A/AvatarSample_A.vrm', import.meta.url).href
const presetVrmAvatarAPreview = new URL('../assets/vrm/models/AvatarSample-A/preview.png', import.meta.url).href
const presetVrmAvatarBUrl = new URL('../assets/vrm/models/AvatarSample-B/AvatarSample_B.vrm', import.meta.url).href
const presetVrmAvatarBPreview = new URL('../assets/vrm/models/AvatarSample-B/preview.png', import.meta.url).href

export interface DisplayModelFile {
  id: string
  format: DisplayModelFormat
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
}

export interface DisplayModelURL {
  id: string
  format: DisplayModelFormat
  type: 'url'
  url: string
  name: string
  previewImage?: string
  importedAt: number
}

const displayModelsPresets: DisplayModel[] = [
  { id: 'preset-live2d-1', format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dProUrl, name: 'Hiyori (Pro)', previewImage: presetLive2dPreview, importedAt: 1733113886840 },
  { id: 'preset-live2d-2', format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dFreeUrl, name: 'Hiyori (Free)', previewImage: presetLive2dPreview, importedAt: 1733113886840 },
  { id: 'preset-vrm-1', format: DisplayModelFormat.VRM, type: 'url', url: presetVrmAvatarAUrl, name: 'AvatarSample_A', previewImage: presetVrmAvatarAPreview, importedAt: 1733113886840 },
  { id: 'preset-vrm-2', format: DisplayModelFormat.VRM, type: 'url', url: presetVrmAvatarBUrl, name: 'AvatarSample_B', previewImage: presetVrmAvatarBPreview, importedAt: 1733113886840 },
]

export const useDisplayModelsStore = defineStore('display-models', () => {
  const displayModels = ref<DisplayModel[]>([])

  let generateLive2DPreview: (file: File) => Promise<string | undefined>
  let generateVrmPreview: (file: File) => Promise<string | undefined>
  let generateSpinePreview: (file: File) => Promise<string | undefined>
  let generateTachiePreview: (file: File) => Promise<string | undefined>
  let generateMMDPreview: (file: File) => Promise<string | undefined>

  const displayModelsFromIndexedDBLoading = ref(false)
  const displayModelLoadErrors = ref<Record<string, DisplayModelBinaryUnreadableError>>({})

  const isCustomDisplayModelId = (id: string) => id.startsWith('display-model-')

  function rememberLoadError(id: string, error: unknown) {
    if (error instanceof DisplayModelBinaryUnreadableError) {
      displayModelLoadErrors.value = { ...displayModelLoadErrors.value, [id]: error }
      return
    }

    const wrappedError = new DisplayModelBinaryUnreadableError(id, error)
    displayModelLoadErrors.value = { ...displayModelLoadErrors.value, [id]: wrappedError }
  }

  async function persistRecord(id: string, value: unknown) {
    try {
      await localforage.setItem(id, value)
    }
    catch (error) {
      throw new DisplayModelPersistenceWriteError(id, error)
    }
  }

  async function hydrateModel(id: string, value: unknown) {
    const hydrated = await hydratePersistedDisplayModelFile(id, value)
    if (hydrated.migratedRecord)
      await persistRecord(id, hydrated.migratedRecord)

    return {
      ...hydrated.model,
      format: hydrated.model.format as DisplayModelFormat,
    } satisfies DisplayModelFile
  }

  function publishHydratedModel(model: DisplayModelFile) {
    const index = displayModels.value.findIndex(item => item.id === model.id)
    if (index === -1) {
      displayModels.value = [...displayModels.value, model]
      return
    }

    displayModels.value[index] = model
  }

  async function loadDisplayModelsFromIndexedDB() {
    await until(displayModelsFromIndexedDBLoading).toBe(false)

    displayModelsFromIndexedDBLoading.value = true
    const models = [...displayModelsPresets]
    displayModelLoadErrors.value = {}

    try {
      const keys = (await localforage.keys()).filter(key => isCustomDisplayModelId(key))
      for (const id of keys) {
        const value = await localforage.getItem<unknown>(id)
        if (!value)
          continue

        try {
          models.push(await hydrateModel(id, value))
        }
        catch (error) {
          if (error instanceof DisplayModelPersistenceWriteError)
            throw error
          rememberLoadError(id, error)
        }
      }

      displayModels.value = models.sort((a, b) => b.importedAt - a.importedAt)
    }
    finally {
      displayModelsFromIndexedDBLoading.value = false
    }
  }

  async function getDisplayModel(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const loadError = displayModelLoadErrors.value[id]
    if (loadError)
      throw loadError

    // NOTICE:
    // Newly imported file models are inserted into displayModels before callers pick them.
    // Reading memory first keeps updateStageModel from racing an IndexedDB write and treating
    // a just-imported display-model id as missing, which used to fall back to the default model.
    // Source/context: model-selector confirmImport/handleAddVRMModel -> model-settings handleModelPick.
    // Removal condition: custom model imports and selection are handled by a single transactional API.
    const modelFromMemory = displayModels.value.find(model => model.id === id)
    if (modelFromMemory)
      return modelFromMemory

    const modelFromFile = await localforage.getItem<unknown>(id)
    if (modelFromFile) {
      try {
        const hydratedModel = await hydrateModel(id, modelFromFile)
        publishHydratedModel(hydratedModel)
        return hydratedModel
      }
      catch (error) {
        if (!(error instanceof DisplayModelPersistenceWriteError))
          rememberLoadError(id, error)
        throw error
      }
    }

    // Fallback to in-memory presets if not found in localforage
    if (isCustomDisplayModelId(id))
      return undefined

    return displayModelsPresets.find(model => model.id === id)
  }

  const loadLive2DModelPreview = (file: File) => generateLive2DPreview(file)
  const loadVrmModelPreview = (file: File) => generateVrmPreview(file)
  const loadSpineModelPreview = (file: File) => generateSpinePreview(file)
  const loadTachieModelPreview = (file: File) => generateTachiePreview(file)
  const loadMMDModelPreview = (file: File) => generateMMDPreview(file)

  async function addDisplayModel(format: DisplayModelFormat, file: File) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const newDisplayModelMetadata: Omit<DisplayModelFile, 'file'> = { id: `display-model-${nanoid()}`, format, type: 'file', name: file.name, importedAt: Date.now() }

    if (format === DisplayModelFormat.Live2dZip) {
      const previewImage = await loadLive2DModelPreview(file)
      newDisplayModelMetadata.previewImage = previewImage
    }
    else if (format === DisplayModelFormat.VRM) {
      const previewImage = await loadVrmModelPreview(file)
      newDisplayModelMetadata.previewImage = previewImage
    }
    else if (format === DisplayModelFormat.SpineZip) {
      const previewImage = await loadSpineModelPreview(file)
      newDisplayModelMetadata.previewImage = previewImage
    }
    else if (format === DisplayModelFormat.TachieZip) {
      const previewImage = await loadTachieModelPreview(file)
      newDisplayModelMetadata.previewImage = previewImage
    }
    else if (format === DisplayModelFormat.PMXZip || format === DisplayModelFormat.PMXDirectory || format === DisplayModelFormat.PMD) {
      // NOTICE:
      // Preview generation is best-effort and must not block the import.
      // MMD preview spins up an offscreen WebGL context and the three-stdlib
      // MMDLoader; if that throws (context limits, parse error, missing Ammo
      // module), the model should still import — just without a thumbnail.
      // Removal condition: preview generation is guaranteed non-throwing.
      try {
        if (!generateMMDPreview)
          throw new Error('MMD preview module not initialized')
        newDisplayModelMetadata.previewImage = await loadMMDModelPreview(file)
      }
      catch (err) {
        console.error('[display-models] MMD preview generation failed; importing without a thumbnail:', err)
      }
    }

    const newDisplayModel = { ...newDisplayModelMetadata, file } satisfies DisplayModelFile
    const persistedRecord = await serializeDisplayModelFile(newDisplayModel)
    await persistRecord(newDisplayModel.id, persistedRecord)

    const runtimeModel: DisplayModelFile = { ...newDisplayModel, file: createRuntimeFile(persistedRecord) }
    displayModels.value.unshift(runtimeModel)
    return runtimeModel
  }

  async function renameDisplayModel(id: string, name: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const displayModel = await getDisplayModel(id)

    if (!displayModel)
      return

    if (displayModel.type === 'file') {
      const updatedModel = { ...displayModel, name }
      const persistedRecord = await serializeDisplayModelFile(updatedModel)
      await persistRecord(id, persistedRecord)
      publishHydratedModel(updatedModel)
      return
    }

    const index = displayModels.value.findIndex(m => m.id === id)
    if (index !== -1)
      displayModels.value[index] = { ...displayModels.value[index], name }
  }

  async function replaceDisplayModelFilePayload(existingModelId: string, replacementFile: File) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    if (!isCustomDisplayModelId(existingModelId))
      throw new Error(`Only custom display-model records can be repaired: ${existingModelId}`)

    const storedRecord = await localforage.getItem<unknown>(existingModelId)
    if (!storedRecord || typeof storedRecord !== 'object')
      throw new Error(`Display-model record not found: ${existingModelId}`)

    const stored = storedRecord as { format?: unknown, name?: unknown, importedAt?: unknown, previewImage?: unknown }
    const currentModel = displayModels.value.find(model => model.id === existingModelId)
    const format = typeof stored.format === 'string'
      ? stored.format as DisplayModelFormat
      : currentModel?.type === 'file' ? currentModel.format : undefined
    if (!format || typeof stored.importedAt !== 'number')
      throw new Error(`Display-model record metadata is invalid: ${existingModelId}`)

    const replacementModel: DisplayModelFile = {
      id: existingModelId,
      format,
      type: 'file',
      file: replacementFile,
      name: typeof stored.name === 'string'
        ? stored.name
        : currentModel?.type === 'file' ? currentModel.name : replacementFile.name,
      importedAt: stored.importedAt,
      previewImage: typeof stored.previewImage === 'string' ? stored.previewImage : undefined,
    }
    const persistedRecord = await serializeDisplayModelFile(replacementModel)
    await persistRecord(existingModelId, persistedRecord)

    const hydratedReplacement: DisplayModelFile = {
      ...replacementModel,
      file: createRuntimeFile(persistedRecord),
    }
    publishHydratedModel(hydratedReplacement)
    const remainingErrors = { ...displayModelLoadErrors.value }
    delete remainingErrors[existingModelId]
    displayModelLoadErrors.value = remainingErrors
    return hydratedReplacement
  }

  async function removeDisplayModel(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    await localforage.removeItem(id)
    displayModels.value = displayModels.value.filter(model => model.id !== id)
    const remainingErrors = { ...displayModelLoadErrors.value }
    delete remainingErrors[id]
    displayModelLoadErrors.value = remainingErrors
  }

  async function resetDisplayModels() {
    await loadDisplayModelsFromIndexedDB()
    const userModelIds = displayModels.value.filter(model => model.type === 'file').map(model => model.id)
    for (const id of userModelIds) {
      await removeDisplayModel(id)
    }

    displayModels.value = [...displayModelsPresets].sort((a, b) => b.importedAt - a.importedAt)
  }

  async function initialize() {
    await import('@proj-airi/stage-ui-live2d/utils/live2d-zip-loader')
    await import('@proj-airi/stage-ui-live2d/utils/live2d-opfs-registration')

    const { loadLive2DModelPreview } = await import('@proj-airi/stage-ui-live2d/utils/live2d-preview')
    const { loadVrmModelPreview } = await import('@proj-airi/stage-ui-three/utils/vrm-preview')
    const { loadSpineModelPreview } = await import('@proj-airi/stage-ui-spine/utils/spine-preview')
    const { loadTachieModelPreview } = await import('@proj-airi/stage-ui-tachie/utils/tachie-preview')

    generateLive2DPreview = loadLive2DModelPreview
    generateVrmPreview = loadVrmModelPreview
    generateSpinePreview = loadSpineModelPreview
    generateTachiePreview = loadTachieModelPreview

    // NOTICE:
    // Isolate the MMD preview import. It pulls in three-stdlib's MMD modules,
    // and a module-evaluation failure here must not prevent the Live2D/VRM/
    // Spine preview functions (assigned above) from being wired up. A thrown
    // import previously aborted initialize() and silently broke all previews.
    // Removal condition: the MMD preview module is guaranteed to import.
    try {
      const { loadMMDModelPreview } = await import('@proj-airi/stage-ui-mmd/utils/mmd-preview')
      generateMMDPreview = loadMMDModelPreview
    }
    catch (err) {
      console.error('[display-models] failed to load MMD preview module:', err)
    }
  }

  return {
    displayModels,
    displayModelsFromIndexedDBLoading,
    displayModelLoadErrors,

    initialize,
    loadDisplayModelsFromIndexedDB,
    getDisplayModel,
    addDisplayModel,
    replaceDisplayModelFilePayload,
    renameDisplayModel,
    removeDisplayModel,
    resetDisplayModels,
  }
})
