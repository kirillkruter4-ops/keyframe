import { describe, expect, it } from 'vitest'
import {
  boundaries,
  createProject,
  pointAt,
  startOf,
  timelineDuration,
  timelineStarts,
  timelineTimeOfSource,
  type Project
} from './project'

/** Проект из готовых кусков — короче, чем собирать его операциями. */
function project(...pairs: [number, number][]): Project {
  return {
    source: 'C:\\видео\\фильм.mkv',
    duration: 100,
    segments: pairs.map(([start, end], index) => ({ id: `s${index}`, in: start, out: end }))
  }
}

describe('createProject', () => {
  it('делает один кусок во весь файл', () => {
    const created = createProject('C:\\a.mp4', 42)
    expect(created.segments).toHaveLength(1)
    expect(created.segments[0].in).toBe(0)
    expect(created.segments[0].out).toBe(42)
  })
})

describe('timelineDuration', () => {
  it('складывает длины кусков, а не берёт длину исходника', () => {
    expect(timelineDuration(project([10, 20], [50, 55]))).toBe(15)
  })

  it('у пустого проекта нулевая', () => {
    expect(timelineDuration(project())).toBe(0)
  })
})

describe('timelineStarts', () => {
  it('считает монтажные начала подряд, без исходных дыр', () => {
    expect(timelineStarts(project([10, 20], [50, 55], [0, 3]))).toEqual([0, 10, 15])
  })
})

describe('pointAt', () => {
  const cut = project([10, 20], [50, 55])

  it('переводит монтажное время в исходное внутри первого куска', () => {
    expect(pointAt(cut, 4)?.sourceTime).toBe(14)
  })

  it('переводит монтажное время в исходное во втором куске', () => {
    expect(pointAt(cut, 12)?.sourceTime).toBe(52)
  })

  it('на стыке отдаёт следующий кусок, а не предыдущий', () => {
    const point = pointAt(cut, 10)
    expect(point?.index).toBe(1)
    expect(point?.sourceTime).toBe(50)
  })

  it('в конце нарезки остаётся на последнем куске', () => {
    const point = pointAt(cut, 15)
    expect(point?.index).toBe(1)
    expect(point?.sourceTime).toBe(55)
  })

  it('за пределами прижимается к границам', () => {
    expect(pointAt(cut, -5)?.sourceTime).toBe(10)
    expect(pointAt(cut, 999)?.sourceTime).toBe(55)
  })

  it('у пустого проекта точки нет', () => {
    expect(pointAt(project(), 0)).toBeNull()
  })
})

describe('timelineTimeOfSource', () => {
  const cut = project([10, 20], [50, 55])

  it('находит секунду исходника в нарезке', () => {
    expect(timelineTimeOfSource(cut, 52)).toBe(12)
  })

  it('выброшенную секунду переводит в начало ближайшего куска справа', () => {
    expect(timelineTimeOfSource(cut, 30)).toBe(10)
  })

  it('секунду до первого куска переводит в ноль', () => {
    expect(timelineTimeOfSource(cut, 0)).toBe(0)
  })

  it('секунду после последнего куска переводит в конец нарезки', () => {
    expect(timelineTimeOfSource(cut, 90)).toBe(15)
  })

  it('обратен pointAt на сохранённых секундах', () => {
    const point = pointAt(cut, 12)
    expect(timelineTimeOfSource(cut, point!.sourceTime)).toBe(12)
  })
})

describe('startOf', () => {
  it('отдаёт монтажное начало куска по идентификатору', () => {
    expect(startOf(project([10, 20], [50, 55]), 's1')).toBe(10)
  })

  it('на неизвестный кусок отвечает -1', () => {
    expect(startOf(project([10, 20]), 'нет такого')).toBe(-1)
  })
})

describe('boundaries', () => {
  it('включает и начало, и конец нарезки', () => {
    expect(boundaries(project([10, 20], [50, 55]))).toEqual([0, 10, 15])
  })
})
