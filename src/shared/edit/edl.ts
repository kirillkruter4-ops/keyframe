/**
 * Склейка нарезки для просмотра — протокол `edl://` самого mpv.
 *
 * Он склеивает куски одного файла по началу и длине без перекодирования, и
 * поэтому результат монтажа виден мгновенно: пересобрали строку, `loadfile` —
 * и плеер играет уже нарезку. Свой композитор не нужен, рендер нужен только на
 * экспорт.
 */
import { type Project, segmentLength } from './project'

const encoder = new TextEncoder()

/**
 * Длина строки в байтах, а не в символах.
 *
 * mpv отсчитывает поле по байтам: в пути с кириллицей символов вдвое меньше,
 * чем байтов, и посчитанная по символам длина обрежет путь на середине.
 */
function byteLength(value: string): number {
  return encoder.encode(value).length
}

/** Три знака после запятой: миллисекунда — предел, который имеет смысл для реза. */
function seconds(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}

/**
 * Строка `edl://` для нарезки.
 *
 * Путь экранируется по длине (`%162%C:\...`), иначе двоеточие после буквы диска
 * разбирается как разделитель полей и весь адрес разваливается.
 *
 * Пустой проект даёт null: играть нечего, и `loadfile` с пустой склейкой mpv
 * встретил бы ошибкой.
 */
export function edlUrl(project: Project): string | null {
  if (project.segments.length === 0) return null

  const path = project.source
  const prefix = `%${byteLength(path)}%${path}`

  const parts = project.segments.map(
    (segment) => `${prefix},${seconds(segment.in)},${seconds(segmentLength(segment))};`
  )

  return `edl://${parts.join('')}`
}

/**
 * Нужна ли склейка вообще.
 *
 * Целый нетронутый файл незачем показывать через `edl://`: обычный путь и
 * быстрее открывается, и оставляет соседей по папке в списке воспроизведения
 * (`isStream` считает `edl://` потоком и папку не подтягивает).
 */
export function isWholeFile(project: Project): boolean {
  if (project.segments.length !== 1) return false
  const [only] = project.segments
  return only.in <= 0 && only.out >= project.duration - 0.001
}
