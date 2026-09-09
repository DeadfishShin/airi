export const REMOTE_ASR_OWNER_SYNC_DIAGNOSTIC_MODE_ENV = 'AIRI_REMOTE_ASR_OWNER_SYNC_DIAGNOSTIC'

export type RemoteAsrOwnerSyncGateMode = 'BYPASS' | 'CLOSED' | 'ARMED_ONCE' | 'CONSUMED'
export type RemoteAsrOwnerSyncGateDecision = 'allow' | 'deny' | 'bypass'

export interface RemoteAsrOwnerSyncRuntimeSnapshot {
  speechActive: boolean
  providerSessionActive: boolean
  segmentSequence: number
}

export interface RemoteAsrOwnerSyncGateSnapshot extends RemoteAsrOwnerSyncRuntimeSnapshot {
  gateMode: RemoteAsrOwnerSyncGateMode
  canStartCallCount: number
  denyCount: number
  allowCount: number
  consumedCount: number
  lastDecision: RemoteAsrOwnerSyncGateDecision
}

export interface RemoteAsrOwnerSyncDiagnosticControl {
  snapshot: () => RemoteAsrOwnerSyncGateSnapshot
  close: () => RemoteAsrOwnerSyncGateSnapshot
  armOnce: () => RemoteAsrOwnerSyncGateSnapshot
  bypass: () => RemoteAsrOwnerSyncGateSnapshot
  reset: () => RemoteAsrOwnerSyncGateSnapshot
}

export interface RemoteAsrOwnerSyncDiagnosticBridge {
  readonly enabled: true
  bind: (control: RemoteAsrOwnerSyncDiagnosticControl) => void
  snapshot: () => RemoteAsrOwnerSyncGateSnapshot | undefined
  close: () => RemoteAsrOwnerSyncGateSnapshot | undefined
  armOnce: () => RemoteAsrOwnerSyncGateSnapshot | undefined
  bypass: () => RemoteAsrOwnerSyncGateSnapshot | undefined
  reset: () => RemoteAsrOwnerSyncGateSnapshot | undefined
}

declare global {
  interface Window {
    airiRemoteAsrOwnerSyncDiagnostic?: RemoteAsrOwnerSyncDiagnosticBridge
  }
}

type ProductGate = () => boolean | Promise<boolean>
type RuntimeSnapshotProvider = () => Partial<RemoteAsrOwnerSyncRuntimeSnapshot> | undefined

const EMPTY_RUNTIME_SNAPSHOT: RemoteAsrOwnerSyncRuntimeSnapshot = {
  speechActive: false,
  providerSessionActive: false,
  segmentSequence: 0,
}

function isDiagnosticBridge(value: unknown): value is RemoteAsrOwnerSyncDiagnosticBridge {
  return !!value
    && typeof value === 'object'
    && (value as RemoteAsrOwnerSyncDiagnosticBridge).enabled === true
    && typeof (value as RemoteAsrOwnerSyncDiagnosticBridge).bind === 'function'
}

export function createRemoteAsrOwnerSyncGate(enabled: boolean) {
  let gateMode: RemoteAsrOwnerSyncGateMode = enabled ? 'CLOSED' : 'BYPASS'
  let canStartCallCount = 0
  let denyCount = 0
  let allowCount = 0
  let consumedCount = 0
  let lastDecision: RemoteAsrOwnerSyncGateDecision = enabled ? 'deny' : 'bypass'
  let runtimeSnapshotProvider: RuntimeSnapshotProvider | undefined

  function snapshot(): RemoteAsrOwnerSyncGateSnapshot {
    const runtime = runtimeSnapshotProvider?.() ?? EMPTY_RUNTIME_SNAPSHOT
    const segmentSequence = runtime.segmentSequence
    return {
      gateMode,
      speechActive: runtime.speechActive === true,
      providerSessionActive: runtime.providerSessionActive === true,
      segmentSequence: typeof segmentSequence === 'number' && Number.isSafeInteger(segmentSequence) && segmentSequence >= 0
        ? segmentSequence
        : 0,
      canStartCallCount,
      denyCount,
      allowCount,
      consumedCount,
      lastDecision,
    }
  }

  function close() {
    if (enabled)
      gateMode = 'CLOSED'
    lastDecision = enabled ? 'deny' : 'bypass'
    return snapshot()
  }

  function armOnce() {
    if (enabled)
      gateMode = 'ARMED_ONCE'
    lastDecision = enabled ? 'deny' : 'bypass'
    return snapshot()
  }

  function bypass() {
    gateMode = 'BYPASS'
    lastDecision = 'bypass'
    return snapshot()
  }

  function reset() {
    gateMode = enabled ? 'CLOSED' : 'BYPASS'
    canStartCallCount = 0
    denyCount = 0
    allowCount = 0
    consumedCount = 0
    lastDecision = enabled ? 'deny' : 'bypass'
    return snapshot()
  }

  async function evaluate(productGateAllows: boolean) {
    canStartCallCount += 1

    if (gateMode === 'BYPASS') {
      lastDecision = 'bypass'
      return productGateAllows
    }

    if (!productGateAllows) {
      denyCount += 1
      lastDecision = 'deny'
      return false
    }

    if (gateMode === 'ARMED_ONCE') {
      gateMode = 'CONSUMED'
      allowCount += 1
      consumedCount += 1
      lastDecision = 'allow'
      return true
    }

    denyCount += 1
    lastDecision = 'deny'
    return false
  }

  async function composed(productGate?: ProductGate) {
    const productGateAllows = productGate ? await productGate() : true
    return await evaluate(productGateAllows)
  }

  const control: RemoteAsrOwnerSyncDiagnosticControl = {
    snapshot,
    close,
    armOnce,
    bypass,
    reset,
  }

  return {
    control,
    compose(productGate?: ProductGate) {
      if (!enabled)
        return productGate

      return () => composed(productGate)
    },
    setRuntimeSnapshotProvider(provider: RuntimeSnapshotProvider | undefined) {
      runtimeSnapshotProvider = provider
    },
  }
}

export function createRemoteAsrOwnerSyncDiagnosticGate() {
  const bridge = typeof window !== 'undefined' && isDiagnosticBridge(window.airiRemoteAsrOwnerSyncDiagnostic)
    ? window.airiRemoteAsrOwnerSyncDiagnostic
    : undefined
  const gate = createRemoteAsrOwnerSyncGate(bridge?.enabled === true)

  if (bridge)
    bridge.bind(gate.control)

  return {
    ...gate,
    attached: !!bridge,
  }
}
