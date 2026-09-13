import type { DisplayModelFile, DisplayModelURL } from '../display-models'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'
import { useSettingsStageModel } from './stage-model'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const { refManualReset } = await import('@vueuse/core')

  return {
    useLocalStorageManualReset: (_key: string, value: string) => refManualReset(value),
  }
})

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()

  return {
    ...actual,
    useEventListener: vi.fn(),
  }
})

describe('settings stage model store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // https://github.com/moeru-ai/airi/issues/1984
  it('issue #1984: falls back to the default preset when a custom stage model is missing', async () => {
    const fallbackModel: DisplayModelURL = {
      id: 'preset-live2d-1',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/preset-live2d.zip',
      name: 'Preset Live2D',
      importedAt: 1,
    }

    const displayModelsStore = useDisplayModelsStore()
    const getDisplayModelSpy = vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === 'display-model-missing')
        return undefined
      if (id === fallbackModel.id)
        return fallbackModel
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = 'display-model-missing'

    await store.initializeStageModel()

    expect(store.stageModelSelected).toBe(fallbackModel.id)
    expect(store.stageModelSelectedDisplayModel).toEqual(fallbackModel)
    expect(store.stageModelSelectedUrl).toBe(fallbackModel.url)
    expect(store.stageModelRenderer).toBe('live2d')
    expect(getDisplayModelSpy).toHaveBeenCalledWith('display-model-missing')
    expect(getDisplayModelSpy).toHaveBeenCalledWith(fallbackModel.id)
  })

  it('routes Tachie archives to the Tachie renderer', async () => {
    const tachieModel: DisplayModelURL = {
      id: 'tachie-model',
      format: DisplayModelFormat.TachieZip,
      type: 'url',
      url: 'https://example.com/character.tachie.zip',
      name: 'Tachie character',
      importedAt: 1,
    }
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockResolvedValue(tachieModel)

    const store = useSettingsStageModel()
    store.stageModelSelected = tachieModel.id

    await store.initializeStageModel()

    expect(store.stageModelSelectedDisplayModel).toEqual(tachieModel)
    expect(store.stageModelSelectedUrl).toBe(tachieModel.url)
    expect(store.stageModelRenderer).toBe('tachie')
  })

  it('keeps the previous resolved pair while a new model source is pending', async () => {
    const aquaModel: DisplayModelFile = {
      id: 'aqua-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'file',
      file: new File(['aqua'], 'aqua.zip'),
      name: 'Aqua',
      importedAt: 1,
    }
    const hiyoriModel: DisplayModelURL = {
      id: 'hiyori-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/hiyori.zip',
      name: 'Hiyori',
      importedAt: 1,
    }
    const pendingHiyori = deferred<DisplayModelURL>()
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aqua')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === aquaModel.id)
        return aquaModel
      if (id === hiyoriModel.id)
        return pendingHiyori.promise
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = aquaModel.id
    await store.initializeStageModel()

    expect(store.stageModelResolved).toEqual({
      modelId: aquaModel.id,
      modelSrc: 'blob:aqua',
      renderer: 'live2d',
    })

    store.stageModelSelected = hiyoriModel.id
    await nextTick()

    expect(store.stageModelResolved).toEqual({
      modelId: aquaModel.id,
      modelSrc: 'blob:aqua',
      renderer: 'live2d',
    })

    pendingHiyori.resolve(hiyoriModel)
    await Promise.resolve()
    await nextTick()

    expect(store.stageModelResolved).toEqual({
      modelId: hiyoriModel.id,
      modelSrc: hiyoriModel.url,
      renderer: 'live2d',
    })
  })

  it('commits a reverse Hiyori to Aqua transition as one resolved pair', async () => {
    const hiyoriModel: DisplayModelURL = {
      id: 'hiyori-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/hiyori.zip',
      name: 'Hiyori',
      importedAt: 1,
    }
    const aquaModel: DisplayModelFile = {
      id: 'aqua-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'file',
      file: new File(['aqua'], 'aqua.zip'),
      name: 'Aqua',
      importedAt: 1,
    }
    const pendingAqua = deferred<DisplayModelFile>()
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:aqua')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === hiyoriModel.id)
        return hiyoriModel
      if (id === aquaModel.id)
        return pendingAqua.promise
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = hiyoriModel.id
    await store.initializeStageModel()

    expect(store.stageModelResolved).toEqual({
      modelId: hiyoriModel.id,
      modelSrc: hiyoriModel.url,
      renderer: 'live2d',
    })

    store.stageModelSelected = aquaModel.id
    await nextTick()

    expect(store.stageModelResolved).toEqual({
      modelId: hiyoriModel.id,
      modelSrc: hiyoriModel.url,
      renderer: 'live2d',
    })

    pendingAqua.resolve(aquaModel)
    await Promise.resolve()
    await nextTick()

    expect(store.stageModelResolved).toEqual({
      modelId: aquaModel.id,
      modelSrc: 'blob:aqua',
      renderer: 'live2d',
    })
  })

  it('allows only the latest rapid switch to commit its resolved pair', async () => {
    const aquaModel: DisplayModelURL = {
      id: 'aqua-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/aqua.zip',
      name: 'Aqua',
      importedAt: 1,
    }
    const hiyoriModel: DisplayModelURL = {
      id: 'hiyori-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/hiyori.zip',
      name: 'Hiyori',
      importedAt: 1,
    }
    const hk416Model: DisplayModelURL = {
      id: 'hk416-model',
      format: DisplayModelFormat.Live2dZip,
      type: 'url',
      url: 'https://example.com/hk416.zip',
      name: 'HK416',
      importedAt: 1,
    }
    const pendingHiyori = deferred<DisplayModelURL>()
    const pendingHk416 = deferred<DisplayModelURL>()
    const displayModelsStore = useDisplayModelsStore()
    vi.spyOn(displayModelsStore, 'getDisplayModel').mockImplementation(async (id) => {
      if (id === aquaModel.id)
        return aquaModel
      if (id === hiyoriModel.id)
        return pendingHiyori.promise
      if (id === hk416Model.id)
        return pendingHk416.promise
      return undefined
    })

    const store = useSettingsStageModel()
    store.stageModelSelected = aquaModel.id
    await store.initializeStageModel()

    store.stageModelSelected = hiyoriModel.id
    await nextTick()
    store.stageModelSelected = hk416Model.id
    await nextTick()

    pendingHiyori.resolve(hiyoriModel)
    await Promise.resolve()
    await nextTick()
    expect(store.stageModelResolved?.modelId).toBe(aquaModel.id)

    pendingHk416.resolve(hk416Model)
    await Promise.resolve()
    await nextTick()
    expect(store.stageModelResolved).toEqual({
      modelId: hk416Model.id,
      modelSrc: hk416Model.url,
      renderer: 'live2d',
    })
  })
})
