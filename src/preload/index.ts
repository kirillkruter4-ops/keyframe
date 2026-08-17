import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Settings } from '../shared/settings'
import type { Encoder, ExportProgress, ExportRequest } from '../shared/edit/export'

export type { Settings }

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

    /** Кадр для подсказки на таймлайне; null — ещё не готов или недоступен. */
    thumbnail: (seconds: number) =>
      ipcRenderer.invoke('thumbnail:at', seconds) as Promise<string | null>,

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

  playlist: {
    /** Открыть перетащенное: первый файл играет, остальные встают в очередь. */
    open: (targets: string[]) => ipcRenderer.invoke('playlist:open', targets),
    remove: (index: number) => ipcRenderer.invoke('playlist:remove', index),

    /** Недавно открытое: история для палитры. Уже несуществующие пути отсеяны. */
    recent: () => ipcRenderer.invoke('recent:list') as Promise<string[]>,
    clear: () => ipcRenderer.invoke('playlist:clear')
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch) as Promise<Settings>,
    chooseScreenshotDir: () =>
      ipcRenderer.invoke('settings:chooseScreenshotDir') as Promise<string | null>,
    openDefaultApps: () => ipcRenderer.invoke('settings:openDefaultApps'),

    onChange: (cb: (next: Settings) => void): (() => void) => {
      const handler = (_e: unknown, next: Settings) => cb(next)
      ipcRenderer.on('settings:changed', handler)
      return () => {
        ipcRenderer.off('settings:changed', handler)
      }
    }
  },

  openSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle') as Promise<string | null>,

  /** Встроенный редактор нарезки. Всё здесь работает с исходным файлом по пути. */
  editor: {
    /** Сообщить главному процессу, что плеер показывает склейку, а не файл. */
    setActive: (active: boolean) => ipcRenderer.invoke('editor:active', active),

    /** Выйти из редактора: вернуть исходный файл и встать на указанную секунду. */
    leave: (source: string, seconds: number) =>
      ipcRenderer.invoke('editor:leave', source, seconds),

    loadProject: (source: string, duration: number) =>
      ipcRenderer.invoke('editor:project:load', source, duration) as Promise<
        { in: number; out: number }[] | null
      >,
    saveProject: (source: string, segments: { in: number; out: number }[], duration: number) =>
      ipcRenderer.invoke('editor:project:save', source, segments, duration),

    /** Кадр полосы: точная секунда исходника, запрос дожидается очереди. */
    thumb: (source: string, seconds: number) =>
      ipcRenderer.invoke('editor:thumb', source, seconds) as Promise<string | null>,

    /** Куда на самом деле придётся рез при быстром экспорте. */
    keyframe: (source: string, seconds: number) =>
      ipcRenderer.invoke('editor:keyframe', source, seconds) as Promise<number | null>,

    encoders: () => ipcRenderer.invoke('editor:encoders') as Promise<Encoder[]>,

    chooseTarget: (suggested: string) =>
      ipcRenderer.invoke('editor:chooseTarget', suggested) as Promise<string | null>,

    start: (request: ExportRequest) => ipcRenderer.invoke('editor:export', request),
    cancel: () => ipcRenderer.invoke('editor:cancel'),
    reveal: (target: string) => ipcRenderer.invoke('editor:reveal', target),

    onProgress: (cb: (progress: ExportProgress) => void): (() => void) => {
      const handler = (_e: unknown, progress: ExportProgress) => cb(progress)
      ipcRenderer.on('editor:progress', handler)
      return () => {
        ipcRenderer.off('editor:progress', handler)
      }
    }
  },

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
