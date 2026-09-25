import type { EventContext } from '@moeru/eventa'
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type {
  QwenAudioRealtimeTokenPlanAsrLanguage,
  QwenAudioRealtimeTokenPlanAudioPayload,
  QwenAudioRealtimeTokenPlanErrorPayload,
  QwenAudioRealtimeTokenPlanSessionPayload,
  QwenAudioRealtimeTokenPlanTranscriptionPayload,
} from '../../qwen-audio-realtime-token-plan-ipc'
import type { QwenAudioRealtimeTokenPlanAsrModelId } from '../../qwen-audio-realtime-token-plan-models'
import type { AIRIStreamTranscriptionDelta, StreamTranscriptionOptions } from '../../stream-transcription'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID,
  qwenAudioRealtimeTokenPlanAudioAppend,
  qwenAudioRealtimeTokenPlanSessionCancel,
  qwenAudioRealtimeTokenPlanSessionError,
  qwenAudioRealtimeTokenPlanSessionFinish,
  qwenAudioRealtimeTokenPlanSessionFinished,
  qwenAudioRealtimeTokenPlanSessionStart,
  qwenAudioRealtimeTokenPlanTranscription,
} from '../../qwen-audio-realtime-token-plan-ipc'
import {
  normalizeQwenAudioRealtimeTokenPlanAsrModel,
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL,
  QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_CATALOG,
} from '../../qwen-audio-realtime-token-plan-models'
import { defineProvider } from '../registry'

export { QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID }

const configSchema = z.object({
  language: z.enum(['auto', 'zh', 'en']).default('auto'),
  model: z.string().default(QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL).transform(value => normalizeQwenAudioRealtimeTokenPlanAsrModel(value)),
})

export type QwenAudioRealtimeTokenPlanConfig = z.input<typeof configSchema>

export interface QwenAudioRealtimeTokenPlanProviderOptions {
  abortSignal?: AbortSignal
  language?: QwenAudioRealtimeTokenPlanAsrLanguage
}

function normalizeLanguage(value: unknown): QwenAudioRealtimeTokenPlanAsrLanguage {
  return value === 'zh' || value === 'en' ? value : 'auto'
}

interface TokenPlanStreamOptions extends StreamTranscriptionOptions {
  eventContext: EventContext<any, any>
  inputAudioStream: ReadableStream<ArrayBuffer>
  language: QwenAudioRealtimeTokenPlanAsrLanguage
  model: QwenAudioRealtimeTokenPlanAsrModelId
}

function audioChunkToArrayBuffer(chunk: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (chunk instanceof ArrayBuffer)
    return chunk.slice(0)
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength).slice().buffer
}

function snapshot(event: QwenAudioRealtimeTokenPlanTranscriptionPayload, isFinal: boolean): AIRIStreamTranscriptionDelta {
  return {
    durationMilliseconds: 0,
    isFinal,
    locale: 'auto',
    startMilliseconds: 0,
    text: event.text,
    type: 'transcript.text.snapshot',
  }
}

function createResponseBody(options: TokenPlanStreamOptions) {
  const { eventContext, inputAudioStream, language, model, abortSignal } = options
  const start = defineInvoke(eventContext, qwenAudioRealtimeTokenPlanSessionStart)
  const append = defineInvoke(eventContext, qwenAudioRealtimeTokenPlanAudioAppend)
  const finish = defineInvoke(eventContext, qwenAudioRealtimeTokenPlanSessionFinish)
  const cancel = defineInvoke(eventContext, qwenAudioRealtimeTokenPlanSessionCancel)
  const sessionId = globalThis.crypto?.randomUUID?.() ?? `token-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false
      let onAbort = () => {}
      let reader: ReadableStreamDefaultReader<ArrayBuffer> | undefined
      const disposers: Array<() => void> = []
      const cleanup = () => {
        disposers.forEach(dispose => dispose())
        disposers.length = 0
        abortSignal?.removeEventListener('abort', onAbort)
      }
      const close = () => {
        if (settled)
          return
        settled = true
        cleanup()
        controller.close()
      }
      const fail = (error: unknown) => {
        if (settled)
          return
        settled = true
        cleanup()
        controller.error(error instanceof Error ? error : new Error('Token Plan realtime ASR failed.'))
      }
      const emit = (event: AIRIStreamTranscriptionDelta) => {
        if (!settled)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      onAbort = () => {
        void cancel({ sessionId }).catch(() => {})
        void reader?.cancel(abortSignal?.reason)
        fail(abortSignal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      const listen = <Payload>(event: any, handler: (payload: Payload) => void) => {
        disposers.push(eventContext.on(event, received => handler((received as { body?: Payload }).body as Payload)))
      }

      listen<QwenAudioRealtimeTokenPlanTranscriptionPayload>(qwenAudioRealtimeTokenPlanTranscription, (event) => {
        if (event.sessionId === sessionId)
          emit(snapshot(event, event.isFinal))
      })
      listen<QwenAudioRealtimeTokenPlanSessionPayload>(qwenAudioRealtimeTokenPlanSessionFinished, (event) => {
        if (event.sessionId === sessionId)
          close()
      })
      listen<QwenAudioRealtimeTokenPlanErrorPayload>(qwenAudioRealtimeTokenPlanSessionError, (event) => {
        if (event.sessionId === sessionId)
          fail(new Error(event.message))
      })
      abortSignal?.addEventListener('abort', onAbort, { once: true })
      void (async () => {
        try {
          if (abortSignal?.aborted) {
            onAbort()
            return
          }
          await start({ sessionId, language, model })
          reader = inputAudioStream.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done || settled)
              break
            await append({ sessionId, audio: audioChunkToArrayBuffer(value) } satisfies QwenAudioRealtimeTokenPlanAudioPayload)
          }
          if (!settled)
            await finish({ sessionId })
        }
        catch (error) {
          fail(error)
        }
        finally {
          reader?.releaseLock()
        }
      })()
    },
    cancel() {
      void cancel({ sessionId }).catch(() => {})
    },
  })
}

function createProvider(config: QwenAudioRealtimeTokenPlanConfig) {
  if (typeof window === 'undefined' || !isElectronWindow(window))
    throw new Error('Qwen Audio realtime Token Plan ASR requires the Electron desktop app.')

  const eventa = createContext(window.electron.ipcRenderer)
  return createQwenAudioRealtimeTokenPlanProviderForContext(config, eventa.context, () => eventa.dispose())
}

export function createQwenAudioRealtimeTokenPlanProviderForContext(
  config: QwenAudioRealtimeTokenPlanConfig,
  eventContext: EventContext<any, any>,
  dispose: () => void = () => {},
) {
  const language = () => normalizeLanguage(config.language)
  const model = () => normalizeQwenAudioRealtimeTokenPlanAsrModel(config.model)
  const provider = {
    transcription(requestedModel: string, options: QwenAudioRealtimeTokenPlanProviderOptions = {}) {
      const selectedModel = normalizeQwenAudioRealtimeTokenPlanAsrModel(requestedModel.trim() || model())
      const selectedLanguage = normalizeLanguage(options.language ?? language())
      return {
        baseURL: new URL('qwen-audio-realtime-token-plan://session'),
        model: selectedModel,
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.body || !(init.body instanceof ReadableStream))
            throw new TypeError('Qwen Audio realtime Token Plan ASR requires a streaming audio body.')
          return new Response(createResponseBody({
            abortSignal: init.signal ?? options.abortSignal,
            eventContext,
            inputAudioStream: init.body as ReadableStream<ArrayBuffer>,
            language: selectedLanguage,
            model: selectedModel,
          }), { headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' } })
        },
      }
    },
    dispose() {
      dispose()
    },
  } as TranscriptionProviderWithExtraOptions<string, QwenAudioRealtimeTokenPlanProviderOptions> & { dispose: () => void }
  return provider
}

function isAvailable() {
  return isStageTamagotchi() && typeof window !== 'undefined' && isElectronWindow(window) && window.platform === 'darwin'
}

export const providerQwenAudioRealtimeTokenPlanTranscription = defineProvider<QwenAudioRealtimeTokenPlanConfig>({
  id: QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID,
  name: 'Qwen Audio 3.0 Realtime Plus — Token Plan',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.title'),
  description: 'Token Plan speech recognition with transcript-only output.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-realtime-token-plan-transcription.description'),
  tasks: ['speech-to-text', 'automatic-speech-recognition', 'asr', 'stt', 'streaming-transcription'],
  icon: 'i-simple-icons:alibabacloud',
  requiresCredentials: false,
  isAvailableBy: isAvailable,
  views: { hearing: () => import('./hearing-settings.vue') },
  capabilities: { transcription: { protocol: 'websocket', generateOutput: false, streamOutput: true, streamInput: true } },
  createProviderConfig: () => configSchema,
  createProvider,
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async () => QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_MODEL_CATALOG.map(item => ({
      id: item.id,
      name: item.name,
      provider: QWEN_AUDIO_REALTIME_TOKEN_PLAN_ASR_PROVIDER_ID,
      description: item.description,
      contextLength: 0,
      deprecated: false,
    })),
  },
})

export { normalizeQwenAudioRealtimeTokenPlanAsrModel }
