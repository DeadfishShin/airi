import type {} from 'pinia-plugin-synced'

import type { DisplayModel } from '../display-models'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset, useEventListener } from '@vueuse/core'
import { defineStore, storeToRefs } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'

export type StageModelRenderer = 'live2d' | 'vrm' | 'spine' | 'tachie' | 'mmd' | 'godot' | 'disabled' | undefined
export type BuiltInStageModelRenderer = Exclude<StageModelRenderer, 'godot'>

/**
 * Renderer-facing model identity. The id and source are committed together
 * only after the selected display model has been resolved.
 */
export interface ResolvedStageModel {
  modelId: string
  modelSrc: string
  renderer: BuiltInStageModelRenderer
}

const useStageModelSelectionStore = defineStore('settings-stage-model-selection', () => {
  // Pinia synchronization owns live cross-window state. localStorage only
  // loads and saves the durable model selection.
  const selected = useLocalStorageManualReset<string>('settings/stage/model', 'preset-live2d-1', {
    listenToStorageChanges: false,
  })

  function resetState() {
    selected.reset()
  }

  return {
    selected,
    resetState,
  }
}, {
  synced: {
    state: true,
  },
})

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useDisplayModelsStore()
  const stageModelSelectionStore = useStageModelSelectionStore()
  const { selected: stageModelSelectedState } = storeToRefs(stageModelSelectionStore)
  let stageModelUpdateSequence = 0
  const defaultStageModelId = 'preset-live2d-1'
  const stageModelSelected = computed<string>({
    get: () => stageModelSelectedState.value,
    set: (value) => {
      stageModelSelectedState.value = value
    },
  })
  const stageModelSelectedDisplayModel = refManualReset<DisplayModel | undefined>(undefined)
  const stageModelSelectedUrl = refManualReset<string | undefined>(undefined)
  const stageModelResolved = shallowRef<ResolvedStageModel | undefined>(undefined)
  const stageModelRenderer = refManualReset<StageModelRenderer>(undefined)
  const stageModelBuiltInRenderer = refManualReset<BuiltInStageModelRenderer>(undefined)

  const stageViewControlsEnabled = refManualReset<boolean>(false)

  function revokeStageModelUrl(url?: string) {
    if (url?.startsWith('blob:'))
      URL.revokeObjectURL(url)
  }

  function replaceStageModelUrl(nextUrl?: string) {
    if (stageModelSelectedUrl.value === nextUrl)
      return

    revokeStageModelUrl(stageModelSelectedUrl.value)
    stageModelSelectedUrl.value = nextUrl
  }

  function resolveBuiltInStageModelRenderer(model?: DisplayModel): BuiltInStageModelRenderer {
    if (!model) {
      return 'disabled'
    }

    switch (model.format) {
      case DisplayModelFormat.Live2dZip:
        return 'live2d'
      case DisplayModelFormat.VRM:
        return 'vrm'
      case DisplayModelFormat.SpineZip:
        return 'spine'
      case DisplayModelFormat.TachieZip:
        return 'tachie'
      case DisplayModelFormat.PMXZip:
      case DisplayModelFormat.PMXDirectory:
      case DisplayModelFormat.PMD:
        return 'mmd'
      default:
        return 'disabled'
    }
  }

  function clearResolvedStageModel() {
    stageModelResolved.value = undefined
    replaceStageModelUrl(undefined)
    stageModelSelectedDisplayModel.value = undefined
    stageModelBuiltInRenderer.value = 'disabled'
    if (stageModelRenderer.value !== 'godot')
      stageModelRenderer.value = 'disabled'
  }

  function commitResolvedStageModel(model: DisplayModel, modelSrc: string, renderer: BuiltInStageModelRenderer) {
    // The main Stage consumes only this ownership unit. The legacy refs below
    // remain available for settings/preview UI and durable-selection flows.
    stageModelResolved.value = {
      modelId: model.id,
      modelSrc,
      renderer,
    }
    stageModelSelectedDisplayModel.value = model
    replaceStageModelUrl(modelSrc)
    stageModelBuiltInRenderer.value = renderer
    if (stageModelRenderer.value !== 'godot')
      stageModelRenderer.value = renderer
  }

  async function updateStageModel() {
    const requestId = ++stageModelUpdateSequence
    const selectedModelId = stageModelSelectedState.value

    if (!selectedModelId) {
      clearResolvedStageModel()
      return
    }

    const model = await displayModelsStore.getDisplayModel(selectedModelId)
    if (requestId !== stageModelUpdateSequence)
      return

    if (!model) {
      if (selectedModelId !== defaultStageModelId) {
        stageModelSelectedState.value = defaultStageModelId
        await updateStageModel()
        return
      }

      clearResolvedStageModel()
      return
    }

    const builtInRenderer = resolveBuiltInStageModelRenderer(model)
    let resolvedModelUrl: string

    if (model.type === 'file') {
      const nextUrl = URL.createObjectURL(model.file)
      if (requestId !== stageModelUpdateSequence) {
        URL.revokeObjectURL(nextUrl)
        return
      }

      resolvedModelUrl = nextUrl
    }
    else {
      resolvedModelUrl = model.url
    }

    commitResolvedStageModel(model, resolvedModelUrl, builtInRenderer)
  }

  function setStageModelRenderer(renderer: StageModelRenderer) {
    stageModelRenderer.value = renderer
  }

  function restoreBuiltInStageModelRenderer() {
    stageModelRenderer.value = stageModelBuiltInRenderer.value ?? 'disabled'
  }

  async function initializeStageModel() {
    await updateStageModel()
  }

  useEventListener('unload', () => {
    revokeStageModelUrl(stageModelSelectedUrl.value)
  })

  watch(stageModelSelectedState, (_newValue, _oldValue) => {
    void updateStageModel()
  })

  async function resetState() {
    revokeStageModelUrl(stageModelSelectedUrl.value)

    stageModelSelectionStore.resetState()
    stageModelSelectedDisplayModel.reset()
    stageModelSelectedUrl.reset()
    stageModelResolved.value = undefined
    stageModelRenderer.reset()
    stageModelBuiltInRenderer.reset()
    stageViewControlsEnabled.reset()

    await updateStageModel()
  }

  return {
    stageModelRenderer,
    stageModelSelected,
    stageModelSelectedUrl,
    stageModelSelectedDisplayModel,
    stageModelResolved,
    stageViewControlsEnabled,

    initializeStageModel,
    restoreBuiltInStageModelRenderer,
    setStageModelRenderer,
    updateStageModel,
    resetState,
  }
})
