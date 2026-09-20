import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ModelSelector from './model-selector.vue'

import { DisplayModelBinaryUnreadableError, DisplayModelFormat, useDisplayModelsStore } from '../../../../stores/display-models'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: {} },
  })
}

function createModelStore() {
  const pinia = createPinia()
  const store = useDisplayModelsStore(pinia)
  return { pinia, store }
}

afterEach(() => cleanup())

describe('unreadable display-model repair affordance', () => {
  it('shows a repair action only for an unreadable custom record', async () => {
    const { pinia, store } = createModelStore()
    const modelId = 'display-model-unreadable'
    store.displayModelLoadErrors = {
      [modelId]: new DisplayModelBinaryUnreadableError(modelId, new Error('gone')),
    }
    store.displayModelLoadErrorMetadata = {
      [modelId]: {
        id: modelId,
        format: DisplayModelFormat.Live2dZip,
        type: 'file',
        name: 'Unreadable Aqua',
        fileName: '1014100aqua.zip',
        importedAt: 1,
      },
    }

    const screen = await render(ModelSelector, {
      global: {
        directives: { autoAnimate: {} },
        plugins: [pinia, createTestI18n()],
      },
    })

    await expect.element(screen.getByRole('button', { name: 'Repair model file' })).toBeVisible()
    await expect.element(screen.getByText('Unreadable Aqua')).toBeVisible()
  })

  it('does not show repair affordances for healthy or preset models', async () => {
    const { pinia, store } = createModelStore()
    store.displayModels = [
      {
        id: 'display-model-healthy',
        format: DisplayModelFormat.Live2dZip,
        type: 'file',
        file: new File(['healthy'], 'healthy.zip'),
        name: 'Healthy model',
        importedAt: 2,
      },
      {
        id: 'preset-live2d-1',
        format: DisplayModelFormat.Live2dZip,
        type: 'url',
        url: '/hiyori.zip',
        name: 'Hiyori (Pro)',
        importedAt: 1,
      },
    ]

    const screen = await render(ModelSelector, {
      global: {
        directives: { autoAnimate: {} },
        plugins: [pinia, createTestI18n()],
      },
    })

    expect(screen.getByRole('button', { name: 'Repair model file' }).query()).toBeNull()
  })
})
