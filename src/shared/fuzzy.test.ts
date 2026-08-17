import { describe, expect, it } from 'vitest'
import { fuzzy, rank } from './fuzzy'

describe('fuzzy', () => {
  it('находит подряд идущие буквы', () => {
    expect(fuzzy('пол', 'Полный экран')).not.toBeNull()
  })

  it('находит буквы вразбивку', () => {
    expect(fuzzy('пэ', 'Полный экран')).not.toBeNull()
  })

  it('не находит того, чего нет', () => {
    expect(fuzzy('щщ', 'Полный экран')).toBeNull()
  })

  it('порядок букв важен', () => {
    expect(fuzzy('нп', 'Полный экран')).toBeNull()
  })

  it('не различает регистр', () => {
    expect(fuzzy('ПОЛ', 'полный экран')).not.toBeNull()
    expect(fuzzy('fu', 'FULLSCREEN')).not.toBeNull()
  })

  it('пустой запрос подходит ко всему', () => {
    expect(fuzzy('', 'что угодно')).not.toBeNull()
  })

  it('отдаёт места совпадений — их подсвечивает интерфейс', () => {
    expect(fuzzy('пэ', 'Полный экран')?.positions).toEqual([0, 7])
  })

  it('совпадение с начала слова ценнее совпадения в середине', () => {
    const atStart = fuzzy('эк', 'Полный экран')!.score
    const inside = fuzzy('эк', 'Проверка экономии')!.score
    // «эк» в «экран» начинает слово, в «проверка» — нет
    expect(atStart).toBeGreaterThan(fuzzy('ерк', 'Проверка экономии')!.score)
    expect(inside).toBeGreaterThan(fuzzy('ерк', 'Проверка экономии')!.score)
  })

  it('подряд идущие буквы ценнее разбросанных', () => {
    const solid = fuzzy('пол', 'Полный экран')!.score
    const scattered = fuzzy('пол', 'Ппустое очень легко')!.score
    expect(solid).toBeGreaterThan(scattered)
  })

  it('короткая строка при равном совпадении ценнее длинной', () => {
    const short = fuzzy('суб', 'Субтитры')!.score
    const long = fuzzy('суб', 'Субтитры раньше на 0,1 секунды')!.score
    expect(short).toBeGreaterThan(long)
  })
})

describe('rank', () => {
  const items = ['Полный экран', 'Снимок кадра', 'Настройки', 'Список воспроизведения']

  it('оставляет только подходящее', () => {
    expect(rank('сним', items, (item) => item)).toEqual(['Снимок кадра'])
  })

  it('сортирует по убыванию совпадения', () => {
    const found = rank('с', items, (item) => item)

    // «Снимок» и «Список» начинаются с искомой буквы одинаково, и решает длина;
    // в «Настройках» буква стоит в середине слова и стоит дешевле обеих
    expect(found).toEqual(['Снимок кадра', 'Список воспроизведения', 'Настройки'])
  })

  it('пустой запрос сохраняет исходный порядок', () => {
    expect(rank('', items, (item) => item)).toEqual(items)
  })

  it('ничего не нашлось — пустой список', () => {
    expect(rank('щщщ', items, (item) => item)).toEqual([])
  })

  it('ищет по нескольким полям сразу', () => {
    const commands = [
      { label: 'Полный экран', hint: 'F' },
      { label: 'Снимок кадра', hint: 'S' }
    ]
    // Клавиша тоже ищется: её помнят чаще, чем название
    const found = rank('s', commands, (item) => `${item.label} ${item.hint}`)
    expect(found[0].label).toBe('Снимок кадра')
  })
})
