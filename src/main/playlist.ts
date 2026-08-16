import fs from 'node:fs'
import path from 'node:path'
import type { Mpv } from './mpv'

/**
 * Что считаем медиафайлом при обходе папки. Список намеренно совпадает с
 * ассоциациями из electron-builder.yml: плеер должен подхватывать в папке
 * ровно то, что берётся открывать по двойному щелчку.
 */
const MEDIA_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.webm', '.flv', '.m4v', '.mpg', '.mpeg',
  '.ts', '.m2ts', '.wmv', '.3gp', '.ogv',
  '.mp3', '.flac', '.aac', '.m4a', '.opus', '.ogg', '.wav', '.wma', '.alac', '.ape'
])

const PLAYLIST_EXTENSIONS = new Set(['.m3u', '.m3u8', '.pls'])

/**
 * Сколько файлов из папки берём в список.
 *
 * Ограничение не про память, а про случайность: открыв файл из «Загрузок» с
 * тысячей роликов, никто не ждёт, что следующим заиграет что-то из них.
 */
const FOLDER_LIMIT = 500

export function isPlaylistFile(target: string): boolean {
  return PLAYLIST_EXTENSIONS.has(path.extname(target).toLowerCase())
}

export function isMediaFile(target: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(target).toLowerCase())
}

/**
 * Соседи файла по папке в том порядке, в каком их показывает проводник:
 * «10» после «2», а не между «1» и «3».
 */
export function folderEntries(target: string): string[] {
  // resolve обязателен: путь приходит и с прямыми слэшами (переменная
  // окружения, командная строка), и с обратными (проводник, перетаскивание).
  // Без приведения к одному виду файл не находил сам себя среди соседей,
  // и список молча оставался из одного элемента
  const dir = path.dirname(path.resolve(target))

  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return [target]
  }

  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

  const files = names
    .filter((name) => MEDIA_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort(collator.compare)
    .map((name) => path.join(dir, name))

  if (files.length === 0 || files.length > FOLDER_LIMIT) return [path.resolve(target)]
  return files
}

/** Поток существует не на диске: соседей по папке у него нет. */
function isStream(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(target)
}

/**
 * Открыть то, по чему щёлкнули.
 *
 * Плейлист отдаём mpv как плейлист. Обычный файл начинает играть сразу, а
 * следом в список добавляются его соседи по папке — чтобы «дальше» и «назад»
 * вели туда, куда от них ждут, и без паузы на чтение каталога перед стартом.
 */
export async function openPath(mpv: Mpv, target: string, fillFromFolder: boolean): Promise<void> {
  if (isPlaylistFile(target)) {
    await mpv.command('loadlist', target, 'replace')
    return
  }

  await mpv.loadFile(target)

  if (!fillFromFolder || isStream(target)) return

  const full = path.resolve(target)
  const entries = folderEntries(full)
  const index = entries.findIndex((entry) => entry.toLowerCase() === full.toLowerCase())
  if (entries.length < 2 || index < 0) return

  /*
   * Команды уходят пачкой, а не по очереди с ожиданием ответа на каждую.
   * Порядок при этом сохраняется — канал один и записи в него упорядочены, —
   * а полтысячи кругов ожидания на большой папке превращались в заметную
   * задержку сразу после начала воспроизведения.
   */
  await Promise.all(
    entries
      .filter((entry) => entry !== entries[index])
      .map((entry) => mpv.command('loadfile', entry, 'append'))
  )

  /*
   * Открытый файл сейчас стоит первым, а остальные — в порядке папки за ним.
   * Возвращаем его на своё место одним перемещением: перебирать список
   * заново нельзя, это остановило бы уже начавшееся воспроизведение.
   *
   * Второй аргумент на единицу больше целевой позиции: mpv понимает его как
   * «встать перед этой записью», а сама запись после изъятия первой сдвинется.
   */
  if (index > 0) await mpv.command('playlist-move', 0, index + 1)
}

/** Добавить в конец списка, ничего не прерывая: так работает перетаскивание нескольких файлов. */
export async function appendPaths(mpv: Mpv, targets: string[]): Promise<void> {
  for (const target of targets) {
    await mpv.command(isPlaylistFile(target) ? 'loadlist' : 'loadfile', target, 'append')
  }
}
