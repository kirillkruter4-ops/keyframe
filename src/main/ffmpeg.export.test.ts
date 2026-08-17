/**
 * Проверка экспорта на настоящем файле.
 *
 * Это единственная часть редактора, которую нельзя проверить чистыми тестами:
 * она состоит из запуска чужой программы. Модель нарезки и сборка команд уже
 * покрыты, а вот доходит ли дело до файла на диске — до сих пор не проверял
 * никто, и функция дважды уехала в выпуск неисполненной.
 *
 * Тест помечен как медленный и требует сети при первом запуске: ffmpeg в
 * установщик не входит и скачивается по требованию. Обычный `npm test` его не
 * трогает — только `npm run test:export`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * ffmpeg.ts спрашивает у Electron папку настроек, чтобы положить скачанный
 * ffmpeg рядом с ними. Вне Electron этого объекта нет — подставляем временную
 * папку. Всё остальное в модуле настоящее: и поиск, и загрузка, и запуск.
 */
vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'keyframe-export-check', 'userData') }
}))

import { concatList, copyArgs, encodeArgs } from '../shared/edit/export'
import { availableEncoders, downloadFfmpeg, findFfmpeg, run } from './ffmpeg'

const exec = promisify(execFile)

const MPV = path.resolve('resources/mpv/mpv.exe')
const DIR = path.join(os.tmpdir(), 'keyframe-export-check')
const SOURCE = path.join(DIR, 'source.mp4')

/** Длительность файла по данным mpv — тем же движком, что и играет. */
async function durationOf(file: string): Promise<number> {
  const { stdout } = await exec(path.resolve('resources/mpv/mpv.com'), [
    file,
    '--vo=null',
    '--ao=null',
    '--terminal=yes',
    '--term-playing-msg=DURATION=${=duration}',
    '--length=0.1'
  ])

  const found = /DURATION=([\d.]+)/.exec(stdout)
  return found ? Number(found[1]) : Number.NaN
}

let ffmpeg: string

describe('экспорт нарезки', () => {
  beforeAll(async () => {
    fs.rmSync(DIR, { recursive: true, force: true })
    fs.mkdirSync(DIR, { recursive: true })

    // Исходник делаем сами: тест не должен зависеть от чужих файлов на диске.
    // Тридцать секунд с движущейся картинкой и звуком — этого хватает, чтобы
    // резать в нескольких местах и слышать, что звук не разъехался
    await exec(MPV, [
      'av://lavfi:testsrc=size=640x360:rate=30:duration=30',
      '--audio-file=av://lavfi:sine=frequency=440:duration=30',
      '--o=' + SOURCE,
      '--of=mp4',
      '--ovc=libx264',
      '--oac=aac',
      '--ovcopts=preset=ultrafast,g=30'
    ])

    expect(fs.existsSync(SOURCE)).toBe(true)

    ffmpeg = (await findFfmpeg(path.resolve('resources/mpv/ffmpeg.exe'))) ?? (await downloadFfmpeg(() => undefined))
  }, 600_000)

  it('ffmpeg найден или скачан', () => {
    expect(fs.existsSync(ffmpeg)).toBe(true)
  })

  it('быстрый экспорт склеивает куски в файл нужной длины', async () => {
    const segments = [
      { in: 2, out: 7 },
      { in: 20, out: 25 }
    ]

    const list = path.join(DIR, 'list.txt')
    fs.writeFileSync(list, concatList(SOURCE, segments), 'utf8')

    const target = path.join(DIR, 'copy.mp4')
    await run(ffmpeg, copyArgs(list, target), () => undefined).done

    expect(fs.existsSync(target)).toBe(true)
    expect(fs.statSync(target).size).toBeGreaterThan(1000)

    // Резы идут по ключевым кадрам, поэтому длина точной не будет: ключевой
    // кадр стоит раз в секунду, и на два куска набегает до двух секунд
    const duration = await durationOf(target)
    expect(duration).toBeGreaterThan(8)
    expect(duration).toBeLessThan(13)
  }, 300_000)

  it('точный экспорт режет ровно там, где просили', async () => {
    const encoders = await availableEncoders(ffmpeg)
    const encoder = encoders.has('h264_nvenc') ? 'h264_nvenc' : 'libx264'

    const target = path.join(DIR, 'encode.mp4')
    const args = encodeArgs({
      source: SOURCE,
      target,
      segments: [
        { in: 2, out: 7 },
        { in: 20, out: 25 }
      ],
      mode: 'encode',
      encoder,
      quality: 'balanced',
      hasAudio: true,
      replaceSource: false
    })

    await run(ffmpeg, args, () => undefined).done

    expect(fs.existsSync(target)).toBe(true)

    const duration = await durationOf(target)
    expect(duration).toBeGreaterThan(9.5)
    expect(duration).toBeLessThan(10.5)
  }, 300_000)

  it('прогресс доходит до конца, а не молчит', async () => {
    const list = path.join(DIR, 'list2.txt')
    fs.writeFileSync(list, concatList(SOURCE, [{ in: 0, out: 20 }]), 'utf8')

    const seen: number[] = []
    const target = path.join(DIR, 'progress.mp4')
    await run(ffmpeg, copyArgs(list, target), (progress) => seen.push(progress.time)).done

    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeGreaterThan(5)
  }, 300_000)
})
