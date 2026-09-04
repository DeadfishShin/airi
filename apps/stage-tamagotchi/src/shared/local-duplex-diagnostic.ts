export const LOCAL_DUPLEX_DIAGNOSTIC_MODE_ENV = 'AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE'
export const LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL = 'airi:local-duplex:diagnostic-ready'
export const LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL = 'airi-local-duplex'
export const LOCAL_DUPLEX_DIAGNOSTIC_VAD_BOOT_REPORT_MARKER = 'AIRI_LOCAL_DUPLEX_PRODUCTION_VAD_BOOT_REPORT:'

export interface LocalDuplexChromiumRuntime {
  modelBaseUrl: string
  ortWasmUrl: string
  playbackAssetUrl: string
  reportEndpoint: string
}

export const LOCAL_DUPLEX_DIAGNOSTIC_BLOCKED_REQUEST_MAX = 8

export type LocalDuplexDiagnosticBlockedRequestClass
  = | 'external-model-resource'
    | 'external-onnx-wasm'
    | 'external-renderer-resource'
    | 'external-resource'

export interface LocalDuplexDiagnosticBlockedRequest {
  protocol: string
  host: string
  requestClass: LocalDuplexDiagnosticBlockedRequestClass
  resourceType?: string
}

export type LocalDuplexDiagnosticMode = 'interactive' | 'boot-probe'

export interface LocalDuplexDiagnosticAPI {
  notifyReady: () => void
}

function boundedHost(hostname: string) {
  return /^[a-z0-9.:[\]-]{1,128}$/i.test(hostname) ? hostname.toLowerCase() : 'unknown-host'
}

function boundedResourceType(resourceType: string | undefined) {
  if (!resourceType || !/^[a-z][a-z0-9-]{0,31}$/i.test(resourceType))
    return undefined
  return resourceType.toLowerCase()
}

export function classifyLocalDuplexBlockedRequest(rawUrl: string, resourceType?: string): LocalDuplexDiagnosticBlockedRequest {
  let url: URL | undefined
  try {
    url = new URL(rawUrl)
  }
  catch {
    return {
      protocol: 'invalid:',
      host: 'invalid-url',
      requestClass: 'external-resource',
      resourceType: boundedResourceType(resourceType),
    }
  }

  const pathname = url.pathname.toLowerCase()
  const host = boundedHost(url.hostname)
  const normalizedResourceType = boundedResourceType(resourceType)
  const requestClass = pathname.endsWith('.wasm') || host.includes('onnxruntime')
    ? 'external-onnx-wasm'
    : host.includes('huggingface') || pathname.includes('/resolve/') || pathname.includes('/models/')
      ? 'external-model-resource'
      : normalizedResourceType === 'script' || normalizedResourceType === 'stylesheet'
        ? 'external-renderer-resource'
        : 'external-resource'

  return {
    protocol: url.protocol,
    host,
    requestClass,
    resourceType: normalizedResourceType,
  }
}

export function isSafeDiagnosticModelId(value: unknown) {
  return typeof value === 'string'
    && /^[A-Z0-9][\w.-]{0,63}\/[A-Z0-9][\w.-]{0,63}$/i.test(value)
}

export function resolveLocalDuplexDiagnosticMode(environment: Record<string, string | undefined>): LocalDuplexDiagnosticMode | undefined {
  const mode = environment[LOCAL_DUPLEX_DIAGNOSTIC_MODE_ENV]
  return mode === 'interactive' || mode === 'boot-probe' ? mode : undefined
}

export function stripLocalDuplexDiagnosticCredentials(environment: Record<string, string | undefined>) {
  for (const name of [
    'TOKEN_PLAN_API_KEY',
    'DASHSCOPE_API_KEY',
    'DASHSCOPE_WORKSPACE_ID',
    'DASHSCOPE_REGION',
  ]) {
    delete environment[name]
  }
}

declare global {
  interface Window {
    airiLocalDuplexDiagnostic?: LocalDuplexDiagnosticAPI
    airiLocalDuplexChromium?: LocalDuplexChromiumRuntime
  }
}
