import messages from '@proj-airi/i18n/locales'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import Live2DSemanticMotionMapping from './live2d-motion-mapping.vue'

const motions = [{
  name: 'foo.motion3.json',
  displayPath: 'motions/foo.motion3.json',
  group: '',
  index: 0,
}]

function createTestI18n(locale: 'en' | 'zh-Hans' | 'zh-Hant') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  })
}

function optionTexts(screen: Awaited<ReturnType<typeof render>>) {
  return [...screen.container.querySelectorAll('option')].map(option => option.textContent)
}

function optionValues(screen: Awaited<ReturnType<typeof render>>) {
  return [...screen.container.querySelectorAll('option')].map(option => option.getAttribute('value'))
}

afterEach(() => cleanup())

describe('live2d semantic motion mapping', () => {
  it('localizes semantic labels without changing their canonical values', async () => {
    const screen = await render(Live2DSemanticMotionMapping, {
      props: {
        modelId: 'model-a',
        motions,
        overrides: { 'motions/foo.motion3.json': 'happy' },
      },
      global: { plugins: [createTestI18n('zh-Hans')] },
    })

    await expect.element(screen.getByText('foo.motion3.json', { exact: true })).toBeVisible()
    expect(optionTexts(screen)).toEqual(['自动 / 未设置', '待机', '开心', '悲伤', '生气', '思考', '惊讶', '尴尬', '疑问', '好奇'])
    expect(optionValues(screen)).toEqual(['', 'idle', 'happy', 'sad', 'angry', 'think', 'surprise', 'awkward', 'question', 'curious'])

    const mapping = screen.getByRole('combobox', { name: 'motions/foo.motion3.json' })
    await mapping.selectOptions(['angry'])
    await mapping.selectOptions([''])

    expect(screen.emitted('update')).toEqual([
      ['motions/foo.motion3.json', 'angry'],
      ['motions/foo.motion3.json', ''],
    ])
  })

  it.each([
    ['en', ['Auto / Unset', 'Idle', 'Happy', 'Sad', 'Angry', 'Think', 'Surprise', 'Awkward', 'Question', 'Curious']],
    ['zh-Hant', ['自動 / 未設定', '待機', '開心', '悲傷', '生氣', '思考', '驚訝', '尷尬', '疑問', '好奇']],
  ] as const)('renders the %s semantic labels', async (locale, labels) => {
    const screen = await render(Live2DSemanticMotionMapping, {
      props: { modelId: 'model-a', motions, overrides: {} },
      global: { plugins: [createTestI18n(locale)] },
    })

    expect(optionTexts(screen)).toEqual(labels)
    expect(optionValues(screen)).toEqual(['', 'idle', 'happy', 'sad', 'angry', 'think', 'surprise', 'awkward', 'question', 'curious'])
  })

  it('keeps persisted semantic values unchanged when the display language changes', async () => {
    const screen = await render(Live2DSemanticMotionMapping, {
      props: {
        modelId: 'model-a',
        motions,
        overrides: { 'motions/foo.motion3.json': 'happy' },
      },
      global: { plugins: [createTestI18n('zh-Hans')] },
    })

    const mapping = screen.getByRole('combobox', { name: 'motions/foo.motion3.json' })
    expect((mapping.element() as HTMLSelectElement).value).toBe('happy')
    await mapping.selectOptions(['angry'])
    expect(screen.emitted('update')?.at(-1)).toEqual(['motions/foo.motion3.json', 'angry'])
  })
})
