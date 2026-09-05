import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'

import Qwen3RealtimeStreamingPreview from './Qwen3RealtimeStreamingPreview.vue'

const mounted: Array<ReturnType<typeof createApp>> = []

async function mount() {
  const host = document.createElement('div')
  const app = createApp(Qwen3RealtimeStreamingPreview, {
    model: 'qwen3-tts-flash-realtime',
    voice: 'Jada',
    text: 'Hello from preview',
    maxChars: 280,
    busy: false,
  })
  app.mount(host)
  mounted.push(app)
  await nextTick()
  return host
}

afterEach(() => {
  for (const app of mounted.splice(0))
    app.unmount()
})

describe('qwen3 streaming preview settings UI', () => {
  it('provides an actionable preview control with the selected model and provider voice', async () => {
    const host = await mount()
    expect(host.querySelector('[data-testid="qwen3-realtime-streaming-preview"]')).not.toBeNull()
    expect(host.textContent).toContain('qwen3-tts-flash-realtime')
    expect(host.textContent).toContain('Jada')
    expect(host.textContent).toContain('Preview/Test voice')
    expect(host.textContent).not.toContain('Realtime preview unavailable here')
  })

  it('emits only after an explicit click and blocks an empty preview', async () => {
    const events: string[] = []
    const host = document.createElement('div')
    const app = createApp(Qwen3RealtimeStreamingPreview, {
      model: 'qwen3-tts-flash-realtime',
      voice: 'Cherry',
      text: '',
      maxChars: 280,
      busy: false,
      onPreview: () => events.push('preview'),
    })
    app.mount(host)
    mounted.push(app)
    await nextTick()

    const button = host.querySelector<HTMLButtonElement>('button')!
    expect(button.disabled).toBe(true)
    expect(events).toEqual([])
  })

  it('emits the preview action on an explicit click when the bounded input is valid', async () => {
    const events: string[] = []
    const host = document.createElement('div')
    const app = createApp(Qwen3RealtimeStreamingPreview, {
      model: 'qwen3-tts-instruct-flash-realtime',
      voice: 'Cherry',
      text: 'A bounded preview',
      maxChars: 280,
      busy: false,
      onPreview: () => events.push('preview'),
    })
    app.mount(host)
    mounted.push(app)
    await nextTick()

    host.querySelector<HTMLButtonElement>('button')!.click()
    expect(events).toEqual(['preview'])
  })
})
