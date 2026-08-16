import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'

export type { Settings }

/** Запись из track-list mpv; нужные нам поля. */
export interface Track {
  id: number
  type: 'video' | 'audio' | 'sub' | string
  title?: string
  lang?: string
  external?: boolean
  codec?: string
  'demux-channel-count'?: number
}

/** Запись плейлиста mpv. */
export interface PlaylistEntry {
  filename: string
  title?: string
  current?: boolean
  playing?: boolean
}

export interface PlayerState {
  ready: boolean
  paused: boolean
  timePos: number
  duration: number
  volume: number
  muted: boolean
  filename: string | null
  /** Полный путь: нужен, чтобы показать файл в проводнике */
  path: string | null
  coreIdle: boolean
  cacheDuration: number
  videoWidth: number | null
  videoHeight: number | null
  hwdec: string | null
  frameDrops: number
  fps: number | null
  crashed: boolean
  speed: number
  tracks: Track[]
  /** id выбранной дорожки; false — выключена */
  sid: number | false
  aid: number | false
  subVisible: boolean
  /** Секунды: положительная — субтитры показываются позже звука */
  subDelay: number
  audioDelay: number
  loop: boolean
  loopPlaylist: boolean
  /** Пропорции кадра: -1 — как в файле */
  aspect: number
  playlist: PlaylistEntry[]
  playlistPos: number
}

const INITIAL: PlayerState = {
  ready: false,
  paused: true,
  timePos: 0,
  duration: 0,
  volume: 100,
  muted: false,
  filename: null,
  path: null,
  coreIdle: true,
  cacheDuration: 0,
  videoWidth: null,
  videoHeight: null,
  hwdec: null,
  frameDrops: 0,
  fps: null,
  crashed: false,
  speed: 1,
  tracks: [],
  sid: false,
  aid: false,
  subVisible: true,
  subDelay: 0,
  audioDelay: 0,
  loop: false,
  loopPlaylist: false,
  aspect: -1,
  playlist: [],
  playlistPos: -1
}

/** mpv отдаёт «дорожка не выбрана» как false, выбранную — как число. */
function trackId(value: unknown): number | false {
  return typeof value === 'number' ? value : false
}

/** mpv отдаёт числовые свойства как null, пока файл не загружен. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function usePlayer(): PlayerState {
  const [state, setState] = useState<PlayerState>(INITIAL)

  useEffect(() => {
    const api = window.keyframe.mpv

    const applyProperty = (name: string, value: unknown): void => {
      setState((prev) => {
        switch (name) {
          case 'pause':
            return { ...prev, paused: Boolean(value) }
          case 'time-pos':
            return { ...prev, timePos: num(value) }
          case 'duration':
            return { ...prev, duration: num(value) }
          case 'volume':
            return { ...prev, volume: num(value, prev.volume) }
          case 'mute':
            return { ...prev, muted: Boolean(value) }
          case 'filename':
            return { ...prev, filename: typeof value === 'string' ? value : null }
          case 'path':
            return { ...prev, path: typeof value === 'string' ? value : null }
          case 'core-idle':
            return { ...prev, coreIdle: Boolean(value) }
          case 'demuxer-cache-duration':
            return { ...prev, cacheDuration: num(value) }
          case 'video-params/w':
            return { ...prev, videoWidth: typeof value === 'number' ? value : null }
          case 'video-params/h':
            return { ...prev, videoHeight: typeof value === 'number' ? value : null }
          case 'hwdec-current':
            return { ...prev, hwdec: typeof value === 'string' ? value : null }
          case 'frame-drop-count':
            return { ...prev, frameDrops: num(value) }
          case 'estimated-vf-fps':
            return { ...prev, fps: typeof value === 'number' ? value : null }
          case 'speed':
            return { ...prev, speed: num(value, 1) }
          case 'track-list':
            return { ...prev, tracks: Array.isArray(value) ? (value as Track[]) : [] }
          case 'sid':
            return { ...prev, sid: trackId(value) }
          case 'aid':
            return { ...prev, aid: trackId(value) }
          case 'sub-visibility':
            return { ...prev, subVisible: Boolean(value) }
          case 'sub-delay':
            return { ...prev, subDelay: num(value) }
          case 'audio-delay':
            return { ...prev, audioDelay: num(value) }
          // loop-file — это false или 'inf'/число повторов, а не булево
          case 'loop-file':
            return { ...prev, loop: value !== false && value !== 'no' }
          case 'loop-playlist':
            return { ...prev, loopPlaylist: value !== false && value !== 'no' }
          case 'video-aspect-override':
            return { ...prev, aspect: num(value, -1) }
          case 'playlist':
            return { ...prev, playlist: Array.isArray(value) ? (value as PlaylistEntry[]) : [] }
          case 'playlist-pos':
            return { ...prev, playlistPos: num(value, -1) }
          default:
            return prev
        }
      })
    }

    /**
     * Свойства, которые mpv прислал до того, как интерфейс успел подписаться.
     *
     * Без этого запроса состояние осталось бы начальным до первого изменения
     * каждого свойства. А не меняется как раз то, что уже стоит правильно:
     * mpv не паузе с самого запуска, `pause` остаётся false и молчит, — и
     * кнопка предлагала бы продолжить уже идущее видео.
     */
    const pullSnapshot = (): void => {
      void api.state().then((snapshot) => {
        for (const [name, value] of Object.entries(snapshot)) applyProperty(name, value)
      })
    }

    const offProperty = api.onProperty(applyProperty)

    // Готовность приходит и после перезапуска упавшего движка: прошлое
    // состояние там от мёртвого процесса, и его нужно забыть целиком —
    // а верное взять у нового
    const offReady = api.onReady(() => {
      setState({ ...INITIAL, ready: true })
      pullSnapshot()
    })

    const offExit = api.onExit(() => setState((p) => ({ ...p, crashed: true, ready: false })))

    pullSnapshot()

    return () => {
      offProperty()
      offReady()
      offExit()
    }
  }, [])

  return state
}

/**
 * Настройки: главный процесс — единственный, кто их хранит. Интерфейс всегда
 * показывает то, что вернулось оттуда, а не то, что предположил сам.
 */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    void window.keyframe.settings.get().then(setSettings)
    return window.keyframe.settings.onChange(setSettings)
  }, [])

  const update = useCallback((patch: Partial<Settings>): void => {
    void window.keyframe.settings.set(patch).then(setSettings)
  }, [])

  return [settings, update]
}

export interface OsdMessage {
  /** Меняется на каждом показе — по нему перезапускается анимация */
  id: number
  label: string
  /** 0–100, если у действия есть уровень: показывается полоской */
  meter?: number
  icon?: 'forward' | 'back' | 'volume' | 'mute'
}

/**
 * Всплывающая подсказка о том, что сделало нажатие клавиши.
 *
 * Без неё перемотка стрелками не даёт обратной связи: на паузе кадр меняется
 * незаметно, а громкость вообще никак не отображается.
 */
export function useOsd(): [OsdMessage | null, (message: Omit<OsdMessage, 'id'>) => void] {
  const [message, setMessage] = useState<OsdMessage | null>(null)
  const nextId = useRef(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Стабильная ссылка: показ подсказки попадает в зависимости обработчиков
  const show = useCallback((next: Omit<OsdMessage, 'id'>): void => {
    setMessage({ ...next, id: nextId.current++ })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 1100)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return [message, show]
}

export interface Preview {
  /** Секунда под курсором */
  time: number
  /** Отступ подсказки от левого края дорожки в пикселях */
  x: number
  /** data-URL кадра; null — пока не готов */
  frame: string | null
}

/**
 * Превью кадра под курсором на таймлайне.
 *
 * Кадры приходят из главного процесса и там же кэшируются. Последний
 * показанный кадр держится до прихода следующего: гасить картинку на каждое
 * движение мыши — мельтешение, а сосед по времени всё равно похож.
 */
export function usePreview(duration: number): [Preview | null, (time: number, x: number) => void, () => void] {
  const [preview, setPreview] = useState<Preview | null>(null)
  const lastFrame = useRef<string | null>(null)
  const inFlight = useRef(false)

  const show = useCallback(
    (time: number, x: number): void => {
      setPreview({ time, x, frame: lastFrame.current })

      if (duration <= 0 || inFlight.current) return
      inFlight.current = true

      void window.keyframe.mpv
        .thumbnail(time)
        .then((frame) => {
          if (!frame) return
          lastFrame.current = frame
          setPreview((prev) => (prev ? { ...prev, frame } : prev))
        })
        .finally(() => {
          inFlight.current = false
        })
    },
    [duration]
  )

  const hide = useCallback((): void => {
    lastFrame.current = null
    setPreview(null)
  }, [])

  return [preview, show, hide]
}

export interface Notice {
  id: number
  kind: 'error' | 'info'
  text: string
  action?: { label: string; run: () => void }
}

/**
 * Сообщение, которое нельзя показать вспышкой по центру: об ошибке нужно
 * успеть прочитать, а иногда и нажать кнопку.
 *
 * Ошибки висят, пока их не закроют: файл не открылся — это не мелочь, о которой
 * можно забыть через секунду. Всё остальное гаснет само.
 */
export function useNotice(): [Notice | null, (next: Omit<Notice, 'id'> | null) => void] {
  const [notice, setNotice] = useState<Notice | null>(null)
  const nextId = useRef(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((next: Omit<Notice, 'id'> | null): void => {
    if (timer.current) clearTimeout(timer.current)

    if (!next) {
      setNotice(null)
      return
    }

    setNotice({ ...next, id: nextId.current++ })
    if (next.kind === 'info') timer.current = setTimeout(() => setNotice(null), 4500)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return [notice, show]
}

/**
 * Состояние окна приходит только из главного процесса и никогда не угадывается
 * интерфейсом: развернуть окно или выйти из полного экрана можно и мимо наших
 * кнопок, а расходящееся состояние даёт кнопку, которая делает не то, что
 * нарисовано на её иконке.
 */
export function useWindowState(): { fullscreen: boolean; maximized: boolean; alwaysOnTop: boolean } {
  const [state, setState] = useState({ fullscreen: false, maximized: false, alwaysOnTop: false })

  useEffect(() => {
    void window.keyframe.window.state().then(setState)
    return window.keyframe.window.onState(setState)
  }, [])

  return state
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

export function useUpdate(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    void window.keyframe.update.status().then(setStatus)
    return window.keyframe.update.onStatus(setStatus)
  }, [])

  return status
}

export interface Scrub {
  ref: React.RefObject<HTMLDivElement | null>
  /** Позиция под пальцем, пока идёт перетаскивание. null — тащить перестали. */
  ratio: number | null
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
  }
}

/**
 * Перетаскиваемый ползунок: таймлайн и громкость.
 *
 * Захват указателя обязателен — без него курсор, вышедший за границы дорожки,
 * перестаёт слать события, и перетаскивание обрывается на полпути. Именно
 * поэтому раньше клик по таймлайну срабатывал, а протяжка нет.
 *
 * Пока тащим, положение берётся из ratio, а не из состояния плеера: mpv
 * присылает позицию с задержкой, и ползунок отставал бы от пальца.
 */
export function useScrub(onScrub: (ratio: number, done: boolean) => void): Scrub {
  const ref = useRef<HTMLDivElement | null>(null)
  const [ratio, setRatio] = useState<number | null>(null)
  const dragging = useRef(false)

  const ratioAt = (clientX: number): number => {
    const element = ref.current
    if (!element) return 0
    const box = element.getBoundingClientRect()
    if (box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }

  return {
    ref,
    ratio,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragging.current = true
        const value = ratioAt(event.clientX)
        setRatio(value)
        onScrub(value, false)
      },
      onPointerMove: (event) => {
        if (!dragging.current) return
        const value = ratioAt(event.clientX)
        setRatio(value)
        onScrub(value, false)
      },
      onPointerUp: (event) => {
        if (!dragging.current) return
        dragging.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
        const value = ratioAt(event.clientX)
        setRatio(null)
        onScrub(value, true)
      },
      onPointerCancel: () => {
        dragging.current = false
        setRatio(null)
      }
    }
  }
}

/**
 * Перетаскивание безрамочного окна. Двигать нужно host-окно, а курсор при этом
 * находится над оверлеем, поэтому дельту считаем по экранным координатам и
 * отдаём в главный процесс.
 */
export function useWindowDrag(): (event: React.MouseEvent) => void {
  return (event: React.MouseEvent) => {
    if (event.button !== 0) return

    void window.keyframe.window.dragStart(event.screenX, event.screenY)

    const onMove = (e: MouseEvent): void => {
      void window.keyframe.window.dragMove(e.screenX, e.screenY)
    }

    const onUp = (): void => {
      void window.keyframe.window.dragEnd()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
}

/** Прячет хром после простоя мыши; любое движение возвращает его. */
export function useIdleChrome(idleMs: number, active: boolean): boolean {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!active) {
      setVisible(true)
      return
    }

    let timer: ReturnType<typeof setTimeout>

    const bump = (): void => {
      setVisible(true)
      clearTimeout(timer)
      timer = setTimeout(() => setVisible(false), idleMs)
    }

    bump()
    window.addEventListener('mousemove', bump)
    window.addEventListener('keydown', bump)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', bump)
      window.removeEventListener('keydown', bump)
    }
  }, [idleMs, active])

  return visible
}
