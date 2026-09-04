// The runtime marker must be initialized before the VAD renderer module is evaluated.
import './local-duplex-chromium-runtime'
// eslint-disable-next-line perfectionist/sort-imports
import { startLocalDuplexDiagnostic } from '../../scripts/local-duplex-aec-vad-smoke-renderer'

const start = document.getElementById('start') as HTMLButtonElement | null

start?.addEventListener('click', () => {
  if (!start || start.disabled)
    return

  // The renderer owns the initialization, but this call remains directly on
  // the click path so AudioContext creation/resume can use the same gesture.
  start.disabled = true
  startLocalDuplexDiagnostic()
})
