import type { QwenAudioRealtimeTokenPlanSessionStartPayload } from '../../qwen-audio-realtime-token-plan-ipc'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createQwenAudioRealtimeTokenPlanProviderForContext,
  providerQwenAudioRealtimeTokenPlanTranscription,
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID,
} from '.'
import {
  qwenAudioRealtimeTokenPlanAudioAppend,
  qwenAudioRealtimeTokenPlanSessionFinish,
  qwenAudioRealtimeTokenPlanSessionFinished,
  qwenAudioRealtimeTokenPlanSessionStart,
} from '../../qwen-audio-realtime-token-plan-ipc'

const model = 'qwen-audio-3.0-realtime-plus'

describe('qwen Audio realtime Token Plan ASR provider', () => {
  it('registers the transcript-only model and keeps the Token Plan route explicit', async () => {
    const config = z.parse(await providerQwenAudioRealtimeTokenPlanTranscription.createProviderConfig({ t: input => input }), {})
    const models = await providerQwenAudioRealtimeTokenPlanTranscription.extraMethods?.listModels?.(config, undefined as never)

    expect(config).toEqual({ language: 'auto', model })
    expect(QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID).toBe('qwen-audio-realtime-token-plan-transcription')
    expect(models?.map(item => item.id)).toEqual([model])
    expect(providerQwenAudioRealtimeTokenPlanTranscription.capabilities?.transcription).toEqual({
      protocol: 'websocket',
      generateOutput: false,
      streamOutput: true,
      streamInput: true,
    })
  })

  it('bridges audio to the main-process session without exposing credentials', async () => {
    const context = createContext()
    const starts: QwenAudioRealtimeTokenPlanSessionStartPayload[] = []
    const audio: ArrayBuffer[] = []
    let finishes = 0

    const disposeStart = defineInvokeHandler(context, qwenAudioRealtimeTokenPlanSessionStart, (payload) => {
      starts.push(payload)
    })
    const disposeAudio = defineInvokeHandler(context, qwenAudioRealtimeTokenPlanAudioAppend, (payload) => {
      audio.push(payload.audio)
    })
    const disposeFinish = defineInvokeHandler(context, qwenAudioRealtimeTokenPlanSessionFinish, async ({ sessionId }) => {
      finishes++
      await context.emit(qwenAudioRealtimeTokenPlanSessionFinished, { sessionId })
    })

    const provider = createQwenAudioRealtimeTokenPlanProviderForContext(z.parse(await providerQwenAudioRealtimeTokenPlanTranscription.createProviderConfig({ t: input => input }), {}), context)
    const request = provider.transcription(model, { language: 'zh' })
    const response = await request.fetch?.(new URL('qwen-audio-realtime-token-plan://session'), {
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
    expect(JSON.stringify(request)).not.toContain('sk-sp-')
    expect(response?.headers.get('Content-Type')).toContain('text/event-stream')

    await response?.body?.cancel()
    provider.dispose()
    disposeStart()
    disposeAudio()
    disposeFinish()
    context.abort()
  })
})
