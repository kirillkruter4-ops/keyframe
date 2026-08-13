import { contextBridge, ipcRenderer } from 'electron'

/**
 * Единственный мост между интерфейсом и системой. Renderer не имеет доступа
 * ни к Node, ни к mpv напрямую — только к этим методам.
 */
const api = {
  mpv: {
    command: (...args: unknown[]) => ipcRenderer.invoke('mpv:command', args),
    set: (name: string, value: unknown) => ipcRenderer.invoke('mpv:set', name, value),
    state: () => ipcRenderer.invoke('mpv:state') as Promise<Record<string, unknown>>,

    onProperty: (cb: (name: string, value: unknown) => void) => {
      const handler = (_e: unknown, name: string, value: unknown) => cb(name, value)
      ipcRenderer.on('mpv:property', handler)
      return () => ipcRenderer.off('mpv:property', handler)
    },
    onReady: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('mpv:ready', handler)
      return () => ipcRenderer.off('mpv:ready', handler)
    },
    onExit: (cb: (info: unknown) => void) => {
      const handler = (_e: unknown, info: unknown) => cb(info)
      ipcRenderer.on('mpv:exit', handler)
      return () => ipcRenderer.off('mpv:exit', handler)
    }
  },

  openFile: () => ipcRenderer.invoke('dialog:openFile') as Promise<string | null>,

  window: {
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.invoke('window:setIgnoreMouse', ignore),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    dragStart: (x: number, y: number) => ipcRenderer.invoke('window:dragStart', x, y),
    dragMove: (x: number, y: number) => ipcRenderer.invoke('window:dragMove', x, y),
    dragEnd: () => ipcRenderer.invoke('window:dragEnd')
  }
}

contextBridge.exposeInMainWorld('keyframe', api)

export type KeyframeApi = typeof api
