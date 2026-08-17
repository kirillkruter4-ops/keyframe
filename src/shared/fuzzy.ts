/**
 * Поиск по неточному вводу — для палитры команд.
 *
 * Человек, вызвавший палитру, помнит не название целиком, а пару букв из него:
 * «пэ» вместо «полный экран», «суб» вместо «субтитры». Поэтому подходит любая
 * подпоследовательность букв в правильном порядке, а разница между хорошим и
 * плохим совпадением выражается очками.
 *
 * Своя реализация, а не библиотека: правил здесь на полсотни строк, и они
 * должны одинаково работать с кириллицей — большинство готовых решений
 * настроены на латиницу и разбор путей.
 */

export interface Match {
  score: number
  /** Индексы совпавших букв: по ним интерфейс подсвечивает найденное */
  positions: number[]
}

/** Совпадение в начале слова — то, что человек и имел в виду. */
const WORD_START_BONUS = 12

/** Буква сразу за предыдущей совпавшей: «пол» ценнее, чем «п...о...л». */
const RUN_BONUS = 8

/** Совпадение с первой буквы всей строки. */
const PREFIX_BONUS = 10

/** За каждую пропущенную букву. Ограничено снизу, иначе длинные строки уходят в минус. */
const GAP_PENALTY = 1

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  const before = text[index - 1]
  return before === ' ' || before === '-' || before === '/' || before === '\\' || before === '.'
}

/**
 * Насколько запрос подходит строке. null — не подходит вовсе.
 *
 * Жадный проход слева направо: первая подходящая буква и берётся. Полный
 * перебор дал бы чуть лучшие подсветки на редких строках, но стоит
 * экспоненциально, а список команд перебирается на каждое нажатие клавиши.
 */
export function fuzzy(query: string, target: string): Match | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return { score: 0, positions: [] }

  const haystack = target.toLowerCase()
  const positions: number[] = []

  let score = 0
  let cursor = 0
  let previous = -2

  for (const letter of needle) {
    if (letter === ' ') continue

    const found = haystack.indexOf(letter, cursor)
    if (found < 0) return null

    positions.push(found)

    if (found === previous + 1) score += RUN_BONUS
    if (isWordStart(target, found)) score += WORD_START_BONUS
    if (found === 0) score += PREFIX_BONUS

    // Пропуск между буквами: чем дальше пришлось прыгать, тем хуже
    if (previous >= 0) score -= Math.min(found - previous - 1, 6) * GAP_PENALTY

    previous = found
    cursor = found + 1
  }

  // При прочих равных короткая строка вернее длинной: «Субтитры» — это скорее
  // то, что искали, чем «Субтитры раньше на 0,1 секунды»
  score -= target.length / 20

  return { score, positions }
}

/**
 * Отобрать и упорядочить.
 *
 * Пустой запрос сохраняет исходный порядок: в палитре он осмысленный —
 * сначала то, чем пользуются чаще.
 */
export function rank<T>(query: string, items: readonly T[], text: (item: T) => string): T[] {
  if (query.trim().length === 0) return [...items]

  const scored: { item: T; score: number }[] = []

  for (const item of items) {
    const match = fuzzy(query, text(item))
    if (match) scored.push({ item, score: match.score })
  }

  // Стабильная сортировка: при равных очках порядок остаётся исходным
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item)
}
