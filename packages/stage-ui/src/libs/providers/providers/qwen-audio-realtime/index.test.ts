import type { QwenAudioRealtimeSessionStartPayload } from '../../qwen-audio-realtime-ipc'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createQwenAudioRealtimeProviderForContext,
  normalizeQwenAudioRealtimeLanguage,
  providerQwenAudioRealtimeTranscription,
  QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID,
} from '.'
import {
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionStart,
} from '../../qwen-audio-realtime-ipc'

const model = 'qwen-audio-3.0-asr-flash-streaming'

describe('qwen Audio realtime ASR provider', () => {
  it('uses the dedicated streaming model and defaults language to auto', async () => {
    const config = z.parse(await providerQwenAudioRealtimeTranscription.createProviderConfig({ t: input => input }), {})
    const models = await providerQwenAudioRealtimeTranscription.extraMethods?.listModels?.(config, undefined as never)

    expect(config).toEqual({ language: 'auto', model })
    expect(QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID).toBe('qwen-audio-realtime-transcription')
    expect(models?.map(item => item.id)).toEqual([model])
    expect(providerQwenAudioRealtimeTranscription.capabilities?.transcription).toEqual({
      protocol: 'websocket',
      generateOutput: false,
      streamOutput: true,
      streamInput: true,
    })
  })

  it('lets the current invocation language override cached provider configuration', async () => {
    const context = createContext()
    const starts: QwenAudioRealtimeSessionStartPayload[] = []
    const audio: ArrayBuffer[] = []
    let finishes = 0

    const disposeStart = defineInvokeHandler(context, qwenAudioRealtimeSessionStart, (payload) => {
      starts.push(payload)
    })
    const disposeAudio = defineInvokeHandler(context, qwenAudioRealtimeAudioAppend, (payload) => {
      audio.push(payload.audio)
    })
    const disposeFinish = defineInvokeHandler(context, qwenAudioRealtimeSessionFinish, () => {
      finishes++
    })

    const provider = createQwenAudioRealtimeProviderForContext({ language: 'auto', model }, context)
    const request = provider.transcription(model, { language: 'zh' })
    const response = await request.fetch?.(new URL('qwen-audio-realtime://session'), {
      body: new ReadableStream<ArrayBuffer>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]).buffer)
          controller.close()
        },
      }),
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(starts[0]?.language).toBe('zh')
    expect(audio).toHaveLength(1)
    expect(new Uint8Array(audio[0] ?? [])).toEqual(new Uint8Array([1, 2, 3]))
    expect(finishes).toBe(1)
    expect(JSON.stringify(request)).not.toContain('DASHSCOPE_API_KEY')
    expect(response?.headers.get('Content-Type')).toContain('text/event-stream')

    await response?.body?.cancel()
    disposeStart()
    disposeAudio()
    disposeFinish()
    context.abort()
  })

  it('keeps the configured language when no request override is supplied', () => {
    expect(normalizeQwenAudioRealtimeLanguage('en')).toBe('en')
    expect(normalizeQwenAudioRealtimeLanguage('unsupported')).toBe('auto')
  })
})
