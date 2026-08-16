/**
 * Операции над нарезкой.
 *
 * Все они чистые: получают проект, возвращают новый. Отмена поэтому не хранит
 * ни описаний действий, ни обратных операций — только прошлые состояния модели
 * (см. `history.ts`). Операция, которой нечего менять, возвращает тот же объект,
 * и отмена не запоминает пустой шаг.
 */
import {
  MIN_SEGMENT,
  type Project,
  type Segment,
  nextSegmentId,
  pointAt,
  segmentLength,
  timelineDuration,
  timelineStarts
} from './project'

function withSegments(project: Project, segments: readonly Segment[]): Project {
  return { ...project, segments }
}

/**
 * Разрезать нарезку в монтажном времени `time`.
 *
 * Разрез ровно на стыке кусков ничего не делает: он там уже есть. Разрез, после
 * которого один из кусков оказался бы короче кадра, тоже не делается — иначе
 * на дорожке появлялись бы куски, в которые невозможно попасть мышью.
 */
export function splitAt(project: Project, time: number): Project {
  const point = pointAt(project, time)
  if (!point) return project

  const { segment, index, sourceTime } = point
  if (sourceTime - segment.in < MIN_SEGMENT) return project
  if (segment.out - sourceTime < MIN_SEGMENT) return project

  const left: Segment = { id: segment.id, in: segment.in, out: sourceTime }
  const right: Segment = { id: nextSegmentId(), in: sourceTime, out: segment.out }

  const segments = [...project.segments]
  segments.splice(index, 1, left, right)
  return withSegments(project, segments)
}

/**
 * Удалить куски, сдвинув остальные (ripple).
 *
 * Дырок не остаётся: выброшенное время исчезает из нарезки целиком. Пустоту
 * оставлять нечем — исходник один, и чёрный кадр взять неоткуда ни склейке
 * `edl://`, ни экспорту без перекодирования.
 */
export function removeSegments(project: Project, ids: readonly string[]): Project {
  const doomed = new Set(ids)
  const segments = project.segments.filter((segment) => !doomed.has(segment.id))
  if (segments.length === project.segments.length) return project
  return withSegments(project, segments)
}

/** Оставить только выделенные куски — обратная сторона удаления. */
export function keepOnly(project: Project, ids: readonly string[]): Project {
  const kept = new Set(ids)
  const segments = project.segments.filter((segment) => kept.has(segment.id))
  if (segments.length === 0 || segments.length === project.segments.length) return project
  return withSegments(project, segments)
}

/** Дублировать куски — копия встаёт сразу за оригиналом. */
export function duplicateSegments(project: Project, ids: readonly string[]): Project {
  const chosen = new Set(ids)
  if (chosen.size === 0) return project

  const segments: Segment[] = []
  let changed = false

  for (const segment of project.segments) {
    segments.push(segment)
    if (chosen.has(segment.id)) {
      segments.push({ id: nextSegmentId(), in: segment.in, out: segment.out })
      changed = true
    }
  }

  return changed ? withSegments(project, segments) : project
}

/**
 * Переставить кусок на позицию `toIndex`.
 *
 * Индекс считается в списке **без** переставляемого куска — так его понимает
 * перетаскивание: «встать между этими двумя».
 */
export function moveSegment(project: Project, id: string, toIndex: number): Project {
  const from = project.segments.findIndex((segment) => segment.id === id)
  if (from < 0) return project

  const rest = [...project.segments]
  const [moved] = rest.splice(from, 1)
  const target = Math.min(Math.max(toIndex, 0), rest.length)
  if (target === from) return project

  rest.splice(target, 0, moved)
  return withSegments(project, rest)
}

export type Edge = 'in' | 'out'

/**
 * Потянуть край куска до исходной секунды `sourceTime`.
 *
 * Соседи не трогаются: у них своё исходное время, и растянутый край не должен
 * их съедать. Ограничения — исходник и минимальная длина.
 */
export function trimSegment(
  project: Project,
  id: string,
  edge: Edge,
  sourceTime: number
): Project {
  const index = project.segments.findIndex((segment) => segment.id === id)
  if (index < 0) return project

  const segment = project.segments[index]
  let next: Segment

  if (edge === 'in') {
    const limit = segment.out - MIN_SEGMENT
    const value = Math.min(Math.max(sourceTime, 0), limit)
    if (value === segment.in) return project
    next = { ...segment, in: value }
  } else {
    const limit = segment.in + MIN_SEGMENT
    const value = Math.max(Math.min(sourceTime, project.duration), limit)
    if (value === segment.out) return project
    next = { ...segment, out: value }
  }

  const segments = [...project.segments]
  segments[index] = next
  return withSegments(project, segments)
}

/**
 * Вырезать монтажный отрезок [from, to).
 *
 * Это `I` / `O` / `Ctrl+X`: отметил начало и конец плохого места, вырезал. Куски
 * на концах отрезка разрезаются, всё, что между, выбрасывается со сдвигом.
 */
export function cutRange(project: Project, from: number, to: number): Project {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (end - start < MIN_SEGMENT) return project

  const total = timelineDuration(project)
  if (start >= total || end <= 0) return project

  // Режем сначала правый край: разрез слева сдвинул бы индексы, но не времена,
  // а правый разрез после левого пришёлся бы на ту же монтажную секунду
  const cut = splitAt(splitAt(project, end), start)

  const starts = timelineStarts(cut)
  const doomed = cut.segments
    .filter((segment, index) => {
      const segmentStart = starts[index]
      const segmentEnd = segmentStart + segmentLength(segment)
      // Кусок целиком внутри отрезка. Сравнение с допуском: после двух разрезов
      // границы совпадают до последнего бита не всегда
      return segmentStart >= start - 1e-9 && segmentEnd <= end + 1e-9
    })
    .map((segment) => segment.id)

  return removeSegments(cut, doomed)
}

/**
 * Сдвинуть начала кусков на ключевые кадры.
 *
 * Быстрый экспорт копирует потоки и режет только по ключевым кадрам, поэтому
 * начало куска всё равно уедет назад. Эта операция делает уезд явным: то, что
 * покажет превью, и то, что попадёт в файл, становится одним и тем же.
 *
 * Ключевой кадр позже начала куска игнорируется: он бы отрезал то, что человек
 * оставил, а экспорт так не поступает.
 */
export function alignToKeyframes(
  project: Project,
  keyframes: ReadonlyMap<string, number>
): Project {
  let changed = false

  const segments = project.segments.map((segment) => {
    const keyframe = keyframes.get(segment.id)
    if (keyframe === undefined || keyframe >= segment.in || keyframe < 0) return segment

    changed = true
    return { ...segment, in: keyframe }
  })

  return changed ? withSegments(project, segments) : project
}

/** Оставить только монтажный отрезок [from, to) — «вырезать этот момент». */
export function keepRange(project: Project, from: number, to: number): Project {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const total = timelineDuration(project)

  const tail = cutRange(project, end, total)
  return cutRange(tail, 0, start)
}
