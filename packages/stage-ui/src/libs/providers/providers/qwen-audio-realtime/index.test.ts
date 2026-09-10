import type { QwenAudioRealtimeSessionStartPayload } from '../../qwen-audio-realtime-ipc'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createQwenAudioRealtimeProviderForContext,
  executeQwenAudioRealtimeStream,
  normalizeQwenAudioRealtimeLanguage,
  providerQwenAudioRealtimeTranscription,
  QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID,
} from '.'
import { useHearingPlaygroundSegments } from '../../../../composables/use-hearing-playground-segments'
import { StreamingTranscriptionConsumers } from '../../../../stores/modules/streaming-transcription-consumers'
import {
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionFinished,
  qwenAudioRealtimeSessionStart,
  qwenAudioRealtimeTranscriptionFinal,
  qwenAudioRealtimeTranscriptionPartial,
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
    expect(starts[0]?.model).toBe(model)
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

  it('normalizes a stale persisted model to the current canonical default', async () => {
    const config = z.parse(await providerQwenAudioRealtimeTranscription.createProviderConfig({ t: input => input }), {
      language: 'en',
      model: 'stale-qwen-model',
    })

    expect(config).toEqual({ language: 'en', model })
  })

  it('delivers Qwen snapshots to the Hearing Playground consumer without duplication', async () => {
    const context = createContext()
    const disposeStart = defineInvokeHandler(context, qwenAudioRealtimeSessionStart, async ({ sessionId: startedSessionId }) => {
      await context.emit(qwenAudioRealtimeTranscriptionPartial, {
        durationMilliseconds: 100,
        sentenceId: 1,
        sessionId: startedSessionId,
        startMilliseconds: 0,
        text: '你好',
      })
      await context.emit(qwenAudioRealtimeTranscriptionPartial, {
        durationMilliseconds: 200,
        sentenceId: 1,
        sessionId: startedSessionId,
        startMilliseconds: 0,
        text: '你好世界',
      })
      await context.emit(qwenAudioRealtimeTranscriptionFinal, {
        durationMilliseconds: 200,
        sentenceId: 1,
        sessionId: startedSessionId,
        startMilliseconds: 0,
        text: '你好世界',
      })
      await context.emit(qwenAudioRealtimeSessionFinished, { sessionId: startedSessionId })
    })
    const disposeAudio = defineInvokeHandler(context, qwenAudioRealtimeAudioAppend, () => {})
    const disposeFinish = defineInvokeHandler(context, qwenAudioRealtimeSessionFinish, () => {})
    const result = executeQwenAudioRealtimeStream({
      baseURL: new URL('qwen-audio-realtime://session'),
      eventContext: context,
      inputAudioStream: new ReadableStream<ArrayBuffer>({
        start(controller) {
          controller.close()
        },
      }),
      language: 'auto',
    })
    const playground = useHearingPlaygroundSegments()
    const consumers = new StreamingTranscriptionConsumers()
    consumers.register({
      consumerId: 'hearing-playground',
      onSpeechEnd: text => playground.finishStreaming(text),
      onTranscriptionUpdate: text => playground.replaceStreamingText(text),
    })
    const snapshots: string[] = []
    let firstPartialWasVisible = false
    for await (const update of result.fullStream) {
      if (update.type === 'transcript.text.snapshot') {
        snapshots.push(update.text)
        consumers.emitTranscriptionUpdate(update.text)
        if (snapshots.length === 1)
          firstPartialWasVisible = playground.current.value === '你好'
      }
    }

    consumers.emitSpeechEnd(await result.text)

    expect(snapshots).toEqual(['你好', '你好世界', '你好世界'])
    expect(firstPartialWasVisible).toBe(true)
    expect(playground.current.value).toBe('')
    expect(playground.segments.value).toEqual([
      { id: 1, text: '你好世界', status: 'complete' },
    ])

    disposeStart()
    disposeAudio()
    disposeFinish()
    context.abort()
  })
})
