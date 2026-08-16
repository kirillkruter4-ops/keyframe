import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'

/**
 * ffmpeg для экспорта нарезки.
 *
 * В установщик он не кладётся: mpv в нём уже сто тринадцать мегабайт, и ещё
 * восемьдесят ради того, что нужно только тем, кто режет, — перебор. Поэтому
 * ffmpeg ищется на машине, а если его нет — скачивается при первом экспорте,
 * один раз, с показом прогресса.
 *
 * Сборка берётся GPL: приложение и так под GPL-3.0 из-за mpv, а несвободные
 * сборки (nonfree) распространять нельзя вовсе.
 */
const DOWNLOAD_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

/** Примерный размер архива — только чтобы показать проценты до первого ответа. */
export const DOWNLOAD_SIZE_MB = 45

export type FfmpegSource = 'bundled' | 'downloaded' | 'system'

/** Куда кладём скачанный ffmpeg: рядом с настройками, чтобы пережить обновление. */
function downloadedDir(): string {
  return path.join(app.getPath('userData'), 'ffmpeg')
}

function downloadedExe(): string {
  return path.join(downloadedDir(), 'ffmpeg.exe')
}

function exists(target: string): boolean {
  try {
    return fs.statSync(target).isFile()
  } catch {
    return false
  }
}

/** ffmpeg на PATH: если он у пользователя уже есть, качать сорок мегабайт незачем. */
function systemFfmpeg(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', ['ffmpeg'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const first = stdout.split(/\r?\n/).find((line) => line.trim().endsWith('.exe'))
      resolve(first ? first.trim() : null)
    })
  })
}

/**
 * Где ffmpeg сейчас, без скачивания. null — значит его нет и придётся качать.
 *
 * Порядок такой: своя копия рядом с mpv (если когда-нибудь окажется в
 * установщике), потом скачанная нами, потом системная. Своей доверяем больше:
 * системная может оказаться урезанной сборкой без нужных кодеков.
 */
export async function findFfmpeg(resourcesFfmpeg: string): Promise<string | null> {
  if (exists(resourcesFfmpeg)) return resourcesFfmpeg
  if (exists(downloadedExe())) return downloadedExe()
  return systemFfmpeg()
}

/** Ответ сервера с переходами: у GitHub скачивание всегда идёт через redirect. */
function fetchFollowing(url: string, depth = 0): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('Слишком много перенаправлений'))
      return
    }

    https
      .get(url, { headers: { 'User-Agent': 'Keyframe' } }, (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location

        if (status >= 300 && status < 400 && location) {
          response.resume()
          resolve(fetchFollowing(new URL(location, url).toString(), depth + 1))
          return
        }

        if (status !== 200) {
          response.resume()
          reject(new Error(`Сервер ответил ${status}`))
          return
        }

        resolve(response)
      })
      .on('error', reject)
  })
}

/**
 * Распаковка zip средствами Windows.
 *
 * tar есть в системе начиная с Windows 10 1803 и распаковывает zip; на всякий
 * случай остаётся PowerShell. Тянуть ради одного архива библиотеку в
 * зависимости не хочется — она попадёт в установщик, которого мы и избегаем.
 */
function unzip(archive: string, target: string): Promise<void> {
  const run = (command: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(command, args, { windowsHide: true }, (error) =>
        error ? reject(error) : resolve()
      )
    })

  return run('tar', ['-xf', archive, '-C', target]).catch(() =>
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`
    ])
  )
}

/** Найти ffmpeg.exe в распакованном дереве: имя папки внутри архива меняется от сборки к сборке. */
function findExe(dir: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findExe(full)
      if (found) return found
    } else if (entry.name.toLowerCase() === 'ffmpeg.exe') {
      return full
    }
  }
  return null
}

/**
 * Скачать и распаковать ffmpeg. Прогресс — доля от нуля до единицы.
 *
 * Скачивается во временный файл рядом с целевой папкой и переносится только
 * целиком: оборванная загрузка не должна оставить огрызок, который потом
 * примут за готовый ffmpeg.
 */
export async function downloadFfmpeg(onProgress: (ratio: number) => void): Promise<string> {
  const dir = downloadedDir()
  const temp = path.join(dir, 'download')

  fs.rmSync(temp, { recursive: true, force: true })
  fs.mkdirSync(temp, { recursive: true })

  const archive = path.join(temp, 'ffmpeg.zip')
  const response = await fetchFollowing(DOWNLOAD_URL)

  const total = Number(response.headers['content-length']) || DOWNLOAD_SIZE_MB * 1024 * 1024
  let received = 0
  let lastReported = -1

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(archive)

    response.on('data', (chunk: Buffer) => {
      received += chunk.length
      // Процент, а не каждый пакет: сообщений иначе десятки тысяч
      const percent = Math.floor((received / total) * 100)
      if (percent !== lastReported) {
        lastReported = percent
        onProgress(Math.min(1, received / total))
      }
    })

    response.on('error', reject)
    file.on('error', reject)
    file.on('finish', () => resolve())
    response.pipe(file)
  })

  await unzip(archive, temp)

  const exe = findExe(temp)
  if (!exe) throw new Error('В архиве не нашёлся ffmpeg.exe')

  const target = downloadedExe()
  fs.rmSync(target, { force: true })
  fs.renameSync(exe, target)
  fs.rmSync(temp, { recursive: true, force: true })

  return target
}

/**
 * Какие аппаратные кодировщики есть на этой машине.
 *
 * Спрашиваем сам ffmpeg, а не гадаем по видеокарте: на GTX 1660 SUPER есть
 * H.264 и HEVC, но у соседа может не быть ни того, ни другого, а список
 * кодировщиков зависит ещё и от сборки.
 */
export function availableEncoders(ffmpeg: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(new Set())
        return
      }

      const found = new Set<string>()
      for (const name of ['h264_nvenc', 'hevc_nvenc', 'libx264', 'libx265']) {
        if (stdout.includes(` ${name} `)) found.add(name)
      }
      resolve(found)
    })
  })
}

export interface RunProgress {
  /** Секунды готового результата */
  time: number
  /** Во сколько раз быстрее реального времени; 0 — ещё не известно */
  speed: number
}

export interface Run {
  done: Promise<void>
  cancel: () => void
}

/**
 * Запуск ffmpeg с разбором прогресса.
 *
 * Прогресс берётся из `-progress pipe:1`: это ключ=значение построчно, в
 * отличие от человеческой строки в stderr, которую пришлось бы разбирать
 * регулярками и которая меняется от версии к версии.
 */
export function run(
  ffmpeg: string,
  args: string[],
  onProgress: (progress: RunProgress) => void
): Run {
  const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-progress', 'pipe:1', ...args], {
    windowsHide: true
  })

  let cancelled = false
  let rest = ''
  let time = 0
  let speed = 0

  // Последние строки stderr: если ffmpeg упадёт, объяснить причину сможет
  // только он сам, а весь его вывод в сообщение не поместится
  const tail: string[] = []

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    rest += chunk
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''

    for (const line of lines) {
      const [key, value] = line.split('=')
      if (key === 'out_time_us' || key === 'out_time_ms') {
        // out_time_us — микросекунды; out_time_ms у ffmpeg на деле тоже они
        const parsed = Number(value)
        if (Number.isFinite(parsed)) time = parsed / 1_000_000
      } else if (key === 'speed') {
        const parsed = Number.parseFloat(value)
        if (Number.isFinite(parsed)) speed = parsed
      } else if (key === 'progress') {
        onProgress({ time, speed })
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    tail.push(chunk)
    if (tail.length > 40) tail.shift()
  })

  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (cancelled) {
        reject(new Error('отменено'))
      } else if (code === 0) {
        resolve()
      } else {
        const message = tail.join('').trim().split(/\r?\n/).slice(-3).join('\n')
        reject(new Error(message || `ffmpeg завершился с кодом ${code}`))
      }
    })
  })

  return {
    done,
    cancel: () => {
      cancelled = true
      child.kill()
    }
  }
}
