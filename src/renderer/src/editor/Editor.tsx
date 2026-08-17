import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { pointAt } from '../../../shared/edit/project'
import { alignToKeyframes } from '../../../shared/edit/operations'
import { formatTime } from '../format'
import { useMpvProperty } from '../usePlayer'
import { EditorTimeline, type TimelineControls } from './EditorTimeline'
import { ExportPanel } from './ExportPanel'
import { useEditor } from './useEditor'
import './editor.css'
import { useT } from '../i18n'

/**
 * Высота панели редактора в пикселях.
 *
 * Ровно на столько ужимается картинка: mpv умеет отдавать часть своего окна
 * под пустоту (`video-margin-ratio-bottom`), и класть дорожку кадров поверх
 * видео не приходится. Оверлей поверх картинки здесь не годится — полосе кадров
 * нужна настоящая высота, а не полупрозрачная плашка над лицами актёров.
 */
const HEIGHT = 236

export interface EditorProps {
  source: string
  duration: number
  /** Секунда исходника, на которой был зритель */
  startAt: number
  /** Есть ли звуковая дорожка: без неё точный экспорт строит команду иначе */
  hasAudio: boolean
  /** Секунда исходника, на которой закончили: плееру ею рисовать полосу */
  onClose: (leftAt: number) => void
  onNotice: (text: string) => void
}

export function Editor({
  source,
  duration,
  startAt,
  hasAudio,
  onClose,
  onNotice
}: EditorProps): JSX.Element {
  const t = useT()
  const editor = useEditor({ source, duration, startAt, onNotice })
  const controls = useRef<TimelineControls | null>(null)
  const [exporting, setExporting] = useState(false)
  const [keyframes, setKeyframes] = useState<ReadonlyMap<string, number>>(new Map())

  /**
   * Пауза — единственное высокочастотное свойство, которое здесь нужно в
   * состоянии: кнопка обязана показывать то, что реально сделает нажатие.
   * Меняется оно от силы несколько раз за сеанс, так что перерисовка не в счёт.
   */
  const [paused, setPaused] = useState(true)
  useMpvProperty('pause', (value) => setPaused(value !== false))

  const mpv = window.keyframe.mpv

  /**
   * Ужать картинку под панель.
   *
   * Доля, а не пиксели: mpv считает поля от высоты своего окна, и при смене
   * размера окна доля должна пересчитываться — иначе на развёрнутом окне
   * панель закроет часть кадра, а на маленьком под ней останется чёрная
   * полоса.
   */
  useEffect(() => {
    const apply = (): void => {
      const ratio = Math.min(0.6, HEIGHT / Math.max(window.innerHeight, 1))
      void mpv.set('video-margin-ratio-bottom', ratio)
    }

    apply()
    window.addEventListener('resize', apply)

    return () => {
      window.removeEventListener('resize', apply)
      void mpv.set('video-margin-ratio-bottom', 0)
    }
  }, [mpv])

  /**
   * Выход: вернуть исходный файл и встать на ту же секунду, что была под
   * плейхедом. Уйти из редактора и оказаться в другом месте фильма —
   * неожиданность, которой быть не должно.
   */
  const leave = useCallback(() => {
    const point = pointAt(editor.project, editor.playhead.current)

    // Сохранение по таймеру ждёт семьсот миллисекунд, и последний рез перед
    // выходом в них не укладывается — записываем нарезку сразу
    void window.keyframe.editor.saveProject(
      source,
      editor.project.segments.map((segment) => ({ in: segment.in, out: segment.out })),
      duration
    )
    const leftAt = point?.sourceTime ?? startAt
    void window.keyframe.editor.leave(source, leftAt)
    onClose(leftAt)
  }, [editor.project, editor.playhead, source, duration, startAt, onClose])

  const togglePause = useCallback(() => void mpv.command('cycle', 'pause'), [mpv])

  /**
   * Куда на самом деле придётся рез при быстром экспорте.
   *
   * Спрашиваем, только когда открыто окно экспорта: каждый ответ — перемотка в
   * отдельном mpv, и делать это на каждый рез во время работы значило бы
   * занимать тот же процесс, который готовит кадры для полосы.
   */
  useEffect(() => {
    if (!exporting) return

    let cancelled = false

    void (async () => {
      const found = new Map<string, number>()

      for (const segment of editor.project.segments.slice(0, 60)) {
        const keyframe = await window.keyframe.editor.keyframe(source, segment.in)
        if (cancelled) return
        if (typeof keyframe === 'number') found.set(segment.id, keyframe)
      }

      setKeyframes(found)
    })()

    return () => {
      cancelled = true
    }
  }, [exporting, editor.project, source])

  const alignCuts = useCallback(() => {
    const next = alignToKeyframes(editor.project, keyframes)
    if (next === editor.project) {
      onNotice(t('Резы уже стоят на ключевых кадрах'))
      return
    }
    editor.replace(next)
  }, [editor, keyframes, onNotice])

  useEffect(() => {
    const held = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Comma', 'Period'])

    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat && !held.has(event.code)) return

      /*
       * Открытое окно экспорта не отбирает клавиши у дорожки.
       *
       * Раньше оно глушило всё, кроме Escape, — и человек, случайно открывший
       * его, обнаруживал, что редактор целиком «перестал работать», причём
       * непонятно почему. Отбирать клавиши имеет право только то, что их
       * действительно ждёт: список кодека или качества под фокусом.
       */
      const focus = document.activeElement
      if (focus instanceof HTMLSelectElement || focus instanceof HTMLInputElement) return

      switch (event.code) {
        case 'Escape':
          if (exporting) setExporting(false)
          else leave()
          break
        case 'Space':
          event.preventDefault()
          togglePause()
          break
        case 'KeyS':
          if (event.ctrlKey) setExporting(true)
          else editor.split()
          break
        case 'Delete':
        case 'Backspace':
          editor.remove()
          break
        case 'KeyD':
          if (event.ctrlKey) {
            event.preventDefault()
            editor.duplicate()
          }
          break
        case 'KeyZ':
          if (!event.ctrlKey) break
          event.preventDefault()
          if (event.shiftKey) editor.redo()
          else editor.undo()
          break
        case 'KeyY':
          if (event.ctrlKey) editor.redo()
          break
        case 'KeyI':
          editor.markIn()
          break
        case 'KeyO':
          editor.markOut()
          break
        case 'KeyX':
          if (!event.ctrlKey) break
          event.preventDefault()
          if (event.shiftKey) editor.keepMarked()
          else editor.cutMarked()
          break
        case 'KeyA':
          if (!event.ctrlKey) break
          event.preventDefault()
          editor.select(editor.project.segments.map((segment) => segment.id))
          break
        // Вернуть весь файл. Отменяется тем же Ctrl+Z, что и всё остальное
        case 'KeyR':
          if (!event.ctrlKey) break
          event.preventDefault()
          editor.reset()
          break
        case 'ArrowLeft':
          if (event.altKey) editor.toBoundary(-1)
          else editor.seek(editor.playhead.current - 5)
          break
        case 'ArrowRight':
          if (event.altKey) editor.toBoundary(1)
          else editor.seek(editor.playhead.current + 5)
          break
        case 'ArrowUp':
        case 'ArrowDown':
          // Громкость остаётся под теми же клавишами, что и в плеере: слышать
          // то, что режешь, нужно не меньше, чем видеть
          void mpv.command('add', 'volume', event.code === 'ArrowUp' ? 5 : -5)
          break
        case 'KeyM':
          void mpv.command('cycle', 'mute')
          break
        case 'Comma':
          editor.stepFrame(-1)
          break
        case 'Period':
          editor.stepFrame(1)
          break
        case 'Equal':
        case 'NumpadAdd':
          controls.current?.zoomBy(1.4)
          break
        case 'Minus':
        case 'NumpadSubtract':
          controls.current?.zoomBy(1 / 1.4)
          break
        case 'KeyF':
          if (event.shiftKey) controls.current?.fit()
          else void window.keyframe.window.toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, exporting, leave, togglePause, mpv])

  const marked = editor.marks.in !== null && editor.marks.out !== null
  const removed = duration - editor.duration
  const selected = editor.selection.length > 0

  return (
    <div className="editor" style={{ height: `${HEIGHT}px` }}>
      <div className="editor__bar">
        <Tool onClick={togglePause} hint={paused ? t('Играть') : t('Пауза')} keys={t('Пробел')}>
          <PlayIcon paused={paused} />
        </Tool>

        <Split />

        <Tool onClick={editor.split} hint={t('Разрезать по плейхеду')} keys="S">
          <ScissorsIcon />
        </Tool>
        <Tool
          onClick={editor.remove}
          disabled={!selected}
          hint={t('Удалить выбранное со сдвигом')}
          keys="Del"
        >
          <TrashIcon />
        </Tool>
        <Tool onClick={editor.duplicate} disabled={!selected} hint={t('Дублировать')} keys="Ctrl+D">
          <CopyIcon />
        </Tool>

        <Split />

        <Tool
          onClick={editor.markIn}
          active={editor.marks.in !== null}
          hint={t('Отметить начало момента')}
          keys="I"
        >
          <MarkIcon />
        </Tool>
        <Tool
          onClick={editor.markOut}
          active={editor.marks.out !== null}
          hint={t('Отметить конец момента')}
          keys="O"
        >
          <MarkIcon end />
        </Tool>

        {/*
          Действия над отмеченным моментом появляются вместе с самим моментом.
          Держать их на панели постоянно — значит держать две кнопки, которые
          девяносто процентов времени ничего не делают.
        */}
        {(editor.marks.in !== null || editor.marks.out !== null) && (
          <div className="emark">
            <span className="emark__range tnum">
              {editor.marks.in === null ? '—' : formatTime(Math.min(editor.marks.in, editor.marks.out ?? editor.marks.in))}
              {' – '}
              {editor.marks.out === null ? '—' : formatTime(Math.max(editor.marks.out, editor.marks.in ?? editor.marks.out))}
            </span>
            <button className="emark__action" onClick={editor.cutMarked} disabled={!marked}>
              {t('Вырезать')}
            </button>
            <button className="emark__action" onClick={editor.keepMarked} disabled={!marked}>
              {t('Оставить')}
            </button>
            <button className="emark__clear" onClick={editor.clearMarks} aria-label={t('Снять метки')}>
              <svg width="9" height="9" viewBox="0 0 10 10">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
        )}

        <Split />

        <Tool onClick={editor.undo} disabled={!editor.canUndo} hint={t('Отменить')} keys="Ctrl+Z">
          <UndoIcon />
        </Tool>
        <Tool
          onClick={editor.redo}
          disabled={!editor.canRedo}
          hint={t('Повторить')}
          keys="Ctrl+Shift+Z"
        >
          <UndoIcon flipped />
        </Tool>
        <Tool
          onClick={editor.reset}
          disabled={removed <= 0.05}
          hint={t('Вернуть весь файл целиком')}
          keys="Ctrl+R"
        >
          <RestoreIcon />
        </Tool>

        <div className="spacer" />

        {removed > 0.05 && (
          <div className="editor__summary tnum">
            {formatTime(editor.duration)}
            <span className="editor__was"> · вырезано {formatTime(removed)}</span>
          </div>
        )}

        <Tool onClick={() => controls.current?.zoomBy(1 / 1.4)} hint={t('Отдалить')} keys="−">
          <ZoomIcon />
        </Tool>
        <Tool onClick={() => controls.current?.fit()} hint={t('Вписать целиком')} keys="Shift+F">
          <FitIcon />
        </Tool>
        <Tool onClick={() => controls.current?.zoomBy(1.4)} hint={t('Приблизить')} keys="+">
          <ZoomIcon plus />
        </Tool>

        <Split />

        <button
          className="editor__save"
          onClick={() => setExporting(true)}
          disabled={editor.project.segments.length === 0}
          title={t('Сохранить нарезку (Ctrl+S)')}
        >
          {t('Сохранить')}
        </button>

        <button className="editor__done" onClick={leave} title={t('Выйти из редактора (Esc)')}>
          {t('Готово')}
        </button>
      </div>

      <EditorTimeline
        editor={editor}
        source={source}
        controls={controls}
        keyframes={exporting ? keyframes : EMPTY}
      />

      {exporting && (
        <ExportPanel
          source={source}
          segments={editor.project.segments}
          hasAudio={hasAudio}
          keyframes={keyframes}
          onAlign={alignCuts}
          onClose={() => setExporting(false)}
          onReplaced={() => onClose(0)}
          onNotice={onNotice}
        />
      )}
    </div>
  )
}

/**
 * Кнопка панели. Подсказка собирается из действия и клавиши: без клавиш
 * редактором пользоваться можно, но медленно, а искать их в справке никто
 * не станет.
 */
function Tool({
  onClick,
  disabled,
  active,
  hint,
  keys,
  children
}: {
  onClick: () => void
  disabled?: boolean
  /** Кнопка-состояние: метка уже поставлена */
  active?: boolean
  hint: string
  keys: string
  children: JSX.Element
}): JSX.Element {
  return (
    <button
      className="etool"
      onClick={onClick}
      disabled={disabled}
      data-active={active}
      title={`${hint} (${keys})`}
    >
      {children}
    </button>
  )
}

/** Разделитель групп: тонкая линия вместо промежутка — иначе группы не читаются. */
function Split(): JSX.Element {
  return <span className="esplit" />
}


const EMPTY: ReadonlyMap<string, number> = new Map()

function PlayIcon({ paused }: { paused: boolean }): JSX.Element {
  return paused ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.5l9 5.5-9 5.5z" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="9" y="2.5" width="3.5" height="11" rx="1" />
    </svg>
  )
}

/** Круговая стрелка: вернуть весь файл целиком. */
function RestoreIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2.6 8a5.4 5.4 0 105.4-5.4c-1.9 0-3.6 1-4.5 2.5" strokeLinecap="round" />
      <path d="M2.4 2.2v3h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ScissorsIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="3.6" cy="12.4" r="2.1" />
      <circle cx="12.4" cy="12.4" r="2.1" />
      <path d="M5.1 10.9L12.4 1.6M10.9 10.9L3.6 1.6" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" strokeLinejoin="round" />
    </svg>
  )
}

function CopyIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M10.5 2.5h-8a1 1 0 00-1 1v8" strokeLinecap="round" />
    </svg>
  )
}

/** Квадратная скобка: метка начала момента; развёрнутая — метка конца. */
function MarkIcon({ end }: { end?: boolean }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      style={end ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9.5 3H5.5v10h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 3v10" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}

function ZoomIcon({ plus }: { plus?: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.4 10.4L14 14" strokeLinecap="round" />
      <path d={plus ? 'M4.8 7h4.4M7 4.8v4.4' : 'M4.8 7h4.4'} strokeLinecap="round" />
    </svg>
  )
}

/** Стрелки в стороны: вписать всю нарезку в ширину дорожки. */
function FitIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 4v8M14.5 4v8" strokeLinecap="round" />
      <path d="M4.5 8h7M6.5 5.6L4.2 8l2.3 2.4M9.5 5.6L11.8 8l-2.3 2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UndoIcon({ flipped }: { flipped?: boolean }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      style={flipped ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M3 7h7a3.5 3.5 0 010 7H6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 4L2.5 7l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
