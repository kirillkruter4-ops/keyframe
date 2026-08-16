/**
 * Модель монтажа: один исходный файл, разрезанный на куски.
 *
 * Здесь нет ни Electron, ни React, ни времени воспроизведения — только числа.
 * Это единственная часть редактора, которую можно проверить тестами целиком, и
 * ошибки на границах кусков ловятся именно здесь: глазами разницу между «конец
 * куска» и «начало следующего» не увидеть, а склейка от неё разъезжается.
 *
 * Два времени, которые нельзя путать:
 *   - **исходное** — секунды в файле, как их понимает mpv;
 *   - **монтажное** — секунды в получившейся нарезке, где выброшенного нет.
 * Сегмент задан исходными временами, плейхед живёт в монтажных.
 */

/**
 * Минимальная длина куска.
 *
 * Кусок короче кадра не имеет смысла ни на экране, ни в файле, а нулевой ломает
 * и склейку, и экспорт. Сорок миллисекунд — кадр при 25 к/с, самый длинный
 * кадр из практически встречающихся.
 */
export const MIN_SEGMENT = 0.04

export interface Segment {
  readonly id: string
  /** Секунда исходника, с которой кусок начинается (включительно) */
  readonly in: number
  /** Секунда исходника, на которой кусок кончается (исключительно) */
  readonly out: number
}

export interface Project {
  /** Путь к исходному файлу. Он не меняется никогда — режем только копию модели */
  readonly source: string
  /** Длительность исходника в секундах */
  readonly duration: number
  readonly segments: readonly Segment[]
}

let counter = 0

/**
 * Идентификатор куска.
 *
 * Куски различаются не индексом: индекс меняется при перестановке и удалении, а
 * выделение, отмена и перетаскивание должны переживать и то, и другое.
 */
export function nextSegmentId(): string {
  counter += 1
  return `s${counter}`
}

/** Проект из целого файла: один кусок от начала до конца. */
export function createProject(source: string, duration: number): Project {
  return {
    source,
    duration,
    segments: [{ id: nextSegmentId(), in: 0, out: Math.max(duration, MIN_SEGMENT) }]
  }
}

export function segmentLength(segment: Segment): number {
  return segment.out - segment.in
}

/** Длительность нарезки: то, сколько будет длиться экспортированный файл. */
export function timelineDuration(project: Project): number {
  return project.segments.reduce((sum, segment) => sum + segmentLength(segment), 0)
}

/** Монтажное время начала каждого куска — в порядке кусков. */
export function timelineStarts(project: Project): number[] {
  const starts: number[] = []
  let cursor = 0
  for (const segment of project.segments) {
    starts.push(cursor)
    cursor += segmentLength(segment)
  }
  return starts
}

export interface TimelinePoint {
  readonly segment: Segment
  readonly index: number
  /** Монтажное время начала куска */
  readonly start: number
  /** Соответствующая секунда исходника */
  readonly sourceTime: number
}

/**
 * Что находится в монтажном времени `time`.
 *
 * Граница принадлежит следующему куску: плейхед, стоящий ровно на стыке,
 * показывает кадр, который пойдёт дальше, а не последний кадр предыдущего.
 * Конец нарезки — исключение: там следующего куска нет, и точка остаётся за
 * последним.
 */
export function pointAt(project: Project, time: number): TimelinePoint | null {
  if (project.segments.length === 0) return null

  const starts = timelineStarts(project)
  const total = timelineDuration(project)
  const clamped = Math.min(Math.max(time, 0), total)

  for (let index = project.segments.length - 1; index >= 0; index -= 1) {
    const segment = project.segments[index]
    const start = starts[index]
    if (clamped >= start || index === 0) {
      const offset = Math.min(clamped - start, segmentLength(segment))
      return { segment, index, start, sourceTime: segment.in + Math.max(offset, 0) }
    }
  }

  return null
}

/** Монтажное время начала куска по его идентификатору; -1, если куска нет. */
export function startOf(project: Project, id: string): number {
  const index = project.segments.findIndex((segment) => segment.id === id)
  if (index < 0) return -1
  return timelineStarts(project)[index]
}

/**
 * Монтажное время исходной секунды.
 *
 * Нужно при входе в редактор из просмотра: пользователь остановился на какой-то
 * секунде фильма, и плейхед должен встать туда же. Одна и та же секунда
 * исходника может попасть в несколько кусков — берём первый, он же ближайший к
 * началу нарезки. Если секунда выброшена, возвращаем начало ближайшего куска
 * справа: оказаться в пустоте плейхед не может.
 */
export function timelineTimeOfSource(project: Project, sourceTime: number): number {
  const starts = timelineStarts(project)

  for (let index = 0; index < project.segments.length; index += 1) {
    const segment = project.segments[index]
    if (sourceTime < segment.in) return starts[index]
    if (sourceTime < segment.out) return starts[index] + (sourceTime - segment.in)
  }

  return timelineDuration(project)
}

/** Границы кусков в монтажном времени, включая начало и конец нарезки. */
export function boundaries(project: Project): number[] {
  const starts = timelineStarts(project)
  return [...starts, timelineDuration(project)]
}
