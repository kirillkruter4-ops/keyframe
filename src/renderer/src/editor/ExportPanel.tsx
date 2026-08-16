import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Segment } from '../../../shared/edit/project'
import {
  totalLength,
  type Encoder,
  type ExportMode,
  type ExportProgress,
  type Quality
} from '../../../shared/edit/export'
import { formatTime } from '../format'

/** Понятные названия кодировщиков: h264_nvenc пользователю ничего не говорит. */
const ENCODER_LABEL: Record<Encoder, string> = {
  h264_nvenc: 'H.264 на видеокарте',
  hevc_nvenc: 'HEVC на видеокарте',
  libx264: 'H.264 на процессоре',
  libx265: 'HEVC на процессоре'
}

const QUALITY_LABEL: Record<Quality, string> = {
  high: 'Высокое',
  balanced: 'Обычное',
  small: 'Компактное'
}

type Destination = 'new' | 'replace'

export interface ExportPanelProps {
  source: string
  segments: readonly Segment[]
  hasAudio: boolean
  /** Ключевые кадры перед началами кусков: показывают, куда уедет быстрый рез */
  keyframes: ReadonlyMap<string, number>
  onAlign: () => void
  onClose: () => void
  /** Исходник заменён — редактор закрывается: резать относительно него уже нечего */
  onReplaced: () => void
  onNotice: (text: string) => void
}

/**
 * Сохранение нарезки.
 *
 * Два вопроса, и оба заданы словами, а не терминами: куда положить результат и
 * резать быстро или точно. Быстрый способ режет по ключевым кадрам и потому
 * промахивается — насколько именно, написано здесь же, и промах можно перенести
 * в саму нарезку одной кнопкой, чтобы превью совпало с файлом.
 */
export function ExportPanel({
  source,
  segments,
  hasAudio,
  keyframes,
  onAlign,
  onClose,
  onReplaced,
  onNotice
}: ExportPanelProps): JSX.Element {
  const [destination, setDestination] = useState<Destination>('new')
  const [mode, setMode] = useState<ExportMode>('copy')
  const [quality, setQuality] = useState<Quality>('balanced')
  const [encoders, setEncoders] = useState<Encoder[]>([])
  const [encoder, setEncoder] = useState<Encoder>('h264_nvenc')
  const [progress, setProgress] = useState<ExportProgress>({ state: 'idle' })

  const api = window.keyframe.editor

  useEffect(
    () =>
      api.onProgress((next) => {
        setProgress(next)
        if (next.state === 'done' && next.replaced) onReplaced()
      }),
    [api, onReplaced]
  )

  // Список кодировщиков спрашиваем сразу: пустой означает, что ffmpeg ещё не
  // скачан, и об этом нужно предупредить до нажатия, а не после
  useEffect(() => {
    void api.encoders().then((found) => {
      setEncoders(found)
      if (found.length > 0) setEncoder(found[0])
    })
  }, [api])

  const length = useMemo(
    () => totalLength(segments.map((segment) => ({ in: segment.in, out: segment.out }))),
    [segments]
  )

  /** Насколько назад уедет самый неточный рез при копировании. */
  const drift = useMemo(() => {
    let worst = 0
    for (const segment of segments) {
      const keyframe = keyframes.get(segment.id)
      if (keyframe !== undefined && keyframe < segment.in) {
        worst = Math.max(worst, segment.in - keyframe)
      }
    }
    return worst
  }, [segments, keyframes])

  const busy =
    progress.state === 'preparing' ||
    progress.state === 'downloading' ||
    progress.state === 'running'

  const name = source.split(/[\\/]/).pop() ?? 'видео'

  const start = async (): Promise<void> => {
    const request = {
      source,
      segments: segments.map((segment) => ({ in: segment.in, out: segment.out })),
      mode,
      encoder,
      quality,
      hasAudio
    }

    if (destination === 'replace') {
      void api.start({ ...request, target: source, replaceSource: true })
      return
    }

    const target = await api.chooseTarget(suggestedName(source, mode === 'copy'))
    if (!target) return

    // Записывать поверх исходника через диалог тоже можно — но это уже замена,
    // и делать её надо тем же безопасным путём, а не ffmpeg поверх открытого файла
    if (target.toLowerCase() === source.toLowerCase()) {
      onNotice('Чтобы записать поверх исходного файла, выберите «Заменить исходный»')
      return
    }

    void api.start({ ...request, target, replaceSource: false })
  }

  return (
    <div className="export" onPointerDown={(event) => event.stopPropagation()}>
      <div className="export__head">
        <span className="export__title">Сохранить нарезку</span>
        <span className="export__facts tnum">
          {segments.length} {plural(segments.length)} · {formatTime(length)}
        </span>
        <button className="export__x" onClick={onClose} aria-label="Закрыть">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>

      <div className="export__body">
        <Field label="Куда">
          <Segmented
            value={destination}
            disabled={busy}
            onChange={setDestination}
            options={[
              { value: 'new', label: 'Новый файл' },
              { value: 'replace', label: 'Заменить исходный' }
            ]}
          />
        </Field>

        <p className="export__note">
          {destination === 'new' ? (
            <>Спросим имя и папку. Исходный {name} останется нетронутым.</>
          ) : (
            <>
              <b>{name}</b> будет заменён нарезкой. Сначала запишем результат рядом и подменим
              файл только после успеха, но вернуть прежнюю версию потом будет нельзя.
            </>
          )}
        </p>

        <Field label="Как">
          <Segmented
            value={mode}
            disabled={busy}
            onChange={setMode}
            options={[
              { value: 'copy', label: 'Быстро' },
              { value: 'encode', label: 'Точно' }
            ]}
          />
        </Field>

        <p className="export__note">
          {mode === 'copy' ? (
            <>
              Без перекодирования: секунды на файл любой длины, качество исходника не меняется.{' '}
              {drift > 0.05
                ? `Резы уедут назад до ${drift.toFixed(1).replace('.', ',')} с — ближе ключевых кадров нет.`
                : 'Резать можно только по ключевым кадрам.'}
            </>
          ) : (
            <>Режет ровно там, где показано. На видеокарте — в разы быстрее просмотра.</>
          )}
        </p>

        {mode === 'copy' && drift > 0.05 && (
          <button className="export__align" onClick={onAlign} disabled={busy}>
            Перенести резы на ключевые кадры, чтобы превью совпало с файлом
          </button>
        )}

        {mode === 'encode' && (
          <div className="export__row">
            <Field label="Кодек">
              <select
                value={encoder}
                onChange={(event) => setEncoder(event.target.value as Encoder)}
                disabled={busy || encoders.length === 0}
              >
                {encoders.length === 0 ? (
                  <option>Определится после загрузки ffmpeg</option>
                ) : (
                  encoders.map((item) => (
                    <option key={item} value={item}>
                      {ENCODER_LABEL[item]}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field label="Качество">
              <select
                value={quality}
                onChange={(event) => setQuality(event.target.value as Quality)}
                disabled={busy}
              >
                {(['high', 'balanced', 'small'] as Quality[]).map((item) => (
                  <option key={item} value={item}>
                    {QUALITY_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <Status progress={progress} />
      </div>

      <div className="export__actions">
        {busy ? (
          <button className="export__cancel" onClick={() => void api.cancel()}>
            Отменить
          </button>
        ) : (
          <>
            <button className="export__cancel" onClick={onClose}>
              Закрыть
            </button>
            <button className="editor__save" onClick={() => void start()}>
              {destination === 'replace' ? 'Заменить файл' : 'Выбрать файл…'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function plural(count: number): string {
  const tens = count % 100
  const ones = count % 10
  if (tens > 10 && tens < 20) return 'кусков'
  if (ones === 1) return 'кусок'
  if (ones >= 2 && ones <= 4) return 'куска'
  return 'кусков'
}

/** Имя по умолчанию — то же правило, что и в главном процессе. */
function suggestedName(source: string, keepContainer: boolean): string {
  const name = source.split(/[\\/]/).pop() ?? 'видео'
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = keepContainer && dot > 0 ? name.slice(dot) : '.mp4'
  return `${base} (нарезка)${extension}`
}

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label className="export__field">
      <span className="export__label">{label}</span>
      {children}
    </label>
  )
}

/**
 * Переключатель из двух-трёх вариантов.
 *
 * Вместо радиокнопок: выбор всегда виден целиком, занимает одну строку и не
 * заставляет читать два абзаца, чтобы понять, что вообще предлагают.
 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className="segmented__item"
          data-active={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Status({ progress }: { progress: ExportProgress }): JSX.Element | null {
  switch (progress.state) {
    case 'idle':
      return null

    case 'preparing':
      return <div className="export__status">Готовлю…</div>

    case 'downloading':
      return (
        <div className="export__status">
          <div>
            Первый раз нужно скачать ffmpeg — около 45 МБ.{' '}
            <span className="tnum">{progress.percent}%</span>
          </div>
          <Bar percent={progress.percent} />
        </div>
      )

    case 'running':
      return (
        <div className="export__status">
          <div className="tnum">
            Сохраняю: {progress.percent}%
            {progress.etaSeconds !== null && ` · осталось ${formatTime(progress.etaSeconds)}`}
          </div>
          <Bar percent={progress.percent} />
        </div>
      )

    case 'done':
      return (
        <div className="export__status export__status--ok">
          <span>{progress.replaced ? 'Файл заменён' : 'Готово'}</span>
          <button
            className="export__reveal"
            onClick={() => void window.keyframe.editor.reveal(progress.target)}
          >
            Показать в проводнике
          </button>
        </div>
      )

    case 'cancelled':
      return <div className="export__status">Сохранение отменено</div>

    case 'error':
      return <div className="export__status export__status--error">{progress.message}</div>
  }
}

function Bar({ percent }: { percent: number }): JSX.Element {
  return (
    <span className="export__bar">
      <span className="export__bar-fill" style={{ width: `${percent}%` }} />
    </span>
  )
}
