import type { JSX, ReactNode } from 'react'
import type { PlaylistEntry, Settings } from './usePlayer'
import { useDragPanel } from './useDragPanel'

/**
 * Настройки.
 *
 * Отдельного окна нет намеренно: у плеера безрамочное окно с нативным
 * видеослоем под ним, и второе окно поверх него — ещё одна сущность, которую
 * пришлось бы держать поверх host вручную. Панель живёт в том же оверлее.
 */
export function SettingsPanel({
  settings,
  onChange,
  onClose
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}): JSX.Element {
  const drag = useDragPanel('settings')

  return (
    <div
      className="panel"
      ref={drag.ref}
      style={drag.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="panel__head" {...drag.handleProps}>
        <span className="panel__title">Настройки</span>
        <button className="notice__close" onClick={onClose} aria-label="Закрыть">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="panel__body">
        <Group title="Воспроизведение">
          <Field label="Шаг перемотки стрелками" hint="J и L перематывают вдвое дальше">
            <select
              className="input"
              value={settings.seekStep}
              onChange={(event) => onChange({ seekStep: Number(event.target.value) })}
            >
              {[3, 5, 10, 15, 30].map((value) => (
                <option key={value} value={value}>
                  {value} с
                </option>
              ))}
            </select>
          </Field>

          <Toggle
            label="Продолжать с места остановки"
            hint="Для видео длиннее трёх минут"
            checked={settings.resumePlayback}
            onChange={(resumePlayback) => onChange({ resumePlayback })}
          />

          <Toggle
            label="Подхватывать соседние файлы из папки"
            hint="«Дальше» и «Назад» идут по папке, как в проводнике"
            checked={settings.fillPlaylistFromFolder}
            onChange={(fillPlaylistFromFolder) => onChange({ fillPlaylistFromFolder })}
          />
        </Group>

        <Group title="Дорожки">
          <Field label="Язык звука" hint="Коды через запятую: rus,eng. Действует со следующего файла">
            <input
              className="input"
              value={settings.audioLanguage}
              placeholder="как в файле"
              onChange={(event) => onChange({ audioLanguage: event.target.value })}
            />
          </Field>

          <Field label="Язык субтитров" hint="Пусто — как решит файл">
            <input
              className="input"
              value={settings.subtitleLanguage}
              placeholder="как в файле"
              onChange={(event) => onChange({ subtitleLanguage: event.target.value })}
            />
          </Field>

          <Field label="Размер субтитров" hint={`${settings.subtitleFontSize} — размер mpv по умолчанию 55`}>
            <input
              className="input input--range"
              type="range"
              min={20}
              max={100}
              step={5}
              value={settings.subtitleFontSize}
              onChange={(event) => onChange({ subtitleFontSize: Number(event.target.value) })}
            />
          </Field>
        </Group>

        <Group title="Файлы">
          <Field label="Папка для снимков кадра" hint={settings.screenshotDir || 'Изображения\\Keyframe'}>
            <div className="panel__buttons">
              <button
                className="button"
                onClick={() => void window.keyframe.settings.chooseScreenshotDir()}
              >
                Выбрать…
              </button>
              {settings.screenshotDir && (
                <button className="button" onClick={() => onChange({ screenshotDir: '' })}>
                  По умолчанию
                </button>
              )}
            </div>
          </Field>

          <Field
            label="Плеер по умолчанию"
            hint="Назначить себя программой по умолчанию Windows приложению не даёт — это делается в параметрах системы"
          >
            <button className="button" onClick={() => void window.keyframe.settings.openDefaultApps()}>
              Открыть параметры
            </button>
          </Field>
        </Group>
      </div>
    </div>
  )
}

/**
 * Список воспроизведения.
 *
 * Показывает имена файлов, а не пути: список из одинаковых начал путей
 * нечитаем, а различает записи как раз хвост.
 */
export function PlaylistPanel({
  entries,
  position,
  loopPlaylist,
  onClose
}: {
  entries: PlaylistEntry[]
  position: number
  loopPlaylist: boolean
  onClose: () => void
}): JSX.Element {
  const mpv = window.keyframe.mpv
  const drag = useDragPanel('playlist')

  return (
    <div
      className="panel panel--playlist"
      ref={drag.ref}
      style={drag.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="panel__head" {...drag.handleProps}>
        <span className="panel__title">
          Список <span className="panel__count tnum">{entries.length}</span>
        </span>
        <button
          className="button"
          data-active={loopPlaylist}
          onClick={() => void mpv.set('loop-playlist', loopPlaylist ? 'no' : 'inf')}
        >
          Повторять
        </button>
        <button className="button" onClick={() => void window.keyframe.playlist.clear()}>
          Очистить
        </button>
        <button className="notice__close" onClick={onClose} aria-label="Закрыть">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="panel__body">
        {entries.length === 0 && <div className="panel__empty">Пусто</div>}

        {entries.map((entry, index) => (
          <div key={`${entry.filename}-${index}`} className="playlist__row" data-current={index === position}>
            <button className="playlist__item" onClick={() => void mpv.set('playlist-pos', index)}>
              <span className="playlist__index tnum">{index + 1}</span>
              <span className="playlist__name">{entry.title ?? baseName(entry.filename)}</span>
            </button>
            <button
              className="playlist__remove"
              onClick={() => void window.keyframe.playlist.remove(index)}
              aria-label="Убрать из списка"
              title="Убрать из списка"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Путь может быть и ссылкой на поток — режем по обоим разделителям. */
function baseName(target: string): string {
  const parts = target.split(/[\\/]/)
  return parts[parts.length - 1] || target
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="group">
      <div className="group__title">{title}</div>
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="field">
      <span className="field__text">
        <span className="field__label">{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <span className="field__control">{children}</span>
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}): JSX.Element {
  return (
    <label className="field">
      <span className="field__text">
        <span className="field__label">{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <span className="field__control">
        <button
          className="switch"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
        >
          <span className="switch__knob" />
        </button>
      </span>
    </label>
  )
}
