import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenAudioAsrTokenPlanProbeResponseClass,
  QwenAudioAsrTokenPlanProbeResult,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-asr-token-plan-capability-probe-ipc'
import type { Lifecycle } from 'injeca'

import type { QwenAudioTtsTokenPlanCredentialService } from '../qwen-audio-tts-token-plan-credentials'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { errorMessageFrom } from '@moeru/std'
import {
  QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE,
  QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT,
  QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_MODEL,
  qwenAudioAsrTokenPlanGetPreflight,
  qwenAudioAsrTokenPlanProbe,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-asr-token-plan-capability-probe-ipc'
import { app, ipcMain } from 'electron'

import probeFixtureAsset from '../../../../../resources/token-plan-asr-capability-probe.wav?asset'

const PROBE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 128 * 1024
const MAX_TRANSCRIPT_LENGTH = 2_000
const MAX_ERROR_MESSAGE_LENGTH = 240

type MainEventContext = ReturnType<typeof createContext>['context']
type ProbeFetch = typeof fetch

interface ProbeResponse {
  status: number
  headers: Headers
  body?: ReadableStream<Uint8Array> | null
  text: () => Promise<string>
}

export interface QwenAudioAsrTokenPlanProbeOptions {
  context: MainEventContext
  credentialStore: Pick<QwenAudioTtsTokenPlanCredentialService, 'getPublicDiagnostic' | 'getPublicProfile' | 'getRuntimeProfile'>
  lifecycle?: Lifecycle
  fetchImpl?: ProbeFetch
  timeoutMs?: number
  fixtureBytes?: Uint8Array
}

export const TOKEN_PLAN_ASR_PROBE_REQUEST_SCHEMA = 'openai-chat-completions-input-audio-wav-data-uri'
export const TOKEN_PLAN_ASR_PROBE_FIXTURE_DESCRIPTION = 'macOS say "AIRI probe" -> 16-bit PCM WAV, mono, 16 kHz'

function responseClassForStatus(status: number): QwenAudioAsrTokenPlanProbeResponseClass | undefined {
  if (status === 400)
    return 'BAD_REQUEST_400'
  if (status === 401)
    return 'AUTH_401'
  if (status === 403)
    return 'AUTH_403'
  if (status === 404)
    return 'NOT_FOUND_404'
  if (status === 405)
    return 'METHOD_NOT_ALLOWED_405'
  if (status === 422)
    return 'UNPROCESSABLE_422'
  if (status === 429)
    return 'RATE_LIMIT_429'
  if (status >= 500 && status <= 599)
    return 'SERVER_ERROR_5XX'
  return undefined
}

function isRedirectError(error: unknown): boolean {
  return error instanceof Error && /redirect/i.test(error.message)
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0)
    return undefined
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/data:audio\/\S+;base64,[A-Za-z0-9+/=]+/g, 'data:audio/[redacted]')
    .slice(0, maxLength)
}

function safeProviderError(payload: unknown): Pick<QwenAudioAsrTokenPlanProbeResult, 'providerErrorCode' | 'sanitizedErrorMessage'> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return {}
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object' || Array.isArray(error))
    return {}
  const record = error as { code?: unknown, message?: unknown, type?: unknown }
  return {
    providerErrorCode: sanitizeText(record.code ?? record.type, 80),
    sanitizedErrorMessage: sanitizeText(record.message, MAX_ERROR_MESSAGE_LENGTH),
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

export function buildQwenAudioAsrTokenPlanProbeRequest(audioBase64: string) {
  return {
    model: QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_MODEL,
    stream: false,
    messages: [{
      role: 'user',
      content: [{
        type: 'input_audio',
        input_audio: {
          data: `data:audio/wav;base64,${audioBase64}`,
        },
      }],
    }],
  }
}

function parseSuccessPayload(response: ProbeResponse, payload: unknown): QwenAudioAsrTokenPlanProbeResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      responseClass: 'SUCCESS_UNEXPECTED_SCHEMA',
      responseSchema: 'non_object',
      transcriptPresent: false,
    }
  }

  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      responseClass: 'SUCCESS_UNEXPECTED_SCHEMA',
      responseSchema: 'missing_choices',
      transcriptPresent: false,
    }
  }

  const message = choices[0] && typeof choices[0] === 'object' && !Array.isArray(choices[0])
    ? (choices[0] as { message?: unknown }).message
    : undefined
  const content = message && typeof message === 'object' && !Array.isArray(message)
    ? (message as { content?: unknown }).content
    : undefined
  if (typeof content !== 'string') {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      responseClass: 'SUCCESS_UNEXPECTED_SCHEMA',
      responseSchema: 'missing_message_content_string',
      transcriptPresent: false,
    }
  }

  const transcript = sanitizeText(content, MAX_TRANSCRIPT_LENGTH)
  return {
    httpStatus: response.status,
    contentType: response.headers.get('content-type') ?? undefined,
    responseClass: transcript ? 'SUCCESS_CHAT_COMPLETION_TRANSCRIPT' : 'SUCCESS_EMPTY_TRANSCRIPT',
    responseSchema: 'choices_message_content_string',
    transcript,
    transcriptPresent: Boolean(transcript),
  }
}

async function readFixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(probeFixtureAsset))
}

export async function runQwenAudioAsrTokenPlanProbe(
  getRuntimeProfile: () => { apiKey: string },
  options: { fetchImpl?: ProbeFetch, timeoutMs?: number, fixtureBytes?: Uint8Array } = {},
): Promise<QwenAudioAsrTokenPlanProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const { apiKey } = getRuntimeProfile()
    const fixtureBytes = options.fixtureBytes ?? await readFixtureBytes()
    const requestBody = buildQwenAudioAsrTokenPlanProbeRequest(Buffer.from(fixtureBytes).toString('base64'))
    const response = await fetchImpl(QWEN_AUDIO_ASR_TOKEN_PLAN_PROBE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      redirect: 'error',
      signal: controller.signal,
    }) as unknown as ProbeResponse

    const contentType = response.headers.get('content-type') ?? undefined
    const statusClass = responseClassForStatus(response.status)
    const body = await readBoundedText(response)
    if (body === undefined) {
      if (statusClass)
        return { httpStatus: response.status, contentType, responseClass: statusClass, transcriptPresent: false }
      return { httpStatus: response.status, contentType, responseClass: 'MALFORMED_RESPONSE', responseSchema: 'body_too_large', transcriptPresent: false }
    }

    let payload: unknown
    try {
      payload = body.length ? JSON.parse(body) as unknown : undefined
    }
    catch {
      if (statusClass)
        return { httpStatus: response.status, contentType, responseClass: statusClass, transcriptPresent: false }
      return { httpStatus: response.status, contentType, responseClass: 'MALFORMED_RESPONSE', responseSchema: 'invalid_json', transcriptPresent: false }
    }

    if (statusClass)
      return { httpStatus: response.status, contentType, responseClass: statusClass, ...safeProviderError(payload), transcriptPresent: false }
    if (response.status < 200 || response.status >= 300)
      return { httpStatus: response.status, contentType, responseClass: 'NETWORK_ERROR', ...safeProviderError(payload), transcriptPresent: false }
    return parseSuccessPayload(response, payload)
  }
  catch (error) {
    return {
      responseClass: isRedirectError(error) ? 'REDIRECT_REJECTED' : error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
      sanitizedErrorMessage: sanitizeText(errorMessageFrom(error), MAX_ERROR_MESSAGE_LENGTH),
      transcriptPresent: false,
    }
  }
  finally {
    clearTimeout(timeout)
  }
}

export function createQwenAudioAsrTokenPlanProbe(options: QwenAudioAsrTokenPlanProbeOptions) {
  let inFlight: Promise<QwenAudioAsrTokenPlanProbeResult> | undefined
  const probe = async () => {
    if (inFlight)
      throw new Error('Qwen Audio Token Plan ASR probe is already in progress.')
    inFlight = runQwenAudioAsrTokenPlanProbe(options.credentialStore.getRuntimeProfile, {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      fixtureBytes: options.fixtureBytes,
    })
    try {
      return await inFlight
    }
    finally {
      inFlight = undefined
    }
  }

  const getPreflight = async () => {
    const userDataPath = app.getPath('userData')
    const profileAuthority = userDataPath === QWEN_AUDIO_ASR_TOKEN_PLAN_EXPECTED_DAILY_PROFILE
      ? 'DAILY_PROFILE' as const
      : 'NON_DAILY_PROFILE' as const
    let credentialConfigured = false
    let credentialStatus: 'saved' | 'missing' | 'unavailable' = 'unavailable'
    let credentialSource: 'secure-store' | 'environment' | 'none' = 'none'
    let credentialDiagnosticReason: string = 'UNKNOWN_ERROR'
    try {
      const publicProfile = options.credentialStore.getPublicProfile()
      credentialDiagnosticReason = options.credentialStore.getPublicDiagnostic().reason
      credentialConfigured = publicProfile.ready
      credentialSource = publicProfile.source
      credentialStatus = publicProfile.ready ? 'saved' : publicProfile.secureStorageAvailable ? 'missing' : 'unavailable'
    }
    catch {
      credentialStatus = 'unavailable'
    }

    let fixtureReady = false
    try {
      fixtureReady = (options.fixtureBytes ?? await readFixtureBytes()).byteLength > 0
    }
    catch {
      fixtureReady = false
    }

    return {
      userDataPath,
      profileAuthority,
      profileAuthorityMatch: profileAuthority === 'DAILY_PROFILE',
      credentialConfigured,
      credentialStatus,
      credentialSource,
      credentialDiagnosticReason,
      fixtureReady,
      probeReady: profileAuthority === 'DAILY_PROFILE' && credentialConfigured && fixtureReady && !inFlight,
    }
  }

  let disposeHandler = () => {}
  const dispose = () => {
    disposeHandler()
  }

  const disposeProbeHandler = defineInvokeHandler(options.context, qwenAudioAsrTokenPlanProbe, probe)
  const disposePreflightHandler = defineInvokeHandler(options.context, qwenAudioAsrTokenPlanGetPreflight, getPreflight)
  disposeHandler = () => {
    disposeProbeHandler()
    disposePreflightHandler()
  }
  options.lifecycle?.appHooks.onStop(dispose)
  return { getPreflight, probe, dispose }
}

export function setupQwenAudioAsrTokenPlanProbe(options: Omit<QwenAudioAsrTokenPlanProbeOptions, 'context' | 'credentialStore'> & { credentialStore: QwenAudioTtsTokenPlanCredentialService }) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioAsrTokenPlanProbe({ ...options, context: eventa.context })
  return {
    ...service,
    dispose: () => {
      service.dispose()
      eventa.dispose()
    },
  }
}
