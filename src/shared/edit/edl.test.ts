import { describe, expect, it } from 'vitest'
import { edlUrl, isWholeFile } from './edl'
import type { Project } from './project'

function project(source: string, ...pairs: [number, number][]): Project {
  return {
    source,
    duration: 100,
    segments: pairs.map(([start, end], index) => ({ id: `s${index}`, in: start, out: end }))
  }
}

describe('edlUrl', () => {
  it('пишет начало и длину, а не начало и конец', () => {
    expect(edlUrl(project('C:\\a.mp4', [10, 25]))).toBe('edl://%8%C:\\a.mp4,10,15;')
  })

  it('склеивает куски подряд', () => {
    expect(edlUrl(project('C:\\a.mp4', [10, 25], [50, 55]))).toBe(
      'edl://%8%C:\\a.mp4,10,15;%8%C:\\a.mp4,50,5;'
    )
  })

  it('считает длину пути в байтах, а не в символах', () => {
    // «ф», «и», «л», «ь», «м» — по два байта каждая
    const url = edlUrl(project('C:\\фильм.mp4', [0, 1]))
    expect(url).toBe('edl://%17%C:\\фильм.mp4,0,1;')
  })

  it('округляет времена до миллисекунд', () => {
    expect(edlUrl(project('a.mp4', [1.00049, 2.5]))).toBe('edl://%5%a.mp4,1,1.5;')
  })

  it('у пустого проекта склейки нет', () => {
    expect(edlUrl(project('a.mp4'))).toBeNull()
  })
})

describe('isWholeFile', () => {
  it('узнаёт нетронутый файл', () => {
    expect(isWholeFile(project('a.mp4', [0, 100]))).toBe(true)
  })

  it('разрезанный файл целым не считает', () => {
    expect(isWholeFile(project('a.mp4', [0, 50], [50, 100]))).toBe(false)
  })

  it('обрезанный файл целым не считает', () => {
    expect(isWholeFile(project('a.mp4', [5, 100]))).toBe(false)
    expect(isWholeFile(project('a.mp4', [0, 90]))).toBe(false)
  })
})
