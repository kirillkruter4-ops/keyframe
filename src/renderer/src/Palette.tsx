import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { fuzzy, rank } from '../../shared/fuzzy'
import type { Command } from './commands'
import { useT } from './i18n'

/**
 * Палитра команд — единственная точка входа во всё.
 *
 * Ищет и по действиям, и по недавно открытым файлам сразу: человек, нажавший
 * `Ctrl+K`, одинаково часто хочет и «полный экран», и «тот фильм, что смотрел
 * вчера», а выбирать между двумя списками до того, как начал печатать, — лишний
 * шаг.
 *
 * Ищется не только название, но и сочетание клавиш: их помнят обрывками
 * («что-то с Ctrl+O»), и это тоже способ найти нужное.
 */

interface Entry {
  key: string
  label: string
  hint: string
  group: string
  checked?: boolean
  run: () => void
}

export interface PaletteProps {
  commands: Command[]
  recent: string[]
  onOpenFile: (path: string) => void
  onClose: () => void
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function Palette({ commands, recent, onOpenFile, onClose }: PaletteProps): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const entries = useMemo<Entry[]>(() => {
    const fromCommands = commands
      .filter((command) => !command.hidden)
      .map((command) => ({
        key: `c:${command.id}`,
        label: command.label,
        hint: command.keys ?? '',
        group: command.group,
        checked: command.checked,
        run: command.run
      }))

    const fromRecent = recent.map((path) => ({
      key: `r:${path}`,
      label: baseName(path),
      hint: '',
      group: t('Недавние'),
      run: () => onOpenFile(path)
    }))

    return [...fromCommands, ...fromRecent]
  }, [commands, recent, onOpenFile, t])

  const found = useMemo(
    () => rank(query, entries, (entry) => `${entry.label} ${entry.hint}`).slice(0, 60),
    [query, entries]
  )

  // Список сменился — выделение возвращается наверх, иначе Enter запускает
  // не то, что видно первым
  useEffect(() => setActive(0), [query])

  /**
   * Выделение переехало с клавиатуры — и только тогда список подкручивается.
   *
   * Подкручивать на любое изменение нельзя: мышь при прокрутке колесом стоит на
   * месте, а список едет под ней, браузер шлёт mousemove, выделение
   * перепрыгивает на строку под курсором, и она тут же прокручивается обратно
   * в видимую часть. Со стороны это выглядит как «список откидывает назад».
   */
  const byKeyboard = useRef(false)

  useEffect(() => {
    if (!byKeyboard.current) return
    byKeyboard.current = false

    const element = listRef.current?.children[active] as HTMLElement | undefined
    element?.scrollIntoView({ block: 'nearest' })
  }, [active])

  /**
   * Настоящее движение мыши, а не уехавший под ней список.
   *
   * Координаты курсора при прокрутке не меняются — по ним одно и отличается от
   * другого.
   */
  const pointer = useRef({ x: -1, y: -1 })

  const onMouseMove = (event: React.MouseEvent, index: number): void => {
    if (event.clientX === pointer.current.x && event.clientY === pointer.current.y) return
    pointer.current = { x: event.clientX, y: event.clientY }
    setActive(index)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        byKeyboard.current = true
        setActive((current) => (found.length === 0 ? 0 : (current + 1) % found.length))
        break
      case 'ArrowUp':
        event.preventDefault()
        byKeyboard.current = true
        setActive((current) => (found.length === 0 ? 0 : (current - 1 + found.length) % found.length))
        break
      case 'Enter': {
        event.preventDefault()
        const entry = found[active]
        if (!entry) break
        // Закрываем до запуска: команда может открыть панель, и палитра поверх
        // неё осталась бы висеть
        onClose()
        entry.run()
        break
      }
      case 'Escape':
        event.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          className="palette__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('Команда или недавний файл')}
          spellCheck={false}
          autoFocus
        />

        <div className="palette__list" ref={listRef}>
          {found.length === 0 && <div className="palette__empty">{t('Ничего не нашлось')}</div>}

          {found.map((entry, index) => (
            <button
              key={entry.key}
              className="palette__item"
              data-active={index === active}
              onMouseMove={(event) => onMouseMove(event, index)}
              onClick={() => {
                onClose()
                entry.run()
              }}
            >
              <span className="palette__label">
                <Highlighted text={entry.label} query={query} />
              </span>
              {entry.checked && <span className="palette__check">✓</span>}
              <span className="palette__group">{entry.group}</span>
              {/*
                Колонка под клавиши есть всегда, даже когда клавиш нет: иначе
                названия разделов у строк с сочетанием и без него стоят на
                разном расстоянии от края, и список выглядит рваным
              */}
              <span className="palette__keys-slot">
                {entry.hint && <kbd className="palette__keys">{entry.hint}</kbd>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Подсветка совпавших букв.
 *
 * Без неё непонятно, почему нашлось именно это: при поиске вразбивку связь
 * между «пэ» и «Полный экран» видна только по подсветке.
 */
function Highlighted({ text, query }: { text: string; query: string }): JSX.Element {
  const match = fuzzy(query, text)
  if (!match || match.positions.length === 0) return <>{text}</>

  const marked = new Set(match.positions)
  const parts: JSX.Element[] = []

  for (let index = 0; index < text.length; index += 1) {
    parts.push(
      marked.has(index) ? (
        <b key={index}>{text[index]}</b>
      ) : (
        <span key={index}>{text[index]}</span>
      )
    )
  }

  return <>{parts}</>
}
