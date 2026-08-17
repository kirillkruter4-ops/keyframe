import { memo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { PlaylistEntry, Settings } from './usePlayer'
import { useDragPanel } from './useDragPanel'
import { useT } from './i18n'

/**
 * Настройки.
 *
 * Отдельного окна нет намеренно: у плеера безрамочное окно с нативным
 * видеослоем под ним, и второе окно поверх него — ещё одна сущность, которую
 * пришлось бы держать поверх host вручную. Панель живёт в том же оверлее.
 *
 * memo здесь не украшение: пока панель открыта, фильм идёт, и позиция
 * воспроизведения перерисовывает всё дерево несколько раз в секунду. К
 * содержимому панели это не относится ничем.
 */
export const SettingsPanel = memo(function SettingsPanel({
  settings,
  onChange,
  onClose
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}): JSX.Element {
  const t = useT()
  const drag = useDragPanel('settings')

  return (
    <div
      className="panel"
      ref={drag.ref}
      style={drag.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="panel__head" {...drag.handleProps}>
        <span className="panel__title">{t('Настройки')}</span>
        <button className="notice__close" onClick={onClose} aria-label={t('Закрыть')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="panel__body">
        <Group title={t('Интерфейс')}>
          <Field
            label={t('Язык / Language')}
            hint={t('Русский — исходный язык интерфейса, английский берётся из словаря')}
          >
            <select
              className="input"
              value={settings.language}
              onChange={(event) =>
                onChange({ language: event.target.value as 'ru' | 'en' })
              }
            >
              <option value="ru">{t('Русский')}</option>
              <option value="en">English</option>
            </select>
          </Field>
        </Group>

        <Group title={t('Воспроизведение')}>
          <Field label={t('Шаг перемотки стрелками')} hint={t('J и L перематывают вдвое дальше')}>
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
            label={t('Продолжать с места остановки')}
            hint={t('Для видео длиннее трёх минут')}
            checked={settings.resumePlayback}
            onChange={(resumePlayback) => onChange({ resumePlayback })}
          />

          <Toggle
            label={t('Подхватывать соседние файлы из папки')}
            hint={t('«Дальше» и «Назад» идут по папке, как в проводнике')}
            checked={settings.fillPlaylistFromFolder}
            onChange={(fillPlaylistFromFolder) => onChange({ fillPlaylistFromFolder })}
          />
        </Group>

        <Group title={t('Дорожки')}>
          <Field label={t('Язык звука')} hint={t('Коды через запятую: rus,eng. Действует со следующего файла')}>
            <input
              className="input"
              value={settings.audioLanguage}
              placeholder={t('как в файле')}
              onChange={(event) => onChange({ audioLanguage: event.target.value })}
            />
          </Field>

          <Field label={t('Язык субтитров')} hint={t('Пусто — как решит файл')}>
            <input
              className="input"
              value={settings.subtitleLanguage}
              placeholder={t('как в файле')}
              onChange={(event) => onChange({ subtitleLanguage: event.target.value })}
            />
          </Field>

          <Field label={t('Размер субтитров')} hint={`${settings.subtitleFontSize} — размер mpv по умолчанию 55`}>
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

        <Group title={t('Файлы')}>
          <Field label={t('Папка для снимков кадра')} hint={settings.screenshotDir || t('Изображения\\Keyframe')}>
            <div className="panel__buttons">
              <button
                className="button"
                onClick={() => void window.keyframe.settings.chooseScreenshotDir()}
              >
                {t('Выбрать…')}
              </button>
              {settings.screenshotDir && (
                <button className="button" onClick={() => onChange({ screenshotDir: '' })}>
                  {t('По умолчанию')}
                </button>
              )}
            </div>
          </Field>

          <Field
            label={t('Плеер по умолчанию')}
            hint={t('Назначить себя программой по умолчанию Windows приложению не даёт — это делается в параметрах системы')}
          >
            <button className="button" onClick={() => void window.keyframe.settings.openDefaultApps()}>
              {t('Открыть параметры')}
            </button>
          </Field>
        </Group>
      </div>
    </div>
  )
})

/**
 * Список воспроизведения.
 *
 * Показывает имена файлов, а не пути: список из одинаковых начал путей
 * нечитаем, а различает записи как раз хвост.
 */
export const PlaylistPanel = memo(function PlaylistPanel({
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
  const t = useT()
  const mpv = window.keyframe.mpv
  const drag = useDragPanel('playlist')
  const reorder = useReorder(entries.length)

  return (
    <div
      className="panel panel--playlist"
      ref={drag.ref}
      style={drag.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="panel__head" {...drag.handleProps}>
        <span className="panel__title">
          {t('Список')} <span className="panel__count tnum">{entries.length}</span>
        </span>
        <button
          className="button"
          data-active={loopPlaylist}
          onClick={() => void mpv.set('loop-playlist', loopPlaylist ? 'no' : 'inf')}
        >
          {t('Повторять')}
        </button>
        <button className="button" onClick={() => void window.keyframe.playlist.clear()}>
          {t('Очистить')}
        </button>
        <button className="notice__close" onClick={onClose} aria-label={t('Закрыть')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <div className="panel__body">
        {entries.length === 0 && <div className="panel__empty">{t('Пусто')}</div>}

        {entries.map((entry, index) => (
          <div
            key={`${entry.filename}-${index}`}
            className="playlist__row"
            data-current={index === position}
            data-dragging={reorder.dragging === index}
            data-shift={reorder.shiftOf(index)}
            style={reorder.dragging === index ? { transform: `translateY(${reorder.offset}px)` } : undefined}
            onPointerDown={(event) => reorder.start(event, index)}
          >
            <button
              className="playlist__item"
              onClick={() => {
                // Тот же жест — и выбор, и перестановка. Порог отличает одно от
                // другого: без него любое дрожание руки меняло бы файл
                if (reorder.moved()) return
                void mpv.set('playlist-pos', index)
              }}
            >
              <span className="playlist__index tnum">{index + 1}</span>
              <span className="playlist__name">{entry.title ?? baseName(entry.filename)}</span>
            </button>
            <button
              className="playlist__remove"
              onClick={() => void window.keyframe.playlist.remove(index)}
              aria-label={t('Убрать из списка')}
              title={t('Убрать из списка')}
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
})

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

/**
 * Перетаскивание строк списка мышью.
 *
 * Указательными событиями, а не встроенным drag-and-drop браузера: у окна уже
 * есть обработчик перетаскивания файлов снаружи, и таскать строки тем же
 * механизмом значило бы попадать в него на каждом жесте внутри списка.
 *
 * Соседи не переставляются на лету, а только сдвигаются на высоту строки —
 * настоящий порядок меняет mpv, и он один. Иначе список успел бы показать своё
 * представление о порядке, а потом дёрнуться на присланное от mpv.
 */
function useReorder(count: number): {
  dragging: number | null
  offset: number
  start: (event: React.PointerEvent<HTMLDivElement>, index: number) => void
  shiftOf: (index: number) => 'up' | 'down' | undefined
  moved: () => boolean
} {
  const [dragging, setDragging] = useState<number | null>(null)
  const [offset, setOffset] = useState(0)

  const from = useRef(0)
  const startY = useRef(0)
  /**
   * Смещение ещё и ссылкой, не только состоянием.
   *
   * Обработчик отпускания создаётся один раз, в момент нажатия, и замыкает
   * состояние того рендера — то есть ноль. Считая по нему, перестановка всегда
   * получалась «на то же место» и не делалась вовсе. Состояние остаётся для
   * отрисовки, ссылка — для решения.
   */
  const live = useRef(0)
  const rowHeight = useRef(1)
  /** Жест сдвинулся дальше порога — значит это перестановка, а не выбор файла */
  const shifted = useRef(false)

  /** Куда встанет строка: место вставки в понимании mpv, от 0 до длины. */
  const target = (): number => {
    const steps = Math.round(live.current / rowHeight.current)
    const landing = Math.min(Math.max(from.current + steps, 0), count - 1)
    // Вниз — вставка после занимаемого места, вверх — перед ним
    return landing > from.current ? landing + 1 : landing
  }

  const start = (event: React.PointerEvent<HTMLDivElement>, index: number): void => {
    if (event.button !== 0) return
    // По крестику удаления таскать нечего
    if ((event.target as HTMLElement).closest('.playlist__remove')) return

    const row = event.currentTarget
    rowHeight.current = row.offsetHeight || 1
    from.current = index
    startY.current = event.clientY
    live.current = 0
    shifted.current = false

    row.setPointerCapture(event.pointerId)
    setDragging(index)
    setOffset(0)

    const onMove = (move: PointerEvent): void => {
      const delta = move.clientY - startY.current
      if (Math.abs(delta) > 4) shifted.current = true
      live.current = delta
      setOffset(delta)
    }

    const onUp = (): void => {
      row.removeEventListener('pointermove', onMove)
      row.removeEventListener('pointerup', onUp)
      row.removeEventListener('pointercancel', onUp)

      const to = target()
      setDragging(null)
      setOffset(0)

      if (shifted.current && to !== from.current && to !== from.current + 1) {
        void window.keyframe.playlist.move(from.current, to)
      }
    }

    row.addEventListener('pointermove', onMove)
    row.addEventListener('pointerup', onUp)
    row.addEventListener('pointercancel', onUp)
  }

  /** Куда отъезжает сосед, чтобы освободить место. */
  const shiftOf = (index: number): 'up' | 'down' | undefined => {
    if (dragging === null || index === dragging || !shifted.current) return undefined

    const landing = Math.min(Math.max(dragging + Math.round(offset / rowHeight.current), 0), count - 1)
    if (index > dragging && index <= landing) return 'up'
    if (index < dragging && index >= landing) return 'down'
    return undefined
  }

  return { dragging, offset, start, shiftOf, moved: () => shifted.current }
}
