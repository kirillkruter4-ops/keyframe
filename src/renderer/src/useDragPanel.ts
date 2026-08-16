import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

interface Point {
  left: number
  top: number
}

/**
 * Куда пользователь передвинул панель.
 *
 * Живёт вне компонентов: панель размонтируется при закрытии, а место, куда её
 * поставили, забывать не нужно — открыв настройки второй раз, их ждут там же,
 * где оставили. До перезапуска: класть такое в файл настроек незачем.
 */
const positions = new Map<string, Point>()

/** Сколько панели обязано остаться на экране, чтобы её можно было вернуть мышью. */
const KEEP_VISIBLE = 80

/**
 * Когда закончилось последнее перетаскивание.
 *
 * Отпустив кнопку, браузер шлёт click — и если панель к этому моменту уехала
 * из-под курсора, щелчок достаётся видеослою, который закрывает панели. Без
 * этой отметки панель захлопывалась бы ровно в тот момент, когда её поставили
 * на новое место.
 */
let draggedAt = 0

export function justDragged(): boolean {
  return Date.now() - draggedAt < 150
}

/**
 * Ширина нужна, чтобы панель, уехавшую влево, всё ещё было за что ухватить:
 * от неё считается, сколько правого края осталось на экране. По вертикали
 * хватает верхней границы — за нижний край шапка не уходит.
 */
function clamp(point: Point, width: number): Point {
  return {
    left: Math.min(Math.max(point.left, KEEP_VISIBLE - width), window.innerWidth - KEEP_VISIBLE),
    // Сверху ноль: шапка за верхним краем — это панель, которую уже не ухватить
    top: Math.min(Math.max(point.top, 0), window.innerHeight - KEEP_VISIBLE)
  }
}

/**
 * Перетаскивание панели за её шапку.
 *
 * До первого перетаскивания панель стоит там, куда её поставил CSS — по центру
 * экрана. Собственные координаты появляются только в момент захвата: до этого
 * их неоткуда взять, не измеряя элемент, а измерять то, что и так на месте,
 * незачем.
 */
export function useDragPanel(id: string): {
  ref: React.RefObject<HTMLDivElement | null>
  style: CSSProperties
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  }
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [point, setPoint] = useState<Point | null>(positions.get(id) ?? null)
  const grab = useRef<{ dx: number; dy: number; width: number } | null>(null)

  // Окно могли уменьшить, пока панель была закрыта: возвращаем её в поле зрения
  useEffect(() => {
    const stored = positions.get(id)
    if (!stored) return

    const box = ref.current?.getBoundingClientRect()
    const next = clamp(stored, box?.width ?? 0)
    positions.set(id, next)
    setPoint(next)
  }, [id])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      // Кнопки в шапке — закрыть, очистить — не должны таскать панель
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return

      const element = ref.current
      if (!element) return

      const box = element.getBoundingClientRect()
      grab.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, width: box.width }

      // Первое движение начинается ровно оттуда, где панель стоит сейчас,
      // — без рывка из центра в точку захвата
      setPoint({ left: box.left, top: box.top })
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    []
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      const held = grab.current
      if (!held) return

      const next = clamp({ left: event.clientX - held.dx, top: event.clientY - held.dy }, held.width)
      positions.set(id, next)
      setPoint(next)
    },
    [id]
  )

  const release = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (!grab.current) return
    grab.current = null
    draggedAt = Date.now()
    event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  return {
    ref,
    /*
     * Пока панель не двигали, стили остаются целиком за CSS.
     *
     * Появление отключается вместе с центрированием: анимация въезда сдвигает
     * ту же transform, и панель, открытая на прежнем месте, сначала прилетала
     * бы в центр экрана, а потом прыгала обратно.
     */
    style: point
      ? { left: point.left, top: point.top, transform: 'none', animation: 'none' }
      : {},
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release
    }
  }
}
