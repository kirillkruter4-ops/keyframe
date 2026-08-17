import { type JSX } from 'react'
import { editorKeys, type Command } from './commands'
import { useT } from './i18n'

/**
 * Шпаргалка по `F1`.
 *
 * Собирается из того же реестра команд, что и палитра: два отдельных списка
 * разъезжаются на первой же новой возможности, и первой начинает врать именно
 * шпаргалка — а врущая хуже, чем никакой.
 *
 * Показываются только команды с сочетанием клавиш: остальные ищутся через
 * `Ctrl+K`, и перечислять их здесь значило бы утопить в них те, что и правда
 * нужно запомнить.
 */
export function Shortcuts({
  commands,
  onClose
}: {
  commands: Command[]
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const groups = new Map<string, Command[]>()

  for (const command of commands) {
    if (!command.keys) continue
    const list = groups.get(command.group) ?? []
    list.push(command)
    groups.set(command.group, list)
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="shortcuts" onClick={(event) => event.stopPropagation()}>
        <div className="shortcuts__head">
          <span className="shortcuts__title">{t('Сочетания клавиш')}</span>
          <button className="export__x" onClick={onClose} aria-label={t('Закрыть')}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>

        <div className="shortcuts__body">
          {[...groups].map(([group, list]) => (
            <section className="shortcuts__group" key={group}>
              <h3 className="shortcuts__name">{group}</h3>
              {list.map((command) => (
                <Row key={command.id} keys={command.keys!} label={command.label} />
              ))}
            </section>
          ))}

          <section className="shortcuts__group">
            <h3 className="shortcuts__name">{t('Нарезка видео')}</h3>
            {editorKeys(t).map((item) => (
              <Row key={item.keys} keys={item.keys} label={item.label} />
            ))}
          </section>

          <section className="shortcuts__group">
            <h3 className="shortcuts__name">{t('Мышь')}</h3>
            <Row keys={t('Клик')} label={t('Пауза, двойной — полный экран')} />
            <Row keys={t('Колесо')} label={t('Громкость')} />
            <Row keys={t('Правая')} label={t('Меню со всем остальным')} />
            <Row keys="Ctrl+K" label={t('Палитра команд и недавних файлов')} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({ keys, label }: { keys: string; label: string }): JSX.Element {
  return (
    <div className="shortcuts__row">
      <kbd className="shortcuts__keys">{keys}</kbd>
      <span className="shortcuts__label">{label}</span>
    </div>
  )
}
