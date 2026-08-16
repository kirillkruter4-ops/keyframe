/**
 * Отмена.
 *
 * Стек состояний модели, а не действий над интерфейсом: модель маленькая
 * (десятки кусков по три числа), копия стоит ничего, а обратные операции для
 * каждого действия пришлось бы писать и отлаживать отдельно — и именно там
 * заводятся ошибки, из-за которых отмена возвращает не туда.
 *
 * Отмена обязана существовать с первого дня: пока её нет, резать страшно, и
 * пользователь режет осторожно вместо того, чтобы резать быстро.
 */

/** Глубина стека. Сто шагов — это заметно больше, чем помнит человек. */
const LIMIT = 100

export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/**
 * Запомнить новое состояние.
 *
 * Если состояние то же самое — ничего не происходит: операции возвращают тот же
 * объект, когда менять нечего, и пустые шаги не должны копиться в стеке. Иначе
 * `Ctrl+Z` после промаха мышью не отменял бы ничего видимого.
 */
export function push<T>(history: History<T>, present: T): History<T> {
  if (present === history.present) return history

  const past = [...history.past, history.present]
  return {
    past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past,
    present,
    future: []
  }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history

  const present = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future]
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history

  const [present, ...future] = history.future
  return { past: [...history.past, history.present], present, future }
}
