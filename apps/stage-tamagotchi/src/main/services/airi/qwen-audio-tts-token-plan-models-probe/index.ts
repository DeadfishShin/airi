import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { QwenAudioTtsTokenPlanModelsProbeResponseClass, QwenAudioTtsTokenPlanModelsProbeResult } from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-models-probe-ipc'
import type { Lifecycle } from 'injeca'

import type { QwenAudioTtsTokenPlanCredentialService } from '../qwen-audio-tts-token-plan-credentials'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import {
  QWEN_AUDIO_TTS_TOKEN_PLAN_MODELS_PROBE_ENDPOINT,

  qwenAudioTtsTokenPlanProbeModels,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-models-probe-ipc'
import { ipcMain } from 'electron'

const PROBE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_MODEL_IDS = 128
const MAX_MODEL_ID_LENGTH = 128
const TTS_MODEL_IDS = new Set(['qwen-audio-3.0-tts-plus'])
const KNOWN_TEXT_ONLY_MODEL_IDS = new Set(['qwen-plus', 'qwen-turbo', 'qwen-max'])

type MainEventContext = ReturnType<typeof createContext>['context']
type ProbeFetch = typeof fetch

interface ProbeResponse {
  status: number
  headers: Headers
  body?: ReadableStream<Uint8Array> | null
  text: () => Promise<string>
}

export interface QwenAudioTtsTokenPlanModelsProbeOptions {
  context: MainEventContext
  credentialStore: Pick<QwenAudioTtsTokenPlanCredentialService, 'getRuntimeProfile'>
  lifecycle?: Lifecycle
  fetchImpl?: ProbeFetch
  timeoutMs?: number
}

function responseClassForStatus(status: number): QwenAudioTtsTokenPlanModelsProbeResponseClass | undefined {
  if (status === 401)
    return 'AUTH_401'
  if (status === 403)
    return 'AUTH_403'
  if (status === 404)
    return 'NOT_FOUND_404'
  if (status === 405)
    return 'METHOD_NOT_ALLOWED_405'
  return undefined
}

function sanitizedErrorClass(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError')
    return 'timeout'
  return 'network_error'
}

function isRedirectError(error: unknown): boolean {
  return error instanceof Error && /redirect/i.test(error.message)
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_MODEL_ID_LENGTH
    && /^[\w.:-]+$/.test(value)
}

type ModelRowsResult
  = { kind: 'non-model' }
    | { kind: 'malformed' }
    | { kind: 'models', rows: Array<{ id: string }> }

function modelRowsFromPayload(value: unknown): ModelRowsResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { kind: 'non-model' }
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data))
    return { kind: 'non-model' }
  const rows: Array<{ id: string }> = []
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !isModelId((item as { id?: unknown }).id))
      return { kind: 'malformed' }
    rows.push({ id: (item as { id: string }).id })
  }
  return { kind: 'models', rows }
}

function resultFromModels(response: ProbeResponse, payload: unknown): QwenAudioTtsTokenPlanModelsProbeResult {
  const parsed = modelRowsFromPayload(payload)
  if (parsed.kind === 'non-model') {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      responseClass: 'SUCCESS_NON_MODEL_PAYLOAD',
      modelIds: [],
      ttsModelIds: [],
      containsQwenAudioTtsPlus: false,
      errorClass: 'non_model_payload',
    }
  }
  if (parsed.kind === 'malformed') {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      responseClass: 'MALFORMED_RESPONSE',
      modelIds: [],
      ttsModelIds: [],
      containsQwenAudioTtsPlus: false,
      errorClass: 'malformed_model_rows',
    }
  }

  const rows = parsed.rows
  const modelIds = rows.slice(0, MAX_MODEL_IDS).map(row => row.id)
  const ttsModelIds = modelIds.filter(modelId => TTS_MODEL_IDS.has(modelId))
  const knownTextOnlyModels = modelIds.length > 0 && modelIds.every(modelId => KNOWN_TEXT_ONLY_MODEL_IDS.has(modelId))
  return {
    httpStatus: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    responseClass: rows.length === 0
      ? 'EMPTY_MODEL_LIST'
      : knownTextOnlyModels ? 'SUCCESS_TEXT_ONLY_MODELS' : 'SUCCESS_OPENAI_MODEL_LIST',
    modelIds,
    ttsModelIds,
    containsQwenAudioTtsPlus: ttsModelIds.includes('qwen-audio-3.0-tts-plus'),
  }
}

async function readBoundedText(response: ProbeResponse): Promise<string | undefined> {
  if (!response.body) {
    const text = await response.text()
    return new TextEncoder().encode(text).byteLength <= MAX_RESPONSE_BYTES ? text : undefined
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done)
        break
      size += next.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        return undefined
      }
      chunks.push(next.value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function runQwenAudioTtsTokenPlanModelsProbe(
  getRuntimeProfile: () => { apiKey: string },
  options: { fetchImpl?: ProbeFetch, timeoutMs?: number } = {},
): Promise<QwenAudioTtsTokenPlanModelsProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { apiKey } = getRuntimeProfile()
    const response = await fetchImpl(QWEN_AUDIO_TTS_TOKEN_PLAN_MODELS_PROBE_ENDPOINT, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      redirect: 'error',
      signal: controller.signal,
    }) as unknown as ProbeResponse

    const statusClass = responseClassForStatus(response.status)
    if (statusClass) {
      return {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        responseClass: statusClass,
        modelIds: [],
        ttsModelIds: [],
        containsQwenAudioTtsPlus: false,
      }
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        responseClass: 'NETWORK_ERROR',
        modelIds: [],
        ttsModelIds: [],
        containsQwenAudioTtsPlus: false,
        errorClass: `http_${response.status}`,
      }
    }

    const body = await readBoundedText(response)
    if (body === undefined) {
      return {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        responseClass: 'MALFORMED_RESPONSE',
        modelIds: [],
        ttsModelIds: [],
        containsQwenAudioTtsPlus: false,
        errorClass: 'response_too_large',
      }
    }

    try {
      return resultFromModels(response, JSON.parse(body) as unknown)
    }
    catch {
      return {
        httpStatus: response.status,
        contentType: response.headers.get('content-type') ?? undefined,
        responseClass: 'MALFORMED_RESPONSE',
        modelIds: [],
        ttsModelIds: [],
        containsQwenAudioTtsPlus: false,
        errorClass: 'malformed_json',
      }
    }
  }
  catch (error) {
    return {
      responseClass: isRedirectError(error) ? 'REDIRECT_REJECTED' : error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      modelIds: [],
      ttsModelIds: [],
      containsQwenAudioTtsPlus: false,
      errorClass: isRedirectError(error) ? 'redirect_rejected' : sanitizedErrorClass(error),
    }
  }
  finally {
    clearTimeout(timeout)
  }
}

export function createQwenAudioTtsTokenPlanModelsProbe(options: QwenAudioTtsTokenPlanModelsProbeOptions) {
  let inFlight: Promise<QwenAudioTtsTokenPlanModelsProbeResult> | undefined
  const fetchImpl = options.fetchImpl
  const timeoutMs = options.timeoutMs

  const probe = async () => {
    if (inFlight)
      throw new Error('Qwen Audio Token Plan model probe is already in progress.')
    inFlight = runQwenAudioTtsTokenPlanModelsProbe(options.credentialStore.getRuntimeProfile, { fetchImpl, timeoutMs })
    try {
      return await inFlight
    }
    finally {
      inFlight = undefined
    }
  }

  let disposeHandler = () => {}
  const dispose = () => {
    inFlight = undefined
    disposeHandler()
  }

  disposeHandler = defineInvokeHandler(options.context, qwenAudioTtsTokenPlanProbeModels, probe)
  options.lifecycle?.appHooks.onStop(dispose)
  return { probe, dispose }
}

export function setupQwenAudioTtsTokenPlanModelsProbe(options: Omit<QwenAudioTtsTokenPlanModelsProbeOptions, 'context' | 'credentialStore'> & { credentialStore: QwenAudioTtsTokenPlanCredentialService }) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioTtsTokenPlanModelsProbe({ ...options, context: eventa.context })
  return {
    ...service,
    dispose: () => {
      service.dispose()
      eventa.dispose()
    },
  }
}
