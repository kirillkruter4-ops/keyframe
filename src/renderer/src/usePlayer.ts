import { useEffect, useState } from 'react'

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
