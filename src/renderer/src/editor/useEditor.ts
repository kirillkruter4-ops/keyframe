import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MIN_SEGMENT,
  boundaries,
  createProject,
  pointAt,
  segmentLength,
  timelineDuration,
  timelineTimeOfSource,
  type Project,
  type Segment
} from '../../../shared/edit/project'
import {
  cutRange,
  duplicateSegments,
  keepRange,
  moveSegment,
  removeSegments,
  splitAt,
  trimSegment,
  type Edge
} from '../../../shared/edit/operations'
import { canRedo, canUndo, createHistory, push, redo, undo, type History } from '../../../shared/edit/history'
import { edlUrl } from '../../../shared/edit/edl'

/**
 * Состояние редактора и всё, что он делает с плеером.
 *
 * Ключевая мысль: пока редактор открыт, mpv показывает не файл, а склейку
 * `edl://` из кусков. Поэтому позиция воспроизведения — это и есть монтажное
 * время, без всякого пересчёта: плейхед берётся прямо из `time-pos`, а рез в
 * произвольном месте виден сразу после пересборки склейки.
 *
 * Пересборка стоит около десяти миллисекунд и не растёт с числом кусков
 * (замерено на пятнадцати), поэтому склейка пересобирается на каждое действие,
 * а не по кнопке «обновить превью».
 */

/** Отступ от края при автопрокрутке за плейхедом. */
const FOLLOW_MARGIN = 80

export interface Marks {
  in: number | null
  out: number | null
}

export interface EditorApi {
  project: Project
  /** Выделенные куски. Порядок не важен, важен состав */
  selection: readonly string[]
  marks: Marks
  duration: number
  canUndo: boolean
  canRedo: boolean
  /** Монтажная секунда под плейхедом. Ref, а не состояние: меняется с частотой кадров */
  playhead: React.RefObject<number>

  select: (ids: readonly string[]) => void
  toggleSelect: (id: string) => void
  selectRange: (id: string) => void

  seek: (time: number, exact?: boolean) => void
  split: () => void
  remove: () => void
  duplicate: () => void
  move: (id: string, toIndex: number) => void
  /** continuous — протяжка ещё идёт: шаг отмены заменяется, а не добавляется */
  trim: (id: string, edge: Edge, sourceTime: number, continuous?: boolean) => void
  endLive: () => void
  markIn: () => void
  markOut: () => void
  cutMarked: () => void
  keepMarked: () => void
  clearMarks: () => void
  stepFrame: (direction: number) => void
  toBoundary: (direction: number) => void
  reset: () => void
  /** Заменить модель целиком — для операций над всей нарезкой сразу */
  replace: (next: Project) => void
  undo: () => void
  redo: () => void

  /** Перерисовать плейхед: зовётся из таймлайна на прокрутке и зуме */
  onDraw: React.RefObject<((time: number) => void) | null>
}

export interface EditorOptions {
  source: string
  duration: number
  /** Секунда исходника, на которой был зритель до входа в редактор */
  startAt: number
  onNotice: (text: string) => void
}

/**
 * Куски из сохранённого проекта или один кусок во весь файл.
 *
 * Идентификаторы выдаются заново: они живут только внутри сессии редактора и
 * в state.json не сохраняются — там от куска важны лишь его границы.
 */
function restore(source: string, duration: number, saved: { in: number; out: number }[] | null): Project {
  if (!saved || saved.length === 0) return createProject(source, duration)

  const whole = createProject(source, duration)
  const segments: Segment[] = saved.map((segment, index) => ({
    id: `r${index}`,
    in: Math.max(0, segment.in),
    out: Math.min(duration, segment.out)
  }))

  const valid = segments.filter((segment) => segmentLength(segment) >= MIN_SEGMENT)
  return valid.length > 0 ? { ...whole, segments: valid } : whole
}

export function useEditor({ source, duration, startAt, onNotice }: EditorOptions): EditorApi {
  const [history, setHistory] = useState<History<Project>>(() =>
    createHistory(createProject(source, duration))
  )
  const [selection, setSelection] = useState<readonly string[]>([])
  const [marks, setMarks] = useState<Marks>({ in: null, out: null })

  const project = history.present
  const playhead = useRef(0)
  const onDraw = useRef<((time: number) => void) | null>(null)
  const mpv = window.keyframe.mpv

  /**
   * Загрузить склейку и встать на нужную секунду одной командой.
   *
   * `loadfile <url> replace -1 start=<секунда>` — иначе между загрузкой и
   * переходом успевает мелькнуть нулевой кадр, а после каждого реза это
   * выглядит как моргание всего фильма.
   */
  /**
   * Пересборка склейки во время протяжки идёт не чаще, чем раз в девяносто
   * миллисекунд.
   *
   * Сама команда стоит десять, но за ней стоит инициализация декодера, и на
   * четырёхкратном HEVC шестьдесят перезагрузок в секунду — это уже заметно.
   * Плейхед и раскладка при этом обновляются сразу: тормозить должно только то,
   * что показывает mpv, а не то, что рисуем мы.
   */
  const queued = useRef<(() => void) | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const send = queued.current
    queued.current = null
    send?.()
  }, [])

  const load = useCallback(
    (next: Project, at: number, live = false) => {
      const url = edlUrl(next)
      if (!url) return

      const total = timelineDuration(next)
      const time = Math.min(Math.max(at, 0), Math.max(0, total - 0.001))

      playhead.current = time
      onDraw.current?.(time)

      const send = (): void => {
        void mpv.command('loadfile', url, 'replace', -1, `start=${time}`)
      }

      if (!live) {
        flush()
        send()
        return
      }

      queued.current = send
      if (timer.current === null) {
        timer.current = setTimeout(() => {
          timer.current = null
          const pending = queued.current
          queued.current = null
          pending?.()
        }, 90)
      }
    },
    [mpv, flush]
  )

  useEffect(() => () => flush(), [flush])

  /**
   * Идёт ли непрерывное действие — протяжка края куска.
   *
   * Пока она идёт, состояние в стеке отмены заменяется, а не добавляется:
   * иначе одна протяжка оставляла бы сотню шагов, и `Ctrl+Z` пришлось бы жать
   * столько же раз, сколько было движений мышью.
   */
  const live = useRef(false)

  /** Новое состояние модели: в стек отмены, в склейку, в выделение. */
  const apply = useCallback(
    (next: Project, at: number, select?: readonly string[], continuous = false) => {
      if (next === project) return

      if (next.segments.length === 0) {
        onNotice('Нельзя удалить всё: должен остаться хотя бы один кусок')
        return
      }

      const replacing = continuous && live.current
      live.current = continuous

      setHistory((current) =>
        replacing ? { past: current.past, present: next, future: [] } : push(current, next)
      )
      if (select) setSelection(select)
      load(next, at, continuous)
    },
    [project, load, onNotice]
  )

  /** Протяжка кончилась: следующее действие снова добавит шаг отмены. */
  const endLive = useCallback(() => {
    live.current = false
    flush()
  }, [flush])

  // Вход в редактор: восстановить сохранённую нарезку и встать туда, где был зритель
  useEffect(() => {
    let cancelled = false

    void window.keyframe.editor.setActive(true)
    void window.keyframe.editor.loadProject(source, duration).then((saved) => {
      if (cancelled) return

      /*
       * Восстановленная нарезка — это первый шаг истории, а не её начало.
       *
       * Иначе выход из редактора превращал резку в необратимую: вернулся —
       * и Ctrl+Z уже нечего отменять, хотя кусок явно лишний. Целый файл в
       * основании стека возвращает всё одним нажатием.
       */
      const whole = createProject(source, duration)
      const restored = restore(source, duration, saved)
      const same = restored.segments.length === 1 && restored.segments[0].out >= duration - 0.001

      setHistory(same ? createHistory(whole) : push(createHistory(whole), restored))
      load(restored, timelineTimeOfSource(restored, startAt))
      void mpv.set('pause', true)
    })

    return () => {
      cancelled = true
    }
    // Редактор открывается на один файл и живёт до выхода: перезапускать это
    // при смене колбэка нельзя, иначе нарезка сбросится посреди работы
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, duration])

  // Сохранение с задержкой: во время резки модель меняется несколько раз в
  // секунду, а на диск это писать незачем
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.keyframe.editor.saveProject(
        source,
        project.segments.map((segment) => ({ in: segment.in, out: segment.out })),
        duration
      )
    }, 700)

    return () => clearTimeout(timer)
  }, [project, source, duration])

  const seek = useCallback(
    (time: number, exact = true) => {
      const total = timelineDuration(project)
      const value = Math.min(Math.max(time, 0), total)
      playhead.current = value
      onDraw.current?.(value)
      void mpv.command('seek', value, exact ? 'absolute' : 'absolute+keyframes')
    },
    [mpv, project]
  )

  const split = useCallback(() => {
    const at = playhead.current
    const point = pointAt(project, at)
    const next = splitAt(project, at)

    if (next === project || !point) {
      onNotice('Здесь резать нечего: плейхед на стыке кусков')
      return
    }

    // Выделяем правую половину: дальше чаще режут или удаляют именно её
    const created = next.segments[point.index + 1]
    apply(next, at, created ? [created.id] : [])
  }, [project, apply, onNotice])

  const remove = useCallback(() => {
    if (selection.length === 0) {
      onNotice('Сначала выберите кусок')
      return
    }

    // Плейхед встаёт туда, где смыкается разрез: это то место, которое
    // пользователь и хочет проверить после удаления
    const starts = boundaries(project)
    const first = project.segments.findIndex((segment) => selection.includes(segment.id))
    const at = first >= 0 ? starts[first] : playhead.current

    apply(removeSegments(project, selection), at, [])
  }, [project, selection, apply, onNotice])

  const duplicate = useCallback(() => {
    if (selection.length === 0) {
      onNotice('Сначала выберите кусок')
      return
    }
    apply(duplicateSegments(project, selection), playhead.current)
  }, [project, selection, apply, onNotice])

  const move = useCallback(
    (id: string, toIndex: number) => {
      const next = moveSegment(project, id, toIndex)
      if (next === project) return

      // После перестановки кусок оказался в другом месте нарезки — плейхед
      // переезжает вместе с ним, иначе непонятно, что именно переехало
      const index = next.segments.findIndex((segment) => segment.id === id)
      const starts = boundaries(next)
      apply(next, starts[index] ?? playhead.current, [id])
    },
    [project, apply]
  )

  const trim = useCallback(
    (id: string, edge: Edge, sourceTime: number, continuous = false) => {
      const next = trimSegment(project, id, edge, sourceTime)
      if (next === project) return

      const index = next.segments.findIndex((segment) => segment.id === id)
      const starts = boundaries(next)
      const start = starts[index] ?? 0
      const changed = next.segments[index]

      // Показываем тот край, который тянут: иначе тянешь конец, а смотришь на начало
      const at = edge === 'in' ? start : start + segmentLength(changed)
      apply(next, at, [id], continuous)
    },
    [project, apply]
  )

  const markIn = useCallback(() => {
    setMarks((current) => ({ ...current, in: playhead.current }))
  }, [])

  const markOut = useCallback(() => {
    setMarks((current) => ({ ...current, out: playhead.current }))
  }, [])

  const clearMarks = useCallback(() => setMarks({ in: null, out: null }), [])

  const cutMarked = useCallback(() => {
    if (marks.in === null || marks.out === null) {
      onNotice('Отметьте начало клавишей I и конец клавишей O')
      return
    }

    const from = Math.min(marks.in, marks.out)
    apply(cutRange(project, marks.in, marks.out), from)
    setMarks({ in: null, out: null })
  }, [project, marks, apply, onNotice])

  const keepMarked = useCallback(() => {
    if (marks.in === null || marks.out === null) {
      onNotice('Отметьте начало клавишей I и конец клавишей O')
      return
    }

    apply(keepRange(project, marks.in, marks.out), 0)
    setMarks({ in: null, out: null })
  }, [project, marks, apply, onNotice])

  /**
   * Покадрово — командами самого mpv: он знает частоту кадров склейки, а
   * считать её здесь значило бы промахиваться на файлах с переменной частотой.
   * Плейхед подтянется сам, когда придёт новая позиция.
   */
  const stepFrame = useCallback(
    (direction: number) => {
      void mpv.command(direction > 0 ? 'frame-step' : 'frame-back-step')
    },
    [mpv]
  )

  /** По границам кусков: там, где начинается следующий кусок, и есть рез. */
  const toBoundary = useCallback(
    (direction: number) => {
      const points = boundaries(project)
      const at = playhead.current

      const target =
        direction > 0
          ? points.find((point) => point > at + 1e-6)
          : [...points].reverse().find((point) => point < at - 1e-6)

      if (target !== undefined) seek(target)
    },
    [project, seek]
  )

  const reset = useCallback(() => {
    // Целый файл поверх целого файла — пустой шаг в стеке отмены и ничего больше
    const whole = project.segments.length === 1 && project.segments[0].out >= duration - 0.001
    if (whole && project.segments[0].in <= 0.001) return

    apply(createProject(source, duration), playhead.current, [])
    setMarks({ in: null, out: null })
  }, [source, duration, project, apply])

  const replace = useCallback(
    (next: Project) => apply(next, playhead.current),
    [apply]
  )

  const undoStep = useCallback(() => {
    setHistory((current) => {
      if (!canUndo(current)) return current
      const next = undo(current)
      load(next.present, Math.min(playhead.current, timelineDuration(next.present)))
      return next
    })
    setSelection([])
  }, [load])

  const redoStep = useCallback(() => {
    setHistory((current) => {
      if (!canRedo(current)) return current
      const next = redo(current)
      load(next.present, Math.min(playhead.current, timelineDuration(next.present)))
      return next
    })
    setSelection([])
  }, [load])

  const select = useCallback((ids: readonly string[]) => setSelection(ids), [])

  const toggleSelect = useCallback((id: string) => {
    setSelection((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    )
  }, [])

  /** Shift+клик: выделить всё между уже выделенным и нажатым. */
  const selectRange = useCallback(
    (id: string) => {
      setSelection((current) => {
        if (current.length === 0) return [id]

        const indexes = project.segments
          .map((segment, index) => (current.includes(segment.id) ? index : -1))
          .filter((index) => index >= 0)

        const target = project.segments.findIndex((segment) => segment.id === id)
        if (target < 0) return current

        const from = Math.min(target, ...indexes)
        const to = Math.max(target, ...indexes)
        return project.segments.slice(from, to + 1).map((segment) => segment.id)
      })
    },
    [project]
  )

  const duration_ = useMemo(() => timelineDuration(project), [project])

  return {
    project,
    selection,
    marks,
    duration: duration_,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    playhead,
    onDraw,
    select,
    toggleSelect,
    selectRange,
    seek,
    split,
    remove,
    duplicate,
    move,
    trim,
    endLive,
    markIn,
    markOut,
    cutMarked,
    keepMarked,
    clearMarks,
    stepFrame,
    toBoundary,
    reset,
    replace,
    undo: undoStep,
    redo: redoStep
  }
}

/** Прокрутить дорожку так, чтобы плейхед оставался на виду во время игры. */
export function followPlayhead(container: HTMLElement, x: number): void {
  const left = container.scrollLeft
  const right = left + container.clientWidth

  if (x > right - FOLLOW_MARGIN) {
    container.scrollLeft = x - container.clientWidth / 2
  } else if (x < left + FOLLOW_MARGIN) {
    container.scrollLeft = Math.max(0, x - container.clientWidth / 2)
  }
}
