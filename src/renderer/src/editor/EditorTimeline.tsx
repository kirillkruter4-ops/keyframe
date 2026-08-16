import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useMpvProperty } from '../usePlayer'
import { formatTime } from '../format'
import { timelineStarts, segmentLength } from '../../../shared/edit/project'
import { Filmstrip, frameStep } from './Filmstrip'
import { followPlayhead, type EditorApi } from './useEditor'

/** Зазор по краям дорожки, чтобы первый и последний кусок не липли к стенкам. */
const PADDING = 12

/** Ближе этого к цели протяжка прилипает: восемь пикселей — примерно полпальца. */
const SNAP_PX = 8

/** Дальше этого движение считается перетаскиванием, а не щелчком. */
const DRAG_PX = 5

const MIN_PX_PER_SEC = 0.02
const MAX_PX_PER_SEC = 400

export interface TimelineControls {
  fit: () => void
  zoomBy: (factor: number) => void
}

export interface EditorTimelineProps {
  editor: EditorApi
  source: string
  controls: React.RefObject<TimelineControls | null>
  /**
   * Реальные точки реза при быстром экспорте: ключевой кадр не позже начала
   * куска. Показываем то, что попадёт в файл сверх запрошенного.
   */
  keyframes: ReadonlyMap<string, number>
}

/** Красивый шаг делений, при котором подписи не наезжают друг на друга. */
const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]

function tickStep(pxPerSec: number): number {
  const wanted = 90 / pxPerSec
  return TICKS.find((step) => step >= wanted) ?? TICKS[TICKS.length - 1]
}

type Drag =
  | { kind: 'scrub' }
  | { kind: 'trim'; id: string; edge: 'in' | 'out' }
  | { kind: 'move'; id: string; startX: number; index: number; moved: boolean }

/**
 * Дорожка редактора: линейка, куски с кадрами, плейхед.
 *
 * Плейхед берётся из `time-pos` и пишется прямо в стиль — по той же причине,
 * что и в дорожке просмотра: позиция меняется с частотой кадров видео, и
 * состояние React такую частоту не переживает. Пока открыт редактор, `time-pos`
 * это монтажное время: mpv играет склейку, а не файл.
 */
export function EditorTimeline({
  editor,
  source,
  controls,
  keyframes
}: EditorTimelineProps): JSX.Element {
  const scroll = useRef<HTMLDivElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const playhead = useRef<HTMLDivElement | null>(null)
  const clock = useRef<HTMLSpanElement | null>(null)

  const [pxPerSec, setPxPerSec] = useState(1)
  const zoom = useRef(1)
  zoom.current = pxPerSec

  const drag = useRef<Drag | null>(null)
  const playing = useRef(false)
  const [insertion, setInsertion] = useState<number | null>(null)

  const { duration, project } = editor
  const starts = timelineStarts(project)
  const width = Math.max(duration * pxPerSec, 1)

  /** Единственное место, которое двигает плейхед и переписывает таймкод. */
  const draw = useCallback((time: number) => {
    const x = time * zoom.current
    if (playhead.current) playhead.current.style.transform = `translate3d(${x}px, 0, 0)`
    if (clock.current) clock.current.textContent = formatTime(time)
    if (playing.current && scroll.current) followPlayhead(scroll.current, x)
  }, [])

  // Таймлайн — единственный, кто умеет рисовать плейхед; резка и перемотка
  // зовут его через эту ссылку, не дожидаясь ответа mpv
  useLayoutEffect(() => {
    editor.onDraw.current = draw
    return () => {
      editor.onDraw.current = null
    }
  }, [editor.onDraw, draw])

  useMpvProperty('time-pos', (value) => {
    if (drag.current?.kind === 'scrub') return
    const time = typeof value === 'number' ? value : 0
    editor.playhead.current = time
    draw(time)
  })

  useMpvProperty('pause', (value) => {
    playing.current = value === false
  })

  const fit = useCallback(() => {
    const box = scroll.current
    if (!box || duration <= 0) return
    const next = Math.max(MIN_PX_PER_SEC, (box.clientWidth - PADDING * 2) / duration)
    setPxPerSec(next)
    box.scrollLeft = 0
  }, [duration])

  /**
   * Зум вокруг плейхеда, а не вокруг левого края: то место, которое сейчас
   * смотрят, должно остаться под тем же пикселем.
   */
  const zoomBy = useCallback((factor: number) => {
    const box = scroll.current
    if (!box) return

    setPxPerSec((current) => {
      const next = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, current * factor))
      const anchor = editor.playhead.current
      const offset = anchor * current - box.scrollLeft
      box.scrollLeft = anchor * next - offset
      return next
    })
  }, [editor.playhead])

  useLayoutEffect(() => {
    controls.current = { fit, zoomBy }
  }, [controls, fit, zoomBy])

  // Первая раскладка: вписать целиком. Ширину контейнера до неё узнать неоткуда
  useLayoutEffect(() => {
    fit()
    // Только на входе в редактор: дальше зум принадлежит пользователю
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Зум мог остаться от прошлого файла — плейхед перерисовываем под новый
  useLayoutEffect(() => draw(editor.playhead.current), [pxPerSec, draw, editor.playhead])

  const timeAt = useCallback(
    (clientX: number): number => {
      const box = content.current
      if (!box) return 0
      const rect = box.getBoundingClientRect()
      return Math.min(Math.max((clientX - rect.left) / zoom.current, 0), duration)
    },
    [duration]
  )

  /** Прилипание к плейхеду, границам кусков и краям нарезки. */
  const snap = useCallback(
    (time: number, exclude: number): number => {
      const targets = [0, duration, editor.playhead.current, ...starts]
      const limit = SNAP_PX / zoom.current

      let best = time
      let distance = limit

      for (const target of targets) {
        if (Math.abs(target - exclude) < 1e-6) continue
        const delta = Math.abs(target - time)
        if (delta < distance) {
          distance = delta
          best = target
        }
      }

      return best
    },
    [duration, starts, editor.playhead]
  )

  /** Куда встанет перетаскиваемый кусок, если отпустить прямо сейчас. */
  const insertionIndex = useCallback(
    (clientX: number): number => {
      const time = timeAt(clientX)
      let index = 0

      for (let i = 0; i < project.segments.length; i += 1) {
        const middle = starts[i] + segmentLength(project.segments[i]) / 2
        if (time > middle) index = i + 1
      }

      return index
    },
    [project, starts, timeAt]
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    const segment = target.closest<HTMLElement>('.esegment')
    const edge = target.dataset.edge as 'in' | 'out' | undefined

    event.currentTarget.setPointerCapture(event.pointerId)

    if (segment && edge) {
      drag.current = { kind: 'trim', id: segment.dataset.id ?? '', edge }
      return
    }

    if (segment) {
      const id = segment.dataset.id ?? ''
      const index = project.segments.findIndex((item) => item.id === id)
      drag.current = { kind: 'move', id, startX: event.clientX, index, moved: false }
      return
    }

    drag.current = { kind: 'scrub' }
    editor.seek(timeAt(event.clientX), false)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    if (!active) return

    if (active.kind === 'scrub') {
      // По ключевым кадрам, пока тащим: так картинка успевает за пальцем
      editor.seek(timeAt(event.clientX), false)
      return
    }

    if (active.kind === 'trim') {
      const index = project.segments.findIndex((item) => item.id === active.id)
      if (index < 0) return

      const segment = project.segments[index]
      const start = starts[index]
      const time = snap(timeAt(event.clientX), start)
      editor.trim(active.id, active.edge, segment.in + (time - start), true)
      return
    }

    if (Math.abs(event.clientX - active.startX) > DRAG_PX) active.moved = true
    if (active.moved) setInsertion(insertionIndex(event.clientX))
  }

  const release = (event: React.PointerEvent<HTMLDivElement>): void => {
    const active = drag.current
    drag.current = null
    setInsertion(null)

    if (!active) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    if (active.kind === 'scrub') {
      // Один точный переход на отпускании: по ключевым кадрам мы уже доехали
      editor.seek(timeAt(event.clientX))
      return
    }

    if (active.kind === 'trim') {
      editor.endLive()
      return
    }

    if (active.moved) {
      const target = insertionIndex(event.clientX)
      // Индекс в списке без самого куска: перед ним всё сдвигается на один
      editor.move(active.id, target > active.index ? target - 1 : target)
      return
    }

    // Не двигали — значит это щелчок: выделить и встать плейхедом
    if (event.shiftKey) editor.selectRange(active.id)
    else if (event.ctrlKey) editor.toggleSelect(active.id)
    else {
      editor.select([active.id])
      editor.seek(timeAt(event.clientX))
    }
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey) return
    // Колесо без Ctrl оставляем прокрутке: она у контейнера своя, встроенная
    zoomBy(event.deltaY < 0 ? 1.25 : 0.8)
  }

  // Прокрутка колесом вбок по горизонтали: у мыши обычно нет второго колеса
  useEffect(() => {
    const box = scroll.current
    if (!box) return

    const onWheelNative = (event: WheelEvent): void => {
      if (event.ctrlKey) {
        // Иначе Chromium масштабирует всю страницу
        event.preventDefault()
        return
      }
      if (event.deltaX !== 0) return

      event.preventDefault()
      box.scrollLeft += event.deltaY
    }

    box.addEventListener('wheel', onWheelNative, { passive: false })
    return () => box.removeEventListener('wheel', onWheelNative)
  }, [])

  const step = frameStep(pxPerSec)
  const tick = tickStep(pxPerSec)
  const ticks: number[] = []
  for (let time = 0; time <= duration; time += tick) ticks.push(time)

  const marks = editor.marks
  const marked =
    marks.in !== null && marks.out !== null
      ? { from: Math.min(marks.in, marks.out), to: Math.max(marks.in, marks.out) }
      : null

  return (
    <div className="etimeline">
      <div className="etimeline__clock tnum">
        <span ref={clock}>0:00</span>
        <span className="etimeline__total"> / {formatTime(duration)}</span>
      </div>

      <div className="etimeline__scroll" ref={scroll}>
        <div
          className="etimeline__content"
          ref={content}
          style={{ width: `${width}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={release}
          onPointerCancel={release}
          onWheel={onWheel}
        >
          <div className="eruler">
            {ticks.map((time) => (
              <div className="eruler__tick" key={time} style={{ left: `${time * pxPerSec}px` }}>
                <span className="eruler__label tnum">{formatTime(time)}</span>
              </div>
            ))}
          </div>

          <div className="etrack">
            {project.segments.map((segment, index) => {
              const keyframe = keyframes.get(segment.id)
              const overshoot = keyframe !== undefined ? segment.in - keyframe : 0
              const width = segmentLength(segment) * pxPerSec

              return (
                <div
                  key={segment.id}
                  className="esegment"
                  data-id={segment.id}
                  data-selected={editor.selection.includes(segment.id)}
                  style={{ left: `${starts[index] * pxPerSec}px`, width: `${width}px` }}
                >
                  <Filmstrip
                    source={source}
                    from={segment.in}
                    to={segment.out}
                    step={step}
                    pxPerSec={pxPerSec}
                    root={scroll}
                  />

                  {overshoot > 0.05 && (
                    <div
                      className="esegment__overshoot"
                      style={{ width: `${overshoot * pxPerSec}px` }}
                      title={`Быстрый экспорт начнёт этот кусок на ${overshoot.toFixed(1)} с раньше: ближе ключевого кадра нет`}
                    />
                  )}

                  <div className="esegment__edge esegment__edge--in" data-edge="in" />
                  <div className="esegment__edge esegment__edge--out" data-edge="out" />

                  {/*
                    На узком куске подпись всё равно обрезается по половине
                    таймкода, а рядом с соседней превращается в кашу. Границы
                    видно и так — по стыку кусков и по линейке
                  */}
                  {width > 108 && (
                    <div className="esegment__label tnum">
                      {formatTime(segment.in)} – {formatTime(segment.out)}
                    </div>
                  )}
                </div>
              )
            })}

            {marked && (
              <div
                className="emarked"
                style={{
                  left: `${marked.from * pxPerSec}px`,
                  width: `${(marked.to - marked.from) * pxPerSec}px`
                }}
              />
            )}

            {/*
              Каждая метка видна сама по себе, не дожидаясь второй. Иначе
              нажатие I не меняет на экране ничего, и клавиша выглядит нерабочей
            */}
            {marks.in !== null && (
              <div className="eflag" data-edge="in" style={{ left: `${marks.in * pxPerSec}px` }}>
                <span className="eflag__label">I</span>
              </div>
            )}
            {marks.out !== null && (
              <div className="eflag" data-edge="out" style={{ left: `${marks.out * pxPerSec}px` }}>
                <span className="eflag__label">O</span>
              </div>
            )}

            {insertion !== null && (
              <div
                className="einsertion"
                style={{
                  left: `${(insertion < starts.length ? starts[insertion] : duration) * pxPerSec}px`
                }}
              />
            )}
          </div>

          <div className="eplayhead" ref={playhead}>
            <div className="eplayhead__head" />
          </div>
        </div>
      </div>
    </div>
  )
}
