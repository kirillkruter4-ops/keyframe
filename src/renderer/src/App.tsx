import { useCallback, useEffect, useRef, type JSX } from 'react'
import { usePlayer, useMousePassthrough, useIdleChrome, useWindowDrag } from './usePlayer'
import logoUrl from './assets/logo.svg'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

export function App(): JSX.Element {
  const player = usePlayer()
  useMousePassthrough()
  const startDrag = useWindowDrag()

  const hasFile = player.filename !== null
  const chromeVisible = useIdleChrome(2500, hasFile && !player.paused)
  const timelineRef = useRef<HTMLDivElement>(null)

  const mpv = window.keyframe.mpv

  const togglePause = useCallback(() => {
    void mpv.command('cycle', 'pause')
  }, [mpv])

  const seekBy = useCallback(
    (delta: number) => {
      void mpv.command('seek', delta, 'relative')
    },
    [mpv]
  )

  const openFile = useCallback(() => {
    void window.keyframe.openFile()
  }, [])

  // Клавиатура живёт в оверлее, но фокус всегда на host-окне, поэтому
  // слушаем на window — Electron доставляет события обоим окнам.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat && event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return

      switch (event.code) {
        case 'Space':
        case 'KeyK':
          event.preventDefault()
          togglePause()
          break
        case 'ArrowRight':
          seekBy(5)
          break
        case 'ArrowLeft':
          seekBy(-5)
          break
        case 'KeyL':
          seekBy(10)
          break
        case 'KeyJ':
          seekBy(-10)
          break
        case 'ArrowUp':
          void mpv.command('add', 'volume', 5)
          break
        case 'ArrowDown':
          void mpv.command('add', 'volume', -5)
          break
        case 'KeyM':
          void mpv.command('cycle', 'mute')
          break
        case 'KeyF':
          void window.keyframe.window.toggleFullscreen()
          break
        case 'KeyO':
          if (event.ctrlKey) openFile()
          break
        case 'Escape':
          void window.keyframe.window.toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause, seekBy, openFile, mpv])

  const seekToPoint = useCallback(
    (clientX: number) => {
      const track = timelineRef.current
      if (!track || player.duration <= 0) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      void mpv.command('seek', ratio * player.duration, 'absolute')
    },
    [mpv, player.duration]
  )

  const progress = player.duration > 0 ? (player.timePos / player.duration) * 100 : 0
  const buffered =
    player.duration > 0
      ? Math.min(100, ((player.timePos + player.cacheDuration) / player.duration) * 100)
      : 0

  return (
    <div className="overlay" data-hidden={!chromeVisible}>
      <div
        className="titlebar"
        data-interactive
        onMouseDown={startDrag}
        onDoubleClick={() => void window.keyframe.window.toggleMaximize()}
      >
        <div className="titlebar__title">{player.filename ?? 'Keyframe'}</div>
        <div className="titlebar__buttons" onMouseDown={(e) => e.stopPropagation()}>
          <button
            className="titlebar__button"
            onClick={() => void window.keyframe.window.minimize()}
            aria-label="Свернуть"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            className="titlebar__button"
            onClick={() => void window.keyframe.window.toggleFullscreen()}
            aria-label="Полный экран"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            className="titlebar__button titlebar__button--close"
            onClick={() => void window.keyframe.window.close()}
            aria-label="Закрыть"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <Diagnostics player={player} />

      {!hasFile && (
        <div className="empty">
          <img className="empty__logo" src={logoUrl} alt="" />
          <div>
            <div className="empty__title">Перетащите файл сюда</div>
            <div className="empty__hint">
              или <kbd>Ctrl</kbd> + <kbd>O</kbd>, чтобы открыть
            </div>
          </div>
          <button className="control" data-interactive onClick={openFile} style={{ width: 'auto', padding: '0 16px' }}>
            Открыть файл
          </button>
        </div>
      )}

      {hasFile && (
        <div className="chrome" data-interactive>
          <div
            className="timeline"
            ref={timelineRef}
            onMouseDown={(e) => seekToPoint(e.clientX)}
            role="slider"
            aria-label="Позиция воспроизведения"
            aria-valuemin={0}
            aria-valuemax={player.duration}
            aria-valuenow={player.timePos}
            tabIndex={0}
          >
            <div className="timeline__track">
              <div className="timeline__buffer" style={{ width: `${buffered}%` }} />
              <div className="timeline__fill" style={{ width: `${progress}%` }} />
              <div className="timeline__thumb" style={{ left: `${progress}%` }} />
            </div>
          </div>

          <div className="controls">
            <button className="control" onClick={togglePause} aria-label={player.paused ? 'Играть' : 'Пауза'}>
              {player.paused ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2.5l9 5.5-9 5.5z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3.5" y="2.5" width="3.5" height="11" rx="1" />
                  <rect x="9" y="2.5" width="3.5" height="11" rx="1" />
                </svg>
              )}
            </button>

            <button className="control" onClick={() => void mpv.command('cycle', 'mute')} aria-label="Звук">
              {player.muted ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
                  <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
                  <path
                    d="M10.5 5.5a3.5 3.5 0 010 5M12.6 3.4a6.5 6.5 0 010 9.2"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            <div className="timecode tnum">
              <span className="timecode__current">{formatTime(player.timePos)}</span>
              <span> / {formatTime(player.duration)}</span>
            </div>

            <div className="spacer" />

            <button className="control" onClick={openFile} aria-label="Открыть файл">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M1.5 4.5h5l1.5 2h6.5v7h-13z" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              className="control"
              onClick={() => void window.keyframe.window.toggleFullscreen()}
              aria-label="Полный экран"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Панель существует только ради спайка: она отвечает на вопросы,
 * ради которых спайк и затевался. Перед v0.1 её нужно убрать.
 */
function Diagnostics({ player }: { player: ReturnType<typeof usePlayer> }): JSX.Element {
  const hwOk = player.hwdec !== null && player.hwdec !== 'no'

  return (
    <div className="diag">
      <div className="diag__row">
        <span>Движок</span>
        <span className={`diag__value ${player.crashed ? 'diag__value--warn' : 'diag__value--ok'}`}>
          {player.crashed ? 'упал' : player.ready ? 'готов' : 'запуск…'}
        </span>
      </div>
      <div className="diag__row">
        <span>Разрешение</span>
        <span className="diag__value tnum">
          {player.videoWidth ? `${player.videoWidth}×${player.videoHeight}` : '—'}
        </span>
      </div>
      <div className="diag__row">
        <span>Декодер</span>
        <span className={`diag__value ${hwOk ? 'diag__value--ok' : 'diag__value--warn'}`}>
          {player.hwdec ?? '—'}
        </span>
      </div>
      <div className="diag__row">
        <span>FPS</span>
        <span className="diag__value tnum">{player.fps ? player.fps.toFixed(1) : '—'}</span>
      </div>
      <div className="diag__row">
        <span>Пропущено кадров</span>
        <span className={`diag__value tnum ${player.frameDrops > 0 ? 'diag__value--warn' : 'diag__value--ok'}`}>
          {player.frameDrops}
        </span>
      </div>
    </div>
  )
}
