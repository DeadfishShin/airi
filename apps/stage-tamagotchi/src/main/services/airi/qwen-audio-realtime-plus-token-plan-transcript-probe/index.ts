import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  QwenAudioRealtimePlusTokenPlanProbeResponseClass,
  QwenAudioRealtimePlusTokenPlanProbeResult,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'
import type { QwenAudioTtsTokenPlanCredentialDiagnosticReason } from '@proj-airi/stage-ui/libs/providers/qwen-audio-tts-token-plan-credential-ipc'
import type { Lifecycle } from 'injeca'

import type { QwenAudioTtsTokenPlanCredentialService } from '../qwen-audio-tts-token-plan-credentials'
import type { QwenAudioRealtimePlusTokenPlanSocket, QwenAudioRealtimePlusTokenPlanSocketFactory } from './protocol'

import { readFile } from 'node:fs/promises'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { errorMessageFrom } from '@moeru/std'
import {
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_EXPECTED_DAILY_PROFILE,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_FIXTURE_EXPECTED_TEXT,
  QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT,
  qwenAudioRealtimePlusTokenPlanGetPreflight,
  qwenAudioRealtimePlusTokenPlanProbe,
} from '@proj-airi/stage-ui/libs/providers/qwen-audio-realtime-plus-token-plan-transcript-probe-ipc'
import { app, ipcMain } from 'electron'

import probeFixtureAsset from '../../../../../resources/token-plan-asr-capability-probe.wav?asset'

import {
  buildQwenAudioRealtimePlusAudioAppendFrame,
  buildQwenAudioRealtimePlusAudioCommitFrame,
  buildQwenAudioRealtimePlusSessionUpdateFrame,
  chunkPcm,
  createQwenAudioRealtimePlusTokenPlanSocket,
  parsePcm16Mono16kWav,
  parseQwenAudioRealtimePlusServerMessage,

} from './protocol'

const HANDSHAKE_TIMEOUT_MS = 10_000
const SESSION_TIMEOUT_MS = 10_000
const TRANSCRIPT_TIMEOUT_MS = 15_000
const CHUNK_PACING_MS = 20
const MAX_TRANSCRIPT_LENGTH = 2_000
const MAX_ERROR_LENGTH = 240

type MainEventContext = ReturnType<typeof createContext>['context']

export interface QwenAudioRealtimePlusTokenPlanProbeOptions {
  context: MainEventContext
  credentialStore: Pick<QwenAudioTtsTokenPlanCredentialService, 'getPublicDiagnostic' | 'getPublicProfile' | 'getRuntimeProfile'>
  lifecycle?: Lifecycle
  socketFactory?: QwenAudioRealtimePlusTokenPlanSocketFactory
  fixtureBytes?: Uint8Array
  now?: () => number
}

function sanitize(value: unknown, maxLength = MAX_ERROR_LENGTH) {
  if (typeof value !== 'string' || !value.trim())
    return undefined
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-sp-[\w-]+/g, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function numericStatus(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value))
    return value
  if (typeof value === 'string') {
    const match = /\b([45]\d{2})\b/.exec(value)
    return match ? Number(match[1]) : undefined
  }
  return undefined
}

function responseClassForHandshakeError(error: unknown): QwenAudioRealtimePlusTokenPlanProbeResponseClass {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const status = numericStatus(details.statusCode ?? details.status ?? details.message)
  if (status === 401)
    return 'HANDSHAKE_AUTH_401'
  if (status === 403)
    return 'HANDSHAKE_AUTH_403'
  return 'DNS_NETWORK_ERROR'
}

function providerErrorClass(stage: QwenAudioRealtimePlusTokenPlanProbeResult['stage'], code?: string): QwenAudioRealtimePlusTokenPlanProbeResponseClass {
  const normalized = code?.toLowerCase() ?? ''
  if (normalized.includes('model'))
    return 'INVALID_MODEL'
  if (normalized.includes('append') || normalized.includes('audio'))
    return 'AUDIO_APPEND_ERROR'
  if (normalized.includes('commit'))
    return 'COMMIT_ERROR'
  if (normalized.includes('transcri'))
    return 'TRANSCRIPTION_FAILED'
  if (stage === 'audio')
    return 'AUDIO_APPEND_ERROR'
  if (stage === 'transcription')
    return 'TRANSCRIPTION_FAILED'
  if (stage === 'session')
    return 'SESSION_UPDATE_REJECTED'
  return 'SESSION_ERROR'
}

function errorDetails(error: unknown) {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  return {
    code: sanitize(details.code, 80),
    message: sanitize(details.message ?? errorMessageFrom(error)),
  }
}

function baseResult(): QwenAudioRealtimePlusTokenPlanProbeResult {
  return {
    stage: 'preflight',
    responseClass: 'PROBE_NOT_READY',
    sessionCreated: false,
    sessionUpdated: false,
    audioChunksSent: 0,
    audioBytesSent: 0,
    commitSent: false,
    commitAckReceived: false,
    committedItemIdPresent: false,
    userItemCreatedReceived: false,
    userItemCorrelationMatch: false,
    transcriptionDeltaEventCount: 0,
    validTextStashDeltaObserved: false,
    malformedPartialEventCount: 0,
    responseCreateSent: false,
    transcriptPresent: false,
  }
}

export async function readRealtimeProbeFixture(asset = probeFixtureAsset) {
  return new Uint8Array(await readFile(asset))
}

export async function runQwenAudioRealtimePlusTokenPlanProbe(
  getRuntimeProfile: () => { apiKey: string },
  options: {
    socketFactory?: QwenAudioRealtimePlusTokenPlanSocketFactory
    fixtureBytes?: Uint8Array
    timeoutMs?: number
    chunkPacingMs?: number
  } = {},
): Promise<QwenAudioRealtimePlusTokenPlanProbeResult> {
  const result = baseResult()
  let fixture: ReturnType<typeof parsePcm16Mono16kWav>
  try {
    fixture = parsePcm16Mono16kWav(options.fixtureBytes ?? await readRealtimeProbeFixture())
    getRuntimeProfile()
  }
  catch (error) {
    const details = errorDetails(error)
    return { ...result, responseClass: 'PROBE_NOT_READY', sanitizedErrorMessage: details.message }
  }

  const socketFactory = options.socketFactory ?? createQwenAudioRealtimePlusTokenPlanSocket
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const pacingMs = options.chunkPacingMs ?? CHUNK_PACING_MS
  let socket: QwenAudioRealtimePlusTokenPlanSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let resolveProbe: ((value: QwenAudioRealtimePlusTokenPlanProbeResult) => void) | undefined
  let stage: QwenAudioRealtimePlusTokenPlanProbeResult['stage'] = 'handshake'
  let transcriptionItemId: string | undefined
  let transcriptionContentIndex: number | undefined
  let messageChain = Promise.resolve()

  const finish = (next: Partial<QwenAudioRealtimePlusTokenPlanProbeResult>) => {
    if (settled)
      return
    settled = true
    if (timer)
      clearTimeout(timer)
    Object.assign(result, next)
  }

  const arm = (ms: number, responseClass: QwenAudioRealtimePlusTokenPlanProbeResponseClass, message: string) => {
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      finish({ stage, responseClass, sanitizedErrorMessage: message })
      if (socket && socket.readyState !== 3)
        socket.close(1000, 'probe-timeout')
      resolveProbe?.({ ...result, stage })
    }, ms)
  }

  const promise = new Promise<QwenAudioRealtimePlusTokenPlanProbeResult>((resolve) => {
    resolveProbe = resolve
    const matchesTranscriptionItem = (event: { itemId?: string, contentIndex?: number }) => {
      if (event.itemId !== undefined) {
        if (transcriptionItemId !== undefined && event.itemId !== transcriptionItemId)
          return false
        transcriptionItemId ??= event.itemId
      }
      if (event.contentIndex !== undefined) {
        if (transcriptionContentIndex !== undefined && event.contentIndex !== transcriptionContentIndex)
          return false
        transcriptionContentIndex ??= event.contentIndex
      }
      return true
    }
    const captureCommittedItem = (itemId: string) => {
      if (transcriptionItemId !== undefined && transcriptionItemId !== itemId)
        return false
      transcriptionItemId ??= itemId
      return true
    }
    const settle = (next: Partial<QwenAudioRealtimePlusTokenPlanProbeResult>) => {
      finish(next)
      if (!settled)
        return
      if (socket && socket.readyState !== 3)
        socket.close(1000, 'probe-finished')
      resolve({ ...result, stage: result.responseClass === 'SUCCESS_TRANSCRIPT_ONLY' ? 'complete' : result.stage })
    }

    const handleMessage = async (message: unknown) => {
      if (settled)
        return
      let event
      try {
        event = parseQwenAudioRealtimePlusServerMessage(message)
      }
      catch (error) {
        const details = errorDetails(error)
        settle({ stage, responseClass: 'MALFORMED_EVENT', sanitizedErrorMessage: details.message })
        return
      }

      if (event.type === 'session.created') {
        result.sessionCreated = true
        stage = 'session'
        result.stage = stage
        socket?.send(JSON.stringify(buildQwenAudioRealtimePlusSessionUpdateFrame()))
        arm(SESSION_TIMEOUT_MS, 'SESSION_UPDATED_TIMEOUT', 'Timed out waiting for session.updated.')
        return
      }
      if (event.type === 'session.updated') {
        result.sessionUpdated = true
        stage = 'audio'
        result.stage = stage
        const chunks = chunkPcm(fixture.pcm)
        for (const chunk of chunks) {
          if (settled)
            return
          socket?.send(JSON.stringify(buildQwenAudioRealtimePlusAudioAppendFrame(chunk)))
          result.audioChunksSent++
          result.audioBytesSent += chunk.byteLength
          if (pacingMs > 0)
            await new Promise(resolveDelay => setTimeout(resolveDelay, pacingMs))
        }
        if (settled)
          return
        result.commitSent = true
        stage = 'transcription'
        result.stage = stage
        socket?.send(JSON.stringify(buildQwenAudioRealtimePlusAudioCommitFrame()))
        arm(TRANSCRIPT_TIMEOUT_MS, 'TRANSCRIPT_TIMEOUT', 'Timed out waiting for completed input transcription.')
        return
      }
      if (event.type === 'commit.ack') {
        if (!captureCommittedItem(event.itemId))
          return
        result.commitAckReceived = true
        result.committedItemIdPresent = true
        return
      }
      if (event.type === 'user.item.created') {
        if (!captureCommittedItem(event.itemId))
          return
        result.userItemCreatedReceived = true
        result.userItemCorrelationMatch = true
        return
      }
      if (event.type === 'transcription.delta') {
        if (!matchesTranscriptionItem(event))
          return
        result.transcriptionDeltaEventCount++
        if (event.text || event.stash)
          result.validTextStashDeltaObserved = true
        return
      }
      if (event.type === 'transcription.delta.malformed') {
        // A partial transcription event does not decide the probe result.
        // Wait for the completed event unless the event envelope itself is unreadable.
        result.malformedPartialEventCount++
        return
      }
      if (event.type === 'transcription.completed') {
        if (!matchesTranscriptionItem(event))
          return
        const transcript = sanitize(event.transcript, MAX_TRANSCRIPT_LENGTH)
        settle({
          stage: 'complete',
          responseClass: transcript ? 'SUCCESS_TRANSCRIPT_ONLY' : 'EMPTY_TRANSCRIPT',
          transcript,
          transcriptPresent: Boolean(transcript),
        })
        return
      }
      if (event.type === 'transcription.failed') {
        if (!matchesTranscriptionItem(event))
          return
        settle({
          stage,
          responseClass: 'TRANSCRIPTION_FAILED',
          providerErrorCode: sanitize(event.code, 80),
          sanitizedErrorMessage: sanitize(event.message),
        })
        return
      }
      if (event.type === 'unexpected-generation') {
        settle({ stage, responseClass: 'UNEXPECTED_VENDOR_RESPONSE_GENERATION', sanitizedErrorMessage: `Unexpected provider event: ${event.eventType}` })
        return
      }
      if (event.type === 'error') {
        const details = errorDetails(event)
        settle({ stage, responseClass: providerErrorClass(stage, details.code), providerErrorCode: details.code, sanitizedErrorMessage: details.message })
      }
    }

    try {
      const profile = getRuntimeProfile()
      socket = socketFactory(QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_PROBE_ENDPOINT, { Authorization: `Bearer ${profile.apiKey}` })
      socket.on('open', () => {
        result.handshakeStatus = 'opened'
        stage = 'session'
        result.stage = stage
        arm(SESSION_TIMEOUT_MS, 'SESSION_CREATED_TIMEOUT', 'Timed out waiting for session.created.')
      })
      socket.on('message', (message) => {
        messageChain = messageChain.then(() => handleMessage(message)).catch(() => {})
      })
      socket.on('error', (error) => {
        const details = errorDetails(error)
        settle({
          stage,
          responseClass: stage === 'handshake' ? responseClassForHandshakeError(error) : providerErrorClass(stage, details.code),
          handshakeStatus: result.handshakeStatus ?? 'failed',
          providerErrorCode: details.code,
          sanitizedErrorMessage: details.message,
        })
      })
      socket.on('close', (code, reason) => {
        if (settled)
          return
        const closeCode = typeof code === 'number' ? code : undefined
        settle({
          stage: 'closed',
          responseClass: 'CONNECTION_CLOSED_BEFORE_TRANSCRIPT',
          closeCode,
          closeCategory: sanitize(typeof reason === 'string' ? reason : undefined),
        })
      })
      arm(timeoutMs, 'DNS_NETWORK_ERROR', 'Timed out waiting for the WebSocket handshake.')
    }
    catch (error) {
      const details = errorDetails(error)
      settle({ stage: 'handshake', responseClass: responseClassForHandshakeError(error), handshakeStatus: 'failed', sanitizedErrorMessage: details.message })
    }
  })

  return await promise
}

export function createQwenAudioRealtimePlusTokenPlanProbe(options: QwenAudioRealtimePlusTokenPlanProbeOptions) {
  let inFlight: Promise<QwenAudioRealtimePlusTokenPlanProbeResult> | undefined
  let socket: QwenAudioRealtimePlusTokenPlanSocket | undefined

  const getPreflight = async () => {
    const userDataPath = app.getPath('userData')
    const profileAuthority = userDataPath === QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_EXPECTED_DAILY_PROFILE ? 'DAILY_PROFILE' as const : 'NON_DAILY_PROFILE' as const
    let credentialConfigured = false
    let credentialStatus: 'saved' | 'missing' | 'unavailable' = 'unavailable'
    let credentialSource: 'secure-store' | 'environment' | 'none' = 'none'
    let credentialDiagnosticReason: QwenAudioTtsTokenPlanCredentialDiagnosticReason = 'UNKNOWN_ERROR'
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
    let rawPcmBytes = 0
    try {
      const fixture = parsePcm16Mono16kWav(options.fixtureBytes ?? await readRealtimeProbeFixture())
      fixtureReady = fixture.pcm.byteLength > 0
      rawPcmBytes = fixture.pcm.byteLength
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
      fixtureFormat: fixtureReady ? 'pcm16-mono-16khz' as const : 'invalid' as const,
      rawPcmBytes,
      probeReady: profileAuthority === 'DAILY_PROFILE' && credentialConfigured && fixtureReady && !inFlight,
    }
  }

  const probe = async () => {
    if (inFlight)
      throw new Error('Qwen Token Plan realtime transcript probe is already in progress.')
    const preflight = await getPreflight()
    if (!preflight.probeReady)
      return { ...baseResult(), responseClass: 'PROBE_NOT_READY' as const, sanitizedErrorMessage: 'Runtime preflight is not ready.' }
    inFlight = runQwenAudioRealtimePlusTokenPlanProbe(options.credentialStore.getRuntimeProfile, {
      socketFactory: (endpoint, headers) => {
        socket = (options.socketFactory ?? createQwenAudioRealtimePlusTokenPlanSocket)(endpoint, headers)
        return socket
      },
      fixtureBytes: options.fixtureBytes,
    })
    try {
      return await inFlight
    }
    finally {
      inFlight = undefined
      socket = undefined
    }
  }

  const dispose = () => {
    socket?.terminate?.()
    socket?.close(1000, 'disposed')
  }
  const handlers = [
    defineInvokeHandler(options.context, qwenAudioRealtimePlusTokenPlanProbe, probe),
    defineInvokeHandler(options.context, qwenAudioRealtimePlusTokenPlanGetPreflight, getPreflight),
  ]
  const disposeHandlers = () => handlers.forEach(disposeHandler => disposeHandler())
  options.lifecycle?.appHooks.onStop(disposeHandlers)
  return {
    getPreflight,
    probe,
    dispose: () => {
      dispose()
      disposeHandlers()
    },
  }
}

export function setupQwenAudioRealtimePlusTokenPlanProbe(options: Omit<QwenAudioRealtimePlusTokenPlanProbeOptions, 'context' | 'credentialStore'> & { credentialStore: QwenAudioTtsTokenPlanCredentialService }) {
  const eventa = createElectronContext(ipcMain)
  const service = createQwenAudioRealtimePlusTokenPlanProbe({ ...options, context: eventa.context })
  return {
    ...service,
    dispose: () => {
      service.dispose()
      eventa.dispose()
    },
  }
}

export { QWEN_AUDIO_REALTIME_PLUS_TOKEN_PLAN_FIXTURE_EXPECTED_TEXT }
