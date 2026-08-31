import HearingPlaygroundTranscripts from '@proj-airi/stage-pages/pages/settings/modules/components/hearing-playground-transcripts.vue'

import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
      en: {
        settings: {
          pages: {
            modules: {
              hearing: {
                sections: {
                  section: {
                    playground: {
                      'current': 'Current transcript',
                      'empty': 'Start monitoring and speak into the selected microphone.',
                      'listening': 'Listening for speech…',
                      'speech-detected': 'Speech detected. Waiting for the first transcript.',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
}

function renderPlayground(props: {
  current: string
  isMonitoring: boolean
  isSpeech: boolean
  segments: readonly { id: number, text: string, status: 'complete' | 'empty' | 'error' | 'transcribing' }[]
}) {
  return render(HearingPlaygroundTranscripts, {
    props,
    global: {
      directives: {
        'auto-animate': () => {},
      },
      plugins: [createTestI18n()],
    },
  })
}

describe('hearing playground transcription state', () => {
  it('does not show the idle waiting state after VAD detects speech', async () => {
    const screen = await renderPlayground({ current: '', isMonitoring: true, isSpeech: true, segments: [] })

    expect(screen.container.textContent).not.toContain('Listening for speech…')
    expect(screen.container.textContent).toContain('Speech detected. Waiting for the first transcript.')
  })

  it('renders the current snapshot and replaces it without duplication', async () => {
    const screen = await renderPlayground({ current: '你好', isMonitoring: true, isSpeech: true, segments: [] })

    expect(screen.container.textContent).toContain('你好')
    expect(screen.container.textContent).not.toContain('Listening for speech…')

    await screen.rerender({ current: '你好世界' })

    expect(screen.container.textContent).toContain('你好世界')
    expect(screen.container.textContent).not.toContain('你好你好世界')
    expect(screen.container.textContent?.match(/你好/g)).toHaveLength(1)
  })

  it('shows the finalized segment after the partial snapshot clears', async () => {
    const screen = await renderPlayground({
      current: '',
      isMonitoring: true,
      isSpeech: false,
      segments: [{ id: 1, text: '最终文本', status: 'complete' }],
    })

    expect(screen.container.textContent).toContain('最终文本')
    expect(screen.container.textContent).not.toContain('Listening for speech…')
  })
})
