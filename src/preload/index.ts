import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface WindowState {
  fullscreen: boolean
  maximized: boolean
  alwaysOnTop: boolean
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
    },

    /** События mpv как есть: end-file, file-loaded и прочее. */
    onEvent: (cb: (name: string, data: Record<string, unknown>) => void): (() => void) => {
      const handler = (_e: unknown, name: string, data: Record<string, unknown>) => cb(name, data)
      ipcRenderer.on('mpv:event', handler)
      return () => {
        ipcRenderer.off('mpv:event', handler)
      }
    },

    /** Главный процесс вернул нас к прошлой позиции — интерфейс сообщает об этом. */
    onResumed: (cb: (position: number) => void): (() => void) => {
      const handler = (_e: unknown, position: number) => cb(position)
      ipcRenderer.on('mpv:resumed', handler)
      return () => {
        ipcRenderer.off('mpv:resumed', handler)
      }
    },

    restart: () => ipcRenderer.invoke('mpv:restart'),

    screenshot: () => ipcRenderer.invoke('mpv:screenshot') as Promise<string | null>
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

  openSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle') as Promise<string | null>,

  /** Показать сохранённый снимок в проводнике. */
  showItem: (target: string) => ipcRenderer.invoke('shell:showItem', target),

  // File.path из renderer убрали начиная с Electron 32 — путь отдаёт только webUtils
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop') as Promise<boolean>,
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
