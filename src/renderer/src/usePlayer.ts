import { useCallback, useEffect, useRef, useState } from 'react'

export interface PlayerState {
  ready: boolean
  paused: boolean
  timePos: number
  duration: number
  volume: number
  muted: boolean
  filename: string | null
  coreIdle: boolean
  cacheDuration: number
  videoWidth: number | null
  videoHeight: number | null
  hwdec: string | null
  frameDrops: number
  fps: number | null
  crashed: boolean
}

const INITIAL: PlayerState = {
  ready: false,
  paused: true,
  timePos: 0,
  duration: 0,
  volume: 100,
  muted: false,
  filename: null,
  coreIdle: true,
  cacheDuration: 0,
  videoWidth: null,
  videoHeight: null,
  hwdec: null,
  frameDrops: 0,
  fps: null,
  crashed: false
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
          default:
            return prev
        }
      })
    }

    const offProperty = api.onProperty(applyProperty)
    const offReady = api.onReady(() => setState((p) => ({ ...p, ready: true })))
    const offExit = api.onExit(() => setState((p) => ({ ...p, crashed: true, ready: false })))

    // Состояние могло прийти до того, как интерфейс успел подписаться
    void api.state().then((snapshot) => {
      for (const [name, value] of Object.entries(snapshot)) applyProperty(name, value)
    })

    return () => {
      offProperty()
      offReady()
      offExit()
    }
  }, [])

  return state
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

/**
 * Состояние окна приходит только из главного процесса и никогда не угадывается
 * интерфейсом: развернуть окно или выйти из полного экрана можно и мимо наших
 * кнопок, а расходящееся состояние даёт кнопку, которая делает не то, что
 * нарисовано на её иконке.
 */
export function useWindowState(): { fullscreen: boolean; maximized: boolean } {
  const [state, setState] = useState({ fullscreen: false, maximized: false })

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
