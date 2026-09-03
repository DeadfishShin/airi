export const LOCAL_DUPLEX_DIAGNOSTIC_MODE_ENV = 'AIRI_LOCAL_DUPLEX_DIAGNOSTIC_MODE'
export const LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL = 'airi:local-duplex:diagnostic-ready'
export const LOCAL_DUPLEX_DIAGNOSTIC_PROTOCOL = 'airi-local-duplex'

export type LocalDuplexDiagnosticMode = 'interactive' | 'boot-probe'

export interface LocalDuplexDiagnosticAPI {
  notifyReady: () => void
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
  }
}
