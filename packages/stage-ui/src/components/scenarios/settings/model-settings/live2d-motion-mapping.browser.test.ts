import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import Live2DSemanticMotionMapping from './live2d-motion-mapping.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: {} },
})

afterEach(() => cleanup())

describe('live2d semantic motion mapping', () => {
  it('shows actual motions and emits model-scoped manual and Auto/Unset changes', async () => {
    const screen = await render(Live2DSemanticMotionMapping, {
      props: {
        modelId: 'model-a',
        motions: [{
          name: 'foo.motion3.json',
          displayPath: 'motions/foo.motion3.json',
          group: '',
          index: 0,
        }],
        overrides: { 'motions/foo.motion3.json': 'happy' },
      },
      global: { plugins: [i18n] },
    })

    await expect.element(screen.getByText('foo.motion3.json', { exact: true })).toBeVisible()
    const mapping = screen.getByRole('combobox', { name: 'motions/foo.motion3.json' })
    await mapping.selectOptions(['angry'])
    await mapping.selectOptions([''])

    expect(screen.emitted('update')).toEqual([
      ['motions/foo.motion3.json', 'angry'],
      ['motions/foo.motion3.json', ''],
    ])
  })
})
