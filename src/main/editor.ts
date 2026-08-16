import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  concatList,
  copyArgs,
  encodeArgs,
  totalLength,
  type Encoder,
  type ExportProgress,
  type ExportRequest
} from '../shared/edit/export'
import { availableEncoders, downloadFfmpeg, findFfmpeg, run, type Run } from './ffmpeg'
import type { Store } from './store'
import type { Thumbnailer } from './thumbnailer'

/**
 * Всё, что редактору нужно от системы: диск, ffmpeg и второй mpv для кадров.
 *
 * Собрано в одном месте и получает зависимости снаружи — иначе index.ts, и без
 * того самый большой файл главного процесса, вырос бы ещё на треть.
 */
export interface EditorDeps {
  store: () => Store | null
  thumbnailer: () => Thumbnailer | null
  overlay: () => BrowserWindow | null
  /** Путь к ffmpeg внутри установщика, если он там когда-нибудь окажется */
  bundledFfmpeg: string
  /** Отпустить файл: пока mpv его читает, Windows не даст его подменить */
  release: () => Promise<void>
  /** Открыть файл заново после подмены */
  reopen: (file: string) => Promise<void>
}

let current: Run | null = null

function send(deps: EditorDeps, progress: ExportProgress): void {
  const overlay = deps.overlay()
  if (!overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return
  overlay.webContents.send('editor:progress', progress)
}

/**
 * Имя для нарезки по имени исходника: «фильм.mkv» → «фильм (нарезка).mp4».
 *
 * Расширение меняем на mp4 только при перекодировании: при копировании потоки
 * остаются исходными, и класть, например, HEVC с DTS в mp4 — верный способ
 * получить файл, который не откроется.
 */
export function suggestedName(source: string, keepContainer: boolean): string {
  const parsed = path.parse(source)
  const extension = keepContainer ? parsed.ext || '.mkv' : '.mp4'
  return `${parsed.name} (нарезка)${extension}`
}

export function setupEditor(deps: EditorDeps): void {
  ipcMain.handle('editor:project:load', (_e, source: string, duration: number) => {
    return deps.store()?.projectFor(source, duration) ?? null
  })

  ipcMain.handle(
    'editor:project:save',
    (_e, source: string, segments: { in: number; out: number }[], duration: number) => {
      deps.store()?.saveProject(source, segments, duration)
    }
  )

  ipcMain.handle('editor:thumb', (_e, source: string, seconds: number) => {
    return deps.thumbnailer()?.frame(source, seconds) ?? null
  })

  ipcMain.handle('editor:keyframe', (_e, source: string, seconds: number) => {
    return deps.thumbnailer()?.keyframeAt(source, seconds) ?? null
  })

  /**
   * Какие кодировщики доступны. Пустой список — ffmpeg ещё не скачан: спрашивать
   * его в этот момент нельзя, иначе открытие окна экспорта тянуло бы сорок
   * мегабайт без спроса.
   */
  ipcMain.handle('editor:encoders', async (): Promise<Encoder[]> => {
    const ffmpeg = await findFfmpeg(deps.bundledFfmpeg)
    if (!ffmpeg) return []

    const found = await availableEncoders(ffmpeg)
    return (['h264_nvenc', 'hevc_nvenc', 'libx264', 'libx265'] as Encoder[]).filter((name) =>
      found.has(name)
    )
  })

  ipcMain.handle('editor:chooseTarget', async (_e, suggested: string) => {
    const window = deps.overlay()
    const result = await dialog.showSaveDialog({
      title: 'Куда сохранить нарезку',
      defaultPath: suggested,
      filters: [
        { name: 'Видео', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi'] },
        { name: 'Все файлы', extensions: ['*'] }
      ],
      ...(window ? { parent: window } : {})
    })

    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('editor:export', async (_e, request: ExportRequest) => {
    await runExport(deps, request)
  })

  ipcMain.handle('editor:cancel', () => {
    current?.cancel()
    current = null
  })

  ipcMain.handle('editor:reveal', (_e, target: string) => shell.showItemInFolder(target))
}

/**
 * Экспорт целиком: найти ffmpeg (при необходимости скачать), собрать команду,
 * следить за прогрессом.
 *
 * Ошибки не бросаются наружу, а уходят в интерфейс сообщением: экспорт
 * запускают из окна, и окно должно показать причину, а не молча закрыться.
 */
/**
 * Подменить исходный файл готовым результатом.
 *
 * Порядок такой, чтобы в любой момент существовала целая копия: сначала mpv
 * отпускает файл (Windows не переименовывает то, что открыто на чтение), потом
 * исходник отходит в сторону под временным именем, потом на его место встаёт
 * результат, и только после этого отложенное удаляется. Сорвалось на середине —
 * возвращаем исходник обратно.
 */
async function replaceInPlace(deps: EditorDeps, source: string, result: string): Promise<void> {
  await deps.release()

  const backup = `${source}.keyframe-backup`
  fs.rmSync(backup, { force: true })
  fs.renameSync(source, backup)

  try {
    fs.renameSync(result, source)
  } catch (error) {
    fs.renameSync(backup, source)
    throw error
  }

  fs.rmSync(backup, { force: true })

  // Нарезка относилась к прежнему файлу: к обрезанному она уже не применима
  deps.store()?.saveProject(source, [], 0)
  await deps.reopen(source)
}

async function runExport(deps: EditorDeps, request: ExportRequest): Promise<void> {
  if (current) return

  try {
    send(deps, { state: 'preparing' })

    let ffmpeg = await findFfmpeg(deps.bundledFfmpeg)
    if (!ffmpeg) {
      ffmpeg = await downloadFfmpeg((ratio) =>
        send(deps, { state: 'downloading', percent: Math.round(ratio * 100) })
      )
    }

    const total = totalLength(request.segments)
    const started = Date.now()

    const report = (time: number): void => {
      const percent = total > 0 ? Math.min(99, Math.round((time / total) * 100)) : 0
      const elapsed = (Date.now() - started) / 1000

      // Оценка по уже сделанному, а не по скорости от ffmpeg: скорость скачет
      // на первых секундах и обещала бы то полминуты, то пять
      const eta = time > 1 ? Math.round((elapsed / time) * (total - time)) : null

      send(deps, { state: 'running', percent, etaSeconds: eta })
    }

    let listFile: string | null = null
    let args: string[]

    // При замене исходника ffmpeg всё равно пишет рядом во временный файл:
    // читать и писать один и тот же файл он не может
    const output = request.replaceSource
      ? `${request.source}.keyframe-new${path.extname(request.target) || path.extname(request.source)}`
      : request.target

    if (request.mode === 'copy') {
      listFile = path.join(os.tmpdir(), `keyframe-${randomBytes(6).toString('hex')}.txt`)
      // utf8 без BOM: ffmpeg читает список как есть, и BOM попал бы в первое
      // слово «file», сделав список нечитаемым
      fs.writeFileSync(listFile, concatList(request.source, request.segments), 'utf8')
      args = copyArgs(listFile, output)
    } else {
      args = encodeArgs({ ...request, target: output })
    }

    report(0)

    current = run(ffmpeg, args, (progress) => report(progress.time))

    try {
      await current.done

      if (request.replaceSource) {
        await replaceInPlace(deps, request.source, output)
        send(deps, { state: 'done', target: request.source, replaced: true })
      } else {
        send(deps, { state: 'done', target: request.target, replaced: false })
      }
    } finally {
      current = null
      if (listFile) fs.rm(listFile, { force: true }, () => undefined)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message === 'отменено') {
      // Недописанный файл оставлять нельзя: он выглядит как готовый результат
      fs.rm(request.target, { force: true }, () => undefined)
      fs.rm(`${request.source}.keyframe-new${path.extname(request.target)}`, { force: true }, () =>
        undefined
      )
      send(deps, { state: 'cancelled' })
      return
    }

    console.error('[editor] экспорт не удался:', message)
    send(deps, { state: 'error', message })
  }
}
