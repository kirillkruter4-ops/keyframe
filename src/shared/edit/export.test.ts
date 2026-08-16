import { describe, expect, it } from 'vitest'
import { concatList, copyArgs, encodeArgs, totalLength, type ExportRequest } from './export'

const SEGMENTS = [
  { in: 10, out: 25 },
  { in: 100, out: 115 }
]

function request(patch: Partial<ExportRequest> = {}): ExportRequest {
  return {
    source: 'C:\\видео\\фильм.mkv',
    target: 'C:\\видео\\нарезка.mp4',
    segments: SEGMENTS,
    mode: 'encode',
    encoder: 'h264_nvenc',
    quality: 'balanced',
    hasAudio: true,
    replaceSource: false,
    ...patch
  }
}

describe('concatList', () => {
  it('описывает каждый кусок точками входа и выхода', () => {
    expect(concatList('C:\\a.mp4', SEGMENTS)).toBe(
      "file 'C:\\a.mp4'\ninpoint 10\noutpoint 25\n" + "file 'C:\\a.mp4'\ninpoint 100\noutpoint 115\n"
    )
  })

  it('экранирует одинарную кавычку в пути', () => {
    // Путь вида D:\Kill'em all\видео.mkv иначе обрывает строку на середине
    expect(concatList("D:\\Kill'em.mp4", [{ in: 0, out: 1 }])).toContain("file 'D:\\Kill'\\''em.mp4'")
  })

  it('округляет времена до миллисекунд', () => {
    expect(concatList('a.mp4', [{ in: 1.00049, out: 2.5 }])).toContain('inpoint 1\noutpoint 2.5')
  })
})

describe('copyArgs', () => {
  it('склеивает через concat без перекодирования', () => {
    const args = copyArgs('C:\\список.txt', 'C:\\выход.mkv')
    expect(args).toContain('-c')
    expect(args).toContain('copy')
    expect(args.join(' ')).toContain('-f concat -safe 0 -i C:\\список.txt')
    expect(args[args.length - 1]).toBe('C:\\выход.mkv')
  })
})

describe('encodeArgs', () => {
  it('режет и склеивает одним фильтром', () => {
    const filter = encodeArgs(request())[encodeArgs(request()).indexOf('-filter_complex') + 1]
    expect(filter).toBe(
      '[0:v]trim=start=10:end=25,setpts=PTS-STARTPTS[v0];' +
        '[0:a]atrim=start=10:end=25,asetpts=PTS-STARTPTS[a0];' +
        '[0:v]trim=start=100:end=115,setpts=PTS-STARTPTS[v1];' +
        '[0:a]atrim=start=100:end=115,asetpts=PTS-STARTPTS[a1];' +
        '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]'
    )
  })

  it('без звука не создаёт звуковых цепочек', () => {
    const args = encodeArgs(request({ hasAudio: false }))
    const filter = args[args.indexOf('-filter_complex') + 1]

    expect(filter).not.toContain('atrim')
    expect(filter).toContain('concat=n=2:v=1:a=0[v]')
    expect(args).toContain('-an')
    // Карта звука без звуковой цепочки — ошибка ffmpeg, а не пустой результат
    expect(args.filter((arg) => arg === '-map')).toHaveLength(1)
  })

  it('на видеокарте задаёт постоянное качество, а не битрейт', () => {
    const args = encodeArgs(request({ encoder: 'hevc_nvenc', quality: 'high' }))
    expect(args.join(' ')).toContain('-c:v hevc_nvenc -preset p5 -rc vbr -cq 19 -b:v 0')
  })

  it('на процессоре задаёт crf', () => {
    const args = encodeArgs(request({ encoder: 'libx264', quality: 'small' }))
    expect(args.join(' ')).toContain('-c:v libx264 -preset medium -crf 28')
  })

  it('пишет в указанный файл последним аргументом', () => {
    const args = encodeArgs(request())
    expect(args[args.length - 1]).toBe('C:\\видео\\нарезка.mp4')
  })
})

describe('totalLength', () => {
  it('складывает длины кусков', () => {
    expect(totalLength(SEGMENTS)).toBe(30)
  })
})
