import { describe, expect, it } from 'vitest'
import {
  alignToKeyframes,
  cutRange,
  duplicateSegments,
  keepOnly,
  keepRange,
  moveSegment,
  removeSegments,
  splitAt,
  trimSegment
} from './operations'
import { MIN_SEGMENT, timelineDuration, type Project } from './project'

function project(...pairs: [number, number][]): Project {
  return {
    source: 'C:\\видео\\фильм.mkv',
    duration: 100,
    segments: pairs.map(([start, end], index) => ({ id: `s${index}`, in: start, out: end }))
  }
}

/** Пары in/out — то, что проверяется почти в каждом тесте */
function ranges(value: Project): [number, number][] {
  return value.segments.map((segment) => [segment.in, segment.out])
}

describe('splitAt', () => {
  it('делит кусок в монтажной точке на два по исходному времени', () => {
    expect(ranges(splitAt(project([0, 100]), 30))).toEqual([
      [0, 30],
      [30, 100]
    ])
  })

  it('во втором куске считает исходное время, а не монтажное', () => {
    expect(ranges(splitAt(project([10, 20], [50, 60]), 15))).toEqual([
      [10, 20],
      [50, 55],
      [55, 60]
    ])
  })

  it('на стыке не делает ничего: разрез там уже есть', () => {
    const before = project([10, 20], [50, 60])
    expect(splitAt(before, 10)).toBe(before)
  })

  it('в начале и в конце нарезки не делает ничего', () => {
    const before = project([0, 100])
    expect(splitAt(before, 0)).toBe(before)
    expect(splitAt(before, 100)).toBe(before)
  })

  it('не создаёт кусок короче кадра', () => {
    const before = project([0, 100])
    expect(splitAt(before, MIN_SEGMENT / 2)).toBe(before)
    expect(splitAt(before, 100 - MIN_SEGMENT / 2)).toBe(before)
  })

  it('сохраняет общую длительность нарезки', () => {
    expect(timelineDuration(splitAt(project([10, 20], [50, 60]), 15))).toBe(20)
  })

  it('даёт правой половине новый идентификатор', () => {
    const after = splitAt(project([0, 100]), 30)
    expect(after.segments[0].id).toBe('s0')
    expect(after.segments[1].id).not.toBe('s0')
  })

  it('у пустого проекта не делает ничего', () => {
    const before = project()
    expect(splitAt(before, 5)).toBe(before)
  })
})

describe('removeSegments', () => {
  it('убирает кусок и сдвигает остальные', () => {
    const after = removeSegments(project([0, 10], [20, 30], [40, 50]), ['s1'])
    expect(ranges(after)).toEqual([
      [0, 10],
      [40, 50]
    ])
    expect(timelineDuration(after)).toBe(20)
  })

  it('убирает несколько за раз', () => {
    expect(ranges(removeSegments(project([0, 10], [20, 30], [40, 50]), ['s0', 's2']))).toEqual([
      [20, 30]
    ])
  })

  it('на неизвестный идентификатор не меняет проект', () => {
    const before = project([0, 10])
    expect(removeSegments(before, ['нет'])).toBe(before)
  })

  it('позволяет удалить всё', () => {
    expect(removeSegments(project([0, 10]), ['s0']).segments).toHaveLength(0)
  })
})

describe('keepOnly', () => {
  it('оставляет выделенное', () => {
    expect(ranges(keepOnly(project([0, 10], [20, 30], [40, 50]), ['s1']))).toEqual([[20, 30]])
  })

  it('не даёт опустошить проект', () => {
    const before = project([0, 10], [20, 30])
    expect(keepOnly(before, [])).toBe(before)
  })
})

describe('duplicateSegments', () => {
  it('ставит копию сразу за оригиналом', () => {
    expect(ranges(duplicateSegments(project([0, 10], [20, 30]), ['s0']))).toEqual([
      [0, 10],
      [0, 10],
      [20, 30]
    ])
  })

  it('даёт копии свой идентификатор', () => {
    const after = duplicateSegments(project([0, 10]), ['s0'])
    expect(after.segments[1].id).not.toBe(after.segments[0].id)
  })

  it('без выделения не меняет проект', () => {
    const before = project([0, 10])
    expect(duplicateSegments(before, [])).toBe(before)
  })
})

describe('moveSegment', () => {
  it('переставляет кусок вперёд', () => {
    expect(ranges(moveSegment(project([0, 10], [20, 30], [40, 50]), 's2', 0))).toEqual([
      [40, 50],
      [0, 10],
      [20, 30]
    ])
  })

  it('переставляет кусок назад', () => {
    expect(ranges(moveSegment(project([0, 10], [20, 30], [40, 50]), 's0', 2))).toEqual([
      [20, 30],
      [40, 50],
      [0, 10]
    ])
  })

  it('на своё же место не меняет проект', () => {
    const before = project([0, 10], [20, 30])
    expect(moveSegment(before, 's1', 1)).toBe(before)
  })

  it('прижимает индекс за пределами списка к его концам', () => {
    expect(ranges(moveSegment(project([0, 10], [20, 30]), 's0', 99))).toEqual([
      [20, 30],
      [0, 10]
    ])
  })

  it('не меняет общую длительность', () => {
    expect(timelineDuration(moveSegment(project([0, 10], [20, 35]), 's0', 1))).toBe(25)
  })
})

describe('trimSegment', () => {
  it('двигает начало', () => {
    expect(ranges(trimSegment(project([10, 20]), 's0', 'in', 15))).toEqual([[15, 20]])
  })

  it('двигает конец', () => {
    expect(ranges(trimSegment(project([10, 20]), 's0', 'out', 18))).toEqual([[10, 18]])
  })

  it('не даёт началу перейти за конец', () => {
    expect(ranges(trimSegment(project([10, 20]), 's0', 'in', 30))).toEqual([[20 - MIN_SEGMENT, 20]])
  })

  it('не даёт концу уйти за начало', () => {
    expect(ranges(trimSegment(project([10, 20]), 's0', 'out', 0))).toEqual([[10, 10 + MIN_SEGMENT]])
  })

  it('прижимает края к границам исходника', () => {
    expect(ranges(trimSegment(project([10, 20]), 's0', 'in', -5))).toEqual([[0, 20]])
    expect(ranges(trimSegment(project([10, 20]), 's0', 'out', 999))).toEqual([[10, 100]])
  })

  it('не трогает соседей', () => {
    const after = trimSegment(project([0, 10], [20, 30]), 's0', 'out', 25)
    expect(ranges(after)).toEqual([
      [0, 25],
      [20, 30]
    ])
  })

  it('на неизменившемся крае возвращает тот же проект', () => {
    const before = project([10, 20])
    expect(trimSegment(before, 's0', 'in', 10)).toBe(before)
  })
})

describe('cutRange', () => {
  it('вырезает середину одного куска', () => {
    expect(ranges(cutRange(project([0, 100]), 30, 40))).toEqual([
      [0, 30],
      [40, 100]
    ])
  })

  it('вырезает через границу кусков', () => {
    // Нарезка: 0..10 монтажных — это 0..10 исходных, 10..20 — это 50..60
    expect(ranges(cutRange(project([0, 10], [50, 60]), 5, 15))).toEqual([
      [0, 5],
      [55, 60]
    ])
  })

  it('выбрасывает куски, попавшие внутрь целиком', () => {
    const after = cutRange(project([0, 10], [20, 30], [40, 50]), 5, 25)
    expect(ranges(after)).toEqual([
      [0, 5],
      [45, 50]
    ])
  })

  it('понимает отрезок, заданный задом наперёд', () => {
    expect(ranges(cutRange(project([0, 100]), 40, 30))).toEqual([
      [0, 30],
      [40, 100]
    ])
  })

  it('вырезает от начала', () => {
    expect(ranges(cutRange(project([0, 100]), 0, 20))).toEqual([[20, 100]])
  })

  it('вырезает до конца', () => {
    expect(ranges(cutRange(project([0, 100]), 80, 100))).toEqual([[0, 80]])
  })

  it('уменьшает длительность ровно на длину отрезка', () => {
    expect(timelineDuration(cutRange(project([0, 10], [50, 60]), 5, 15))).toBe(10)
  })

  it('на пустой отрезок не меняет проект', () => {
    const before = project([0, 100])
    expect(cutRange(before, 30, 30)).toBe(before)
  })

  it('на отрезок вне нарезки не меняет проект', () => {
    const before = project([0, 10])
    expect(cutRange(before, 20, 30)).toBe(before)
  })
})

describe('alignToKeyframes', () => {
  it('сдвигает начало куска назад, на ключевой кадр', () => {
    const after = alignToKeyframes(project([10, 20]), new Map([['s0', 8.4]]))
    expect(ranges(after)).toEqual([[8.4, 20]])
  })

  it('не двигает кусок вперёд: экспорт так не поступает', () => {
    const before = project([10, 20])
    expect(alignToKeyframes(before, new Map([['s0', 12]]))).toBe(before)
  })

  it('куски без известного ключевого кадра оставляет как есть', () => {
    const after = alignToKeyframes(project([10, 20], [40, 50]), new Map([['s1', 38]]))
    expect(ranges(after)).toEqual([
      [10, 20],
      [38, 50]
    ])
  })

  it('без единого сдвига возвращает тот же проект', () => {
    const before = project([10, 20])
    expect(alignToKeyframes(before, new Map())).toBe(before)
  })
})

describe('keepRange', () => {
  it('оставляет только отмеченный момент', () => {
    expect(ranges(keepRange(project([0, 100]), 30, 40))).toEqual([[30, 40]])
  })

  it('оставляет момент через границу кусков', () => {
    expect(ranges(keepRange(project([0, 10], [50, 60]), 5, 15))).toEqual([
      [5, 10],
      [50, 55]
    ])
  })

  it('момент длиной в весь фильм ничего не меняет', () => {
    expect(ranges(keepRange(project([0, 100]), 0, 100))).toEqual([[0, 100]])
  })
})
