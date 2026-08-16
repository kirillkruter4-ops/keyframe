/**
 * Как из нарезки получается файл.
 *
 * Два способа, и разница между ними видна пользователю, поэтому она названа
 * честно, а не спрятана за «быстро/качественно»:
 *
 * **Копирование** не трогает изображение вовсе — потоки переписываются как
 * есть. Секунды на фильм любой длины, качество исходника ровно. Но резать
 * можно только по ключевым кадрам: реальная граница уедет назад, иногда на
 * пару секунд.
 *
 * **Перекодирование** режет ровно там, где сказано, ценой прохода по всему
 * материалу. На видеокарте (NVENC) это всё равно в разы быстрее просмотра.
 */
export type ExportMode = 'copy' | 'encode'

export type Encoder = 'h264_nvenc' | 'hevc_nvenc' | 'libx264' | 'libx265'

/** Три ступени вместо числа: битрейт и cq пользователю ничего не говорят. */
export type Quality = 'high' | 'balanced' | 'small'

export interface ExportSegment {
  in: number
  out: number
}

export interface ExportRequest {
  source: string
  target: string
  segments: ExportSegment[]
  mode: ExportMode
  encoder: Encoder
  quality: Quality
  /** Есть ли в исходнике звук: без него фильтры звука ломают всю команду */
  hasAudio: boolean
  /**
   * Заменить исходный файл результатом.
   *
   * Пишем всё равно во временный файл рядом и подменяем только после успеха:
   * оборванный экспорт не должен оставить от фильма огрызок. Исходник при этом
   * до последнего момента цел.
   */
  replaceSource: boolean
}

export type ExportProgress =
  | { state: 'idle' }
  | { state: 'preparing' }
  | { state: 'downloading'; percent: number }
  | { state: 'running'; percent: number; etaSeconds: number | null }
  | { state: 'done'; target: string; replaced: boolean }
  | { state: 'cancelled' }
  | { state: 'error'; message: string }

/** Постоянная величина cq/crf по ступени качества. */
const QUALITY_LEVEL: Record<Quality, number> = {
  high: 19,
  balanced: 23,
  small: 28
}

function seconds(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}

/**
 * Список для concat-демультиплексора ffmpeg.
 *
 * Именно он, а не склейка через промежуточные файлы: `inpoint`/`outpoint`
 * позволяют вырезать куски и склеить их за один проход с `-c copy`, и это
 * работает с любым контейнером, а не только с теми, что умеют в mpegts.
 *
 * Одинарные кавычки в пути экранируются по правилам ffmpeg: закрыть строку,
 * поставить экранированную кавычку, открыть снова.
 */
export function concatList(source: string, segments: readonly ExportSegment[]): string {
  const escaped = source.replace(/'/g, "'\\''")

  return segments
    .map(
      (segment) =>
        `file '${escaped}'\ninpoint ${seconds(segment.in)}\noutpoint ${seconds(segment.out)}\n`
    )
    .join('')
}

/** Аргументы быстрого экспорта: потоки переписываются без перекодирования. */
export function copyArgs(listFile: string, target: string): string[] {
  return [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    // Куски начинаются не с нуля, и без этого первый кадр получает
    // отрицательную метку времени — часть плееров показывает на этом месте рывок
    '-avoid_negative_ts',
    'make_zero',
    '-y',
    target
  ]
}

/**
 * Аргументы точного экспорта.
 *
 * Один проход с filter_complex, а не по куску за раз с последующей склейкой:
 * так исходник читается один раз, и не остаётся временных файлов размером с
 * фильм.
 */
export function encodeArgs(request: ExportRequest): string[] {
  const { segments, hasAudio, encoder, quality } = request

  const parts: string[] = []
  const labels: string[] = []

  segments.forEach((segment, index) => {
    const range = `start=${seconds(segment.in)}:end=${seconds(segment.out)}`
    parts.push(`[0:v]trim=${range},setpts=PTS-STARTPTS[v${index}]`)
    labels.push(`[v${index}]`)

    if (hasAudio) {
      parts.push(`[0:a]atrim=${range},asetpts=PTS-STARTPTS[a${index}]`)
      labels.push(`[a${index}]`)
    }
  })

  const streams = hasAudio ? 'v=1:a=1' : 'v=1:a=0'
  const outputs = hasAudio ? '[v][a]' : '[v]'
  parts.push(`${labels.join('')}concat=n=${segments.length}:${streams}${outputs}`)

  const level = QUALITY_LEVEL[quality]
  const nvenc = encoder.endsWith('_nvenc')

  const video = nvenc
    ? // p5 — середина шкалы NVENC: заметно лучше p1 и почти так же быстро.
      // vbr с cq даёт постоянное качество, а не постоянный битрейт: на статичной
      // сцене файл выйдет меньше без потери на динамичной
      ['-c:v', encoder, '-preset', 'p5', '-rc', 'vbr', '-cq', String(level), '-b:v', '0']
    : ['-c:v', encoder, '-preset', 'medium', '-crf', String(level)]

  const audio = hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']

  return [
    '-i',
    request.source,
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[v]',
    ...(hasAudio ? ['-map', '[a]'] : []),
    ...video,
    ...audio,
    // Файл начинает играть, не дожидаясь загрузки целиком
    '-movflags',
    '+faststart',
    '-y',
    request.target
  ]
}

/** Сколько секунд результата получится: по ним считается процент выполнения. */
export function totalLength(segments: readonly ExportSegment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.out - segment.in), 0)
}
