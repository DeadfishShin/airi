import type { Eventa, EventContext } from '@moeru/eventa'
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type {
  QwenAudioRealtimeAsrLanguage,
  QwenAudioRealtimeAudioPayload,
  QwenAudioRealtimeErrorPayload,
  QwenAudioRealtimeSessionPayload,
  QwenAudioRealtimeTranscriptionPayload,
} from '../../qwen-audio-realtime-ipc'
import type { AIRIStreamTranscriptionDelta, AIRIStreamTranscriptionResult, StreamTranscriptionOptions } from '../../stream-transcription'
import type { ProviderConfigContext } from '../../types'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isElectronWindow, isStageTamagotchi } from '@proj-airi/stage-shared'
import { z } from 'zod'

import {
  qwenAudioRealtimeAudioAppend,
  qwenAudioRealtimeSessionCancel,
  qwenAudioRealtimeSessionError,
  qwenAudioRealtimeSessionFinish,
  qwenAudioRealtimeSessionFinished,
  qwenAudioRealtimeSessionStart,
  qwenAudioRealtimeTranscriptionFinal,
  qwenAudioRealtimeTranscriptionPartial,
} from '../../qwen-audio-realtime-ipc'
import { streamTranscription } from '../../stream-transcription'
import { defineProvider } from '../registry'

export const QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID = 'qwen-audio-realtime-transcription'

const qwenAudioRealtimeConfigSchema = z.object({
  language: z.enum(['auto', 'zh', 'en']).default('auto'),
  model: z.literal('qwen-audio-3.0-asr-flash-streaming').default('qwen-audio-3.0-asr-flash-streaming'),
})

export type QwenAudioRealtimeConfig = z.input<typeof qwenAudioRealtimeConfigSchema>

export interface QwenAudioRealtimeProviderOptions {
  abortSignal?: AbortSignal
  /** Request language overrides the cached provider configuration. */
  language?: QwenAudioRealtimeAsrLanguage
}

function isQwenAudioRealtimeLanguage(value: unknown): value is QwenAudioRealtimeAsrLanguage {
  return value === 'auto' || value === 'zh' || value === 'en'
}

/** Normalizes UI/provider language values to the official Qwen ASR options. */
export function normalizeQwenAudioRealtimeLanguage(value: unknown): QwenAudioRealtimeAsrLanguage {
  return isQwenAudioRealtimeLanguage(value) ? value : 'auto'
}

function audioChunkToArrayBuffer(chunk: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (chunk instanceof ArrayBuffer)
    return chunk.slice(0)

  const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return bytes.slice().buffer
}

function transcriptSnapshot(
  event: QwenAudioRealtimeTranscriptionPayload,
  isFinal: boolean,
): AIRIStreamTranscriptionDelta {
  return {
    durationMilliseconds: event.durationMilliseconds,
    isFinal,
    locale: 'auto',
    startMilliseconds: event.startMilliseconds,
    text: event.text,
    type: 'transcript.text.snapshot',
  }
}

interface QwenAudioRealtimeStreamOptions extends StreamTranscriptionOptions {
  inputAudioStream: ReadableStream<ArrayBuffer>
  eventContext: EventContext<any, any>
  language: QwenAudioRealtimeAsrLanguage
}

function createQwenAudioRealtimeResponseBody(options: {
  abortSignal?: AbortSignal
  eventContext: EventContext<any, any>
  inputAudioStream: ReadableStream<ArrayBuffer>
  language: QwenAudioRealtimeAsrLanguage
}) {
  const { eventContext, inputAudioStream, language, abortSignal } = options
  const start = defineInvoke(eventContext, qwenAudioRealtimeSessionStart)
  const append = defineInvoke(eventContext, qwenAudioRealtimeAudioAppend)
  const finish = defineInvoke(eventContext, qwenAudioRealtimeSessionFinish)
  const cancel = defineInvoke(eventContext, qwenAudioRealtimeSessionCancel)
  const sessionId = globalThis.crypto?.randomUUID?.() ?? `qwen-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const encoder = new TextEncoder()

  const responseBody = new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false
      let onAbort = () => {}
      let reader: ReadableStreamDefaultReader<ArrayBuffer> | undefined
      const disposers: Array<() => void> = []

      const cleanup = () => {
        for (const dispose of disposers)
          dispose()
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
        controller.error(error instanceof Error ? error : new Error('Qwen Audio realtime ASR failed.'))
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

      const listen = <Payload>(
        event: Eventa<Payload>,
        handler: (payload: Payload) => void,
      ) => {
        const dispose = eventContext.on(event, (received) => {
          handler((received as { body: Payload }).body)
        })
        disposers.push(dispose)
      }

      listen<QwenAudioRealtimeTranscriptionPayload>(qwenAudioRealtimeTranscriptionPartial, (event) => {
        if (event.sessionId === sessionId)
          emit(transcriptSnapshot(event, false))
      })
      listen<QwenAudioRealtimeTranscriptionPayload>(qwenAudioRealtimeTranscriptionFinal, (event) => {
        if (event.sessionId === sessionId)
          emit(transcriptSnapshot(event, true))
      })
      listen<QwenAudioRealtimeSessionPayload>(qwenAudioRealtimeSessionFinished, (event) => {
        if (event.sessionId === sessionId)
          close()
      })
      listen<QwenAudioRealtimeErrorPayload>(qwenAudioRealtimeSessionError, (event) => {
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

          await start({ sessionId, language })
          reader = inputAudioStream.getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done || settled)
              break
            await append({ sessionId, audio: audioChunkToArrayBuffer(value) } satisfies QwenAudioRealtimeAudioPayload)
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
  return responseBody
}

/**
 * Bridges AIRI's streaming fetch abstraction to the main-process Eventa
 * session. The renderer never receives credentials or opens a Qwen socket.
 */
export function executeQwenAudioRealtimeStream(options: QwenAudioRealtimeStreamOptions): AIRIStreamTranscriptionResult {
  return streamTranscription({
    baseURL: options.baseURL,
    inputAudioStream: options.inputAudioStream,
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body || !(init.body instanceof ReadableStream))
        throw new TypeError('Qwen Audio realtime ASR requires a streaming audio body.')

      return new Response(createQwenAudioRealtimeResponseBody({
        abortSignal: init.signal ?? options.abortSignal,
        eventContext: options.eventContext,
        inputAudioStream: init.body as ReadableStream<ArrayBuffer>,
        language: options.language,
      }), {
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/event-stream',
        },
      })
    },
    abortSignal: options.abortSignal,
  })
}

function isQwenAudioRealtimeAvailable() {
  return isStageTamagotchi()
    && typeof window !== 'undefined'
    && isElectronWindow(window)
    && window.platform === 'darwin'
}

function createRendererQwenAudioRealtimeProvider(config: QwenAudioRealtimeConfig) {
  if (typeof window === 'undefined' || !isElectronWindow(window))
    throw new Error('Qwen Audio realtime ASR requires the Electron desktop app.')

  const eventa = createContext(window.electron.ipcRenderer)
  return createQwenAudioRealtimeProviderForContext(config, eventa.context, () => eventa.dispose())
}

/** Creates the renderer-side provider around an already-bound Eventa context. */
export function createQwenAudioRealtimeProviderForContext(
  config: QwenAudioRealtimeConfig,
  eventContext: EventContext<any, any>,
  dispose: () => void = () => {},
) {
  const configuredLanguage = () => normalizeQwenAudioRealtimeLanguage(config.language)

  return {
    transcription(model: string, extraOptions: QwenAudioRealtimeProviderOptions = {}) {
      const requestedModel = model.trim() || 'qwen-audio-3.0-asr-flash-streaming'
      if (requestedModel !== 'qwen-audio-3.0-asr-flash-streaming')
        throw new Error(`Unsupported Qwen Audio realtime ASR model: ${requestedModel}`)

      const language = normalizeQwenAudioRealtimeLanguage(extraOptions.language ?? configuredLanguage())
      return {
        baseURL: new URL('qwen-audio-realtime://session'),
        model: requestedModel,
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (!init?.body || !(init.body instanceof ReadableStream))
            throw new TypeError('Qwen Audio realtime ASR requires a streaming audio body.')

          return new Response(createQwenAudioRealtimeResponseBody({
            eventContext,
            inputAudioStream: init.body as ReadableStream<ArrayBuffer>,
            language,
            abortSignal: init.signal ?? undefined,
          }), {
            headers: {
              'Cache-Control': 'no-cache',
              'Content-Type': 'text/event-stream',
            },
          })
        },
      }
    },
    dispose() {
      dispose()
    },
  } as TranscriptionProviderWithExtraOptions<string, QwenAudioRealtimeProviderOptions> & { dispose: () => void }
}

export const providerQwenAudioRealtimeTranscription = defineProvider<QwenAudioRealtimeConfig>({
  id: QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID,
  name: 'Qwen Audio realtime ASR',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-realtime-transcription.title'),
  description: 'Alibaba Cloud Model Studio realtime speech recognition canary.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.qwen-audio-realtime-transcription.description'),
  tasks: ['speech-to-text', 'automatic-speech-recognition', 'asr', 'stt', 'streaming-transcription'],
  icon: 'i-simple-icons:alibabacloud',
  requiresCredentials: false,
  isAvailableBy: isQwenAudioRealtimeAvailable,
  views: {
    hearing: () => import('./hearing-settings.vue'),
  },
  capabilities: {
    transcription: {
      protocol: 'websocket',
      generateOutput: false,
      streamOutput: true,
      streamInput: true,
    },
  },
  createProviderConfig: (_context: ProviderConfigContext<QwenAudioRealtimeConfig>) => qwenAudioRealtimeConfigSchema,
  createProvider: createRendererQwenAudioRealtimeProvider,
  validationRequiredWhen: () => false,
  extraMethods: {
    listModels: async () => [{
      id: 'qwen-audio-3.0-asr-flash-streaming',
      name: 'Qwen Audio 3.0 ASR Flash Streaming',
      provider: QWEN_AUDIO_REALTIME_ASR_PROVIDER_ID,
      description: 'Realtime streaming speech recognition through Alibaba Cloud Model Studio.',
      contextLength: 0,
      deprecated: false,
    }],
  },
})
