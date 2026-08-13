import { useCallback, useEffect, useRef, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import {
  usePlayer,
  useIdleChrome,
  useWindowDrag,
  useWindowState,
  useScrub,
  useOsd,
  useUpdate,
  type PlayerState,
  type OsdMessage,
  type UpdateStatus
} from './usePlayer'
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
  const startDrag = useWindowDrag()
  const { fullscreen, maximized } = useWindowState()
  const [osd, showOsd] = useOsd()
  const update = useUpdate()

  const hasFile = player.filename !== null
  const chromeVisible = useIdleChrome(2500, hasFile && !player.paused)

  const mpv = window.keyframe.mpv

  /**
   * Пока тащим — перематываем по ключевым кадрам: так картинка успевает за
   * пальцем. На отпускании один точный переход в нужную позицию.
   */
  const timeline = useScrub((ratio, done) => {
    if (player.duration <= 0) return
    void mpv.command('seek', ratio * player.duration, done ? 'absolute' : 'absolute+keyframes')
  })

  const volume = useScrub((ratio) => {
    void mpv.set('volume', Math.round(ratio * 100))
    // Крутить громкость при включённом mute бессмысленно — снимаем его
    if (player.muted) void mpv.set('mute', false)
  })

  const togglePause = useCallback(() => {
    void mpv.command('cycle', 'pause')
  }, [mpv])

  const toggleFullscreen = useCallback(() => {
    void window.keyframe.window.toggleFullscreen()
  }, [])

  const seekBy = useCallback(
    (delta: number) => {
      void mpv.command('seek', delta, 'relative')
      showOsd({
        label: `${delta > 0 ? '+' : '−'}${Math.abs(delta)} с`,
        icon: delta > 0 ? 'forward' : 'back'
      })
    },
    [mpv, showOsd]
  )

  /**
   * Новое значение считаем сами, а не ждём ответа mpv: подсказка должна
   * появиться в момент нажатия, иначе она отстаёт на круг IPC.
   *
   * При зажатой клавише нажатия идут ~30 раз в секунду — быстрее, чем mpv
   * успевает подтвердить новое значение. Поэтому считаем от собственного
   * счётчика, а не от player.volume: иначе каждое следующее нажатие
   * отталкивалось бы от устаревшего числа и громкость стояла бы на месте.
   */
  const pendingVolume = useRef<number | null>(null)

  useEffect(() => {
    if (pendingVolume.current === null) return
    // mpv подтвердил наше значение — дальше снова доверяем ему
    if (Math.round(player.volume) === pendingVolume.current) pendingVolume.current = null
  }, [player.volume])

  const adjustVolume = useCallback(
    (delta: number) => {
      const base = pendingVolume.current ?? player.volume
      const next = Math.min(100, Math.max(0, Math.round(base + delta)))
      pendingVolume.current = next

      void mpv.set('volume', next)
      if (player.muted && next > 0) void mpv.set('mute', false)
      showOsd({ label: `${next}%`, meter: next, icon: next === 0 ? 'mute' : 'volume' })
    },
    [mpv, player.volume, player.muted, showOsd]
  )

  const toggleMute = useCallback(() => {
    const next = !player.muted
    void mpv.set('mute', next)
    showOsd({
      label: next ? 'Без звука' : `${Math.round(player.volume)}%`,
      meter: next ? 0 : player.volume,
      icon: next ? 'mute' : 'volume'
    })
  }, [mpv, player.muted, player.volume, showOsd])

  const openFile = useCallback(() => {
    void window.keyframe.openFile()
  }, [])

  useEffect(() => {
    // Клавиши, которые имеют смысл при удержании: перемотка и громкость.
    // Остальные срабатывают один раз на нажатие.
    const repeatable = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyJ', 'KeyL'])

    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat && !repeatable.has(event.code)) return

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
          adjustVolume(5)
          break
        case 'ArrowDown':
          adjustVolume(-5)
          break
        case 'KeyM':
          toggleMute()
          break
        case 'KeyF':
        case 'Escape':
          toggleFullscreen()
          break
        case 'KeyO':
          if (event.ctrlKey) openFile()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePause, seekBy, openFile, toggleFullscreen, adjustVolume, toggleMute])

  /**
   * Клик по видео. Слой хрома не принимает мышь, поэтому сюда попадают только
   * клики мимо органов управления — проверка target нужна для пустого состояния,
   * где внутри лежит кнопка.
   */
  const onSurfaceClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (hasFile) togglePause()
  }

  const onSurfaceDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (hasFile) toggleFullscreen()
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    adjustVolume(event.deltaY < 0 ? 5 : -5)
  }

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    const filePath = window.keyframe.getPathForFile(file)
    if (filePath) void mpv.command('loadfile', filePath, 'replace')
  }

  // Пока таймлайн тащат, показываем позицию под пальцем, а не отстающую от mpv
  const progress =
    timeline.ratio !== null
      ? timeline.ratio * 100
      : player.duration > 0
        ? (player.timePos / player.duration) * 100
        : 0

  const buffered =
    player.duration > 0
      ? Math.min(100, ((player.timePos + player.cacheDuration) / player.duration) * 100)
      : 0

  const volumeLevel = player.muted ? 0 : volume.ratio !== null ? volume.ratio * 100 : player.volume

  // Выкрученный в ноль ползунок — это тоже «звука нет», иконка должна совпадать
  const silent = player.muted || volumeLevel < 1

  return (
    <div
      className="overlay"
      data-idle={!chromeVisible}
      onClick={onSurfaceClick}
      onDoubleClick={onSurfaceDoubleClick}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {osd && <Osd message={osd} />}
      <UpdateBanner status={update} />

      <div className="chrome-layer" data-hidden={!chromeVisible}>
        <div className="titlebar" onMouseDown={startDrag} onDoubleClick={() => void window.keyframe.window.toggleMaximize()}>
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
              onClick={() => void window.keyframe.window.toggleMaximize()}
              aria-label={fullscreen || maximized ? 'Восстановить' : 'Развернуть'}
            >
              {fullscreen || maximized ? (
                // Два смещённых квадрата — привычный для Windows знак «восстановить»
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2.6 2.6V1h6.4v6.4H7.4" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="1" y="2.6" width="6.4" height="6.4" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
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

        {hasFile && (
          <div className="chrome">
            <div
              className="timeline"
              ref={timeline.ref}
              data-scrubbing={timeline.ratio !== null}
              {...timeline.handlers}
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

              <div className="volume">
                <button
                  className="control"
                  onClick={toggleMute}
                  aria-label={silent ? 'Включить звук' : 'Выключить звук'}
                >
                  {silent ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
                      <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
                      <path
                        d={
                          volumeLevel > 55
                            ? 'M10.5 5.5a3.5 3.5 0 010 5M12.6 3.4a6.5 6.5 0 010 9.2'
                            : 'M10.5 5.5a3.5 3.5 0 010 5'
                        }
                        stroke="currentColor"
                        strokeWidth="1.3"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>

                <div
                  className="volume__slider"
                  ref={volume.ref}
                  {...volume.handlers}
                  role="slider"
                  aria-label="Громкость"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(volumeLevel)}
                  tabIndex={0}
                >
                  <div className="volume__track">
                    <div className="volume__fill" style={{ width: `${volumeLevel}%` }} />
                    <div className="volume__thumb" style={{ left: `${volumeLevel}%` }} />
                  </div>
                </div>
              </div>

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
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Выйти из полного экрана' : 'Полный экран'}
              >
                {fullscreen ? (
                  // Стрелки внутрь — «свернуть обратно»
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {!hasFile && (
        <div className="empty">
          <img className="empty__logo" src={logoUrl} alt="" />
          <div>
            <div className="empty__title">Перетащите файл сюда</div>
            <div className="empty__hint">
              или <kbd>Ctrl</kbd> + <kbd>O</kbd>, чтобы открыть
            </div>
          </div>
          <button className="empty__button" onClick={openFile}>
            Открыть файл
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Сообщение о новой версии.
 *
 * Живёт в углу и не перехватывает мышь мимо своих кнопок: обновление не должно
 * мешать смотреть. Скачивание начинается только по нажатию — тянуть 200 МБ
 * фоном под чужой фильм нельзя.
 */
function UpdateBanner({ status }: { status: UpdateStatus }): JSX.Element | null {
  const api = window.keyframe.update

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'error') return null

  return (
    <div className="update">
      {status.state === 'available' && (
        <>
          <span className="update__text">
            Доступна версия <b>{status.version}</b>
          </span>
          <button className="update__button" onClick={() => void api.download()}>
            Обновить
          </button>
        </>
      )}

      {status.state === 'downloading' && (
        <>
          <span className="update__text tnum">Загрузка {status.percent}%</span>
          <span className="update__progress">
            <span className="update__progress-fill" style={{ width: `${status.percent}%` }} />
          </span>
        </>
      )}

      {status.state === 'ready' && (
        <>
          <span className="update__text">
            Версия <b>{status.version}</b> готова
          </span>
          <button className="update__button" onClick={() => void api.install()}>
            Перезапустить
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Подсказка о результате действия. Показывается поверх видео и сама угасает.
 *
 * key по id перезапускает анимацию: при быстрых повторных нажатиях подсказка
 * должна вспыхивать заново, а не висеть неподвижно.
 */
function Osd({ message }: { message: OsdMessage }): JSX.Element {
  return (
    <div className="osd" key={message.id}>
      {message.icon && <OsdIcon icon={message.icon} />}
      <span className="osd__label tnum">{message.label}</span>
      {message.meter !== undefined && (
        <span className="osd__meter">
          <span className="osd__meter-fill" style={{ width: `${message.meter}%` }} />
        </span>
      )}
    </div>
  )
}

function OsdIcon({ icon }: { icon: NonNullable<OsdMessage['icon']> }): JSX.Element {
  switch (icon) {
    case 'forward':
      return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3l5.5 5L2 13zM8.5 3L14 8l-5.5 5z" />
        </svg>
      )
    case 'back':
      return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 3L8.5 8 14 13zM7.5 3L2 8l5.5 5z" />
        </svg>
      )
    case 'mute':
      return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
          <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      )
    case 'volume':
      return (
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2.5L4.5 5.5H2v5h2.5L8 13.5z" />
          <path
            d="M10.5 5.5a3.5 3.5 0 010 5M12.6 3.4a6.5 6.5 0 010 9.2"
            stroke="currentColor"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      )
  }
}

/**
 * Панель существует только ради спайка: она отвечает на вопросы,
 * ради которых спайк и затевался. Перед v0.1 её нужно убрать.
 */
function Diagnostics({ player }: { player: PlayerState }): JSX.Element {
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
