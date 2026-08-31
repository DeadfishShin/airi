import { describe, expect, it } from 'vitest'
import { computed, createApp, h, nextTick, provide, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import QwenHearingSettings from './hearing-settings.vue'

import { hearingProviderViewContextKey } from '../../hearing-view'

const messages = {
  en: {
    settings: {
      pages: {
        providers: {
          catalog: {
            edit: {
              config: {
                'save-error': 'Unable to save provider configuration.',
              },
            },
          },
          provider: {
            'qwen-audio-realtime-transcription': {
              fields: {
                language: {
                  label: 'ASR language',
                  description: 'Select the language for speech recognition.',
                  placeholder: 'Select a language',
                  options: {
                    auto: 'Auto-detect',
                    zh: 'Chinese',
                    en: 'English',
                  },
                },
              },
              environment: 'This canary reads credentials from the Electron main process environment.',
            },
          },
        },
      },
    },
  },
}

describe('qwen audio realtime ASR hearing settings', () => {
  it('renders inside the Hearing provider view contract with the default language', async () => {
    const host = document.createElement('div')
    const errors: unknown[] = []
    const config = ref<Record<string, unknown>>({ language: 'auto' })
    const app = createApp({
      setup() {
        provide(hearingProviderViewContextKey, {
          providerConfig: computed(() => config.value),
          updateProviderConfig: async () => {},
        })
      },
      render: () => h(QwenHearingSettings),
    })
    app.config.errorHandler = error => errors.push(error)
    app.use(createI18n({ legacy: false, locale: 'en', messages }))

    app.mount(host)
    await nextTick()

    expect(errors).toEqual([])
    expect(host.querySelector('[data-testid="qwen-audio-realtime-language"]')).not.toBeNull()
    expect(host.textContent).toContain('ASR language')
    expect(host.textContent).toContain('This canary reads credentials from the Electron main process environment.')

    app.unmount()
  })
})
