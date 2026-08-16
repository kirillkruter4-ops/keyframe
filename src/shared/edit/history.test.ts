import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, createHistory, push, redo, undo } from './history'

describe('history', () => {
  it('в начале отменять нечего', () => {
    const history = createHistory('a')
    expect(canUndo(history)).toBe(false)
    expect(undo(history)).toBe(history)
  })

  it('возвращает предыдущее состояние', () => {
    const history = push(push(createHistory('a'), 'b'), 'c')
    expect(undo(history).present).toBe('b')
    expect(undo(undo(history)).present).toBe('a')
  })

  it('повторяет отменённое', () => {
    const history = undo(push(createHistory('a'), 'b'))
    expect(canRedo(history)).toBe(true)
    expect(redo(history).present).toBe('b')
  })

  it('новое действие после отмены стирает повтор', () => {
    const history = push(undo(push(createHistory('a'), 'b')), 'c')
    expect(canRedo(history)).toBe(false)
    expect(undo(history).present).toBe('a')
  })

  it('не запоминает шаг, ничего не изменивший', () => {
    // Операции возвращают тот же объект, когда менять нечего: промах мышью
    // не должен съедать Ctrl+Z
    const same = { value: 1 }
    const history = push(createHistory(same), same)
    expect(canUndo(history)).toBe(false)
  })

  it('глубже сотни шагов забывает самые старые', () => {
    let history = createHistory(0)
    for (let step = 1; step <= 150; step += 1) history = push(history, step)

    expect(history.past).toHaveLength(100)
    expect(history.past[0]).toBe(50)
  })
})
