import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface WindowState {
  fullscreen: boolean
  maximized: boolean
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

/**
 * Единственный мост между интерфейсом и системой. Renderer не имеет доступа
 * ни к Node, ни к mpv напрямую — только к этим методам.
 */
const api = {
  mpv: {
    command: (...args: unknown[]) => ipcRenderer.invoke('mpv:command', args),
    set: (name: string, value: unknown) => ipcRenderer.invoke('mpv:set', name, value),
    state: () => ipcRenderer.invoke('mpv:state') as Promise<Record<string, unknown>>,

    // Отписки возвращают void намеренно: иначе их нельзя отдать напрямую
    // из useEffect — React примет ipcRenderer за функцию очистки
    onProperty: (cb: (name: string, value: unknown) => void): (() => void) => {
      const handler = (_e: unknown, name: string, value: unknown) => cb(name, value)
      ipcRenderer.on('mpv:property', handler)
      return () => {
        ipcRenderer.off('mpv:property', handler)
      }
    },
    onReady: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on('mpv:ready', handler)
      return () => {
        ipcRenderer.off('mpv:ready', handler)
      }
    },
    onExit: (cb: (info: unknown) => void): (() => void) => {
      const handler = (_e: unknown, info: unknown) => cb(info)
      ipcRenderer.on('mpv:exit', handler)
      return () => {
        ipcRenderer.off('mpv:exit', handler)
      }
    }
  },

  update: {
    status: () => ipcRenderer.invoke('update:status') as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke('update:check') as Promise<UpdateStatus>,
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),

    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const handler = (_e: unknown, status: UpdateStatus) => cb(status)
      ipcRenderer.on('update:status', handler)
      return () => {
        ipcRenderer.off('update:status', handler)
      }
    }
  },

  version: () => ipcRenderer.invoke('app:version') as Promise<string>,

  openFile: () => ipcRenderer.invoke('dialog:openFile') as Promise<string | null>,

  // File.path из renderer убрали начиная с Electron 32 — путь отдаёт только webUtils
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    dragStart: (x: number, y: number) => ipcRenderer.invoke('window:dragStart', x, y),
    dragMove: (x: number, y: number) => ipcRenderer.invoke('window:dragMove', x, y),
    dragEnd: () => ipcRenderer.invoke('window:dragEnd'),

    state: () => ipcRenderer.invoke('window:state') as Promise<WindowState>,

    onState: (cb: (state: WindowState) => void): (() => void) => {
      const handler = (_e: unknown, state: WindowState) => cb(state)
      ipcRenderer.on('window:state', handler)
      return () => {
        ipcRenderer.off('window:state', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('keyframe', api)

export type KeyframeApi = typeof api
