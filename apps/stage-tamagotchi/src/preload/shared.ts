import type { ElectronWindow } from '@proj-airi/stage-shared'

import type { LocalDuplexDiagnosticAPI } from '../shared/local-duplex-diagnostic'

import { contextIsolated, env, platform } from 'node:process'

import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

import { LOCAL_DUPLEX_DIAGNOSTIC_MODE_ENV, LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL } from '../shared/local-duplex-diagnostic'

export function expose() {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcRenderer.setMaxListeners(0)

  // Use `contextBridge` APIs to expose Electron APIs to
  // renderer only if context isolation is enabled, otherwise
  // just add to the DOM global.
  if (contextIsolated) {
    try {
      contextBridge.exposeInMainWorld('electron', electronAPI)
      contextBridge.exposeInMainWorld('platform', platform)
    }
    catch (error) {
      console.error(error)
    }
  }
  else {
    window.electron = electronAPI
    window.platform = platform
  }

  if (env[LOCAL_DUPLEX_DIAGNOSTIC_MODE_ENV]) {
    const diagnosticAPI: LocalDuplexDiagnosticAPI = {
      notifyReady: () => ipcRenderer.send(LOCAL_DUPLEX_DIAGNOSTIC_READY_CHANNEL),
    }
    if (contextIsolated) {
      contextBridge.exposeInMainWorld('airiLocalDuplexDiagnostic', diagnosticAPI)
    }
    else {
      window.airiLocalDuplexDiagnostic = diagnosticAPI
    }
  }
}

export function exposeWithCustomAPI<CustomAPI>(customAPI: CustomAPI) {
  expose()

  // Use `contextBridge` APIs to expose Electron APIs to
  // renderer only if context isolation is enabled, otherwise
  // just add to the DOM global.
  if (contextIsolated) {
    try {
      contextBridge.exposeInMainWorld('api', customAPI)
    }
    catch (error) {
      console.error(error)
    }
  }
  else {
    (window as ElectronWindow<CustomAPI>).api = customAPI
  }
}
