import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  usePlayer,
  useIdleChrome,
  useWindowDrag,
  useWindowState,
  useScrub,
  useOsd,
  useNotice,
  useSettings,
  useUpdate,
  type PlayerState,
  type OsdMessage,
  type Notice,
  type UpdateStatus
} from './usePlayer'
import { ContextMenu, Tracks, trackLabel, type MenuActions } from './ContextMenu'
import { PlaylistPanel, SettingsPanel } from './Settings'
import { Timecode, Timeline, hintSeek } from './Timeline'
import { justDragged, useDragPanel } from './useDragPanel'
import { Editor } from './editor/Editor'
import { useCommands, type CommandActions } from './commands'
import { Palette } from './Palette'
import { Shortcuts } from './Shortcuts'
import { formatTime } from './format'
import logoUrl from './assets/logo.svg'
import { LangContext, translate, useT } from './i18n'

/** Шаги скорости. Ниже 0.25 речь неразборчива, выше 3 — бессмысленна. */
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3]

/**
 * Что забирает колесо себе.
 *
 * Перечислением, а не проверкой «прокручивается ли элемент»: панель без
 * прокрутки всё равно не место для громкости — вниз по ней колесо ничего не
 * даёт, а звук уезжает.
 */
const WHEEL_SURFACES = '.editor, .panel, .palette, .shortcuts, .menu, .tracks'

/** Такой файл перетащили как субтитры, а не как видео. */
const SUBTITLE_EXTENSIONS = /\.(srt|ass|ssa|sub|vtt|sup|idx|lrc)$/i

export function App(): JSX.Element {

  const player = usePlayer()
  const startDrag = useWindowDrag()
  const { fullscreen, maximized, alwaysOnTop } = useWindowState()
  const [osd, showOsd] = useOsd()
  const [notice, showNotice] = useNotice()
  const update = useUpdate()
  const [tracksOpen, setTracksOpen] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [settings, updateSettings] = useSettings()

  /*
   * App сам создаёт LangContext, поэтому внутри себя прочитать его не может —
   * useT здесь вернул бы значение по умолчанию, и весь текст самого App
   * (подсказки, сообщения, кнопки титлбара) остался бы русским при английском
   * интерфейсе. Язык у нас уже есть: берём его из настроек напрямую.
   */
  const t = useCallback(
    (text: string) => translate(settings.language, text),
    [settings.language]
  )

  /** Что открыто поверх видео: разом показываем только одно. */
  const [panel, setPanel] = useState<'info' | 'settings' | 'playlist' | null>(null)

  /** Палитра команд и шпаргалка — каждая поверх всего остального. */
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [recent, setRecent] = useState<string[]>([])

  /**
   * Где на дорожке закончил редактор — долей от всего фильма.
   *
   * Пока mpv заново открывает исходный файл, он присылает нулевую позицию, и
   * дорожка честно рисует ноль: полоса прыгает в начало и возвращается только
   * тогда, когда пойдёт воспроизведение. Место мы знаем заранее, поэтому не
   * гадаем по приходящим свойствам, а передаём его напрямую.
   */
  const [leftEditorRatio, setLeftEditorRatio] = useState<number | null>(null)

  /**
   * Открытый редактор. Хранится файлом и секундой, а не флагом: пока он открыт,
   * плеер показывает склейку `edl://`, и `player.path` указывает уже на неё —
   * узнать по нему, что мы режем, будет нельзя.
   */
  const [editing, setEditing] = useState<{
    source: string
    duration: number
    startAt: number
  } | null>(null)

  // Ссылка постоянная намеренно: панели не перерисовываются вместе с позицией
  // воспроизведения только пока все их свойства остаются теми же самыми
  const closePanel = useCallback(() => setPanel(null), [])

  const hasFile = player.filename !== null
  // Открытое меню или панель — причина не прятать хром: под курсором органы.
  // Редактор — тем более: дорожка, которая гаснет посреди резки, невыносима
  const chromeVisible = useIdleChrome(
    2500,
    hasFile && !player.paused && !tracksOpen && menuAt === null && panel === null && !editing
  )

  const mpv = window.keyframe.mpv

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
      /*
       * Сначала двигаем интерфейс, потом просим движок.
       *
       * Ответа ждать нельзя: между нажатием и первым подтверждением от mpv
       * лежит круг IPC и сам переход, и всё это время цифра с полосой стояли
       * бы на месте — отклик воспринимается именно по ним, а не по картинке.
       *
       * exact: без него mpv останавливается на ближайшем ключевом кадре, и
       * «+5 секунд» от 5:46 приводили то на 5:50, то на 5:51 — шаг переставал
       * быть шагом. Заодно это значит, что показанная нами секунда и есть та,
       * куда приедет движок, и поправлять её задним числом не придётся.
       */
      hintSeek(delta)
      void mpv.command('seek', delta, 'relative+exact')
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
      label: next ? t('Без звука') : `${Math.round(player.volume)}%`,
      meter: next ? 0 : player.volume,
      icon: next ? 'mute' : 'volume'
    })
  }, [mpv, player.muted, player.volume, showOsd])

  const openFile = useCallback(() => {
    void window.keyframe.openFile()
  }, [])

  /**
   * Войти в редактор.
   *
   * Секунду берём снимком состояния, а не из React: позиция воспроизведения
   * туда намеренно не попадает — она меняется с частотой кадров. Редактор
   * должен открыться на том кадре, который зритель видит перед собой.
   */
  const openEditor = useCallback(async () => {
    if (!player.path || player.duration <= 0) return

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(player.path)) {
      showNotice({ kind: 'error', text: t('Резать можно только файлы на диске, не потоки') })
      return
    }

    const snapshot = await mpv.state()
    const position = Number(snapshot['time-pos'])

    setPanel(null)
    setTracksOpen(false)
    setMenuAt(null)
    setEditing({
      source: player.path,
      duration: player.duration,
      startAt: Number.isFinite(position) ? position : 0
    })
  }, [mpv, player.path, player.duration, showNotice])

  /**
   * Палитра открывается со свежей историей.
   *
   * Список читается в момент открытия, а не подпиской: он меняется раз в
   * несколько минут, а держать его в состоянии значило бы перерисовывать окно
   * на каждый открытый файл.
   */
  const openPalette = useCallback(() => {
    void window.keyframe.playlist.recent().then(setRecent)
    setPalette(true)
  }, [])

  // Открыли другой файл, пока висел редактор: резать уже нечего. Склейку
  // (edl://) за смену файла не считаем — это и есть то, что мы сами загрузили
  useEffect(() => {
    if (!editing || !player.path) return
    if (player.path === editing.source) return
    if (player.path.startsWith('edl://')) return

    setEditing(null)
    void window.keyframe.editor.setActive(false)
  }, [editing, player.path])

  /**
   * Скорость двигается по фиксированным ступеням, а не умножением: так до
   * привычного 1× всегда можно вернуться тем же числом нажатий, каким ушёл.
   */
  const changeSpeed = useCallback(
    (direction: number) => {
      const closest = SPEEDS.reduce((best, value, index) =>
        Math.abs(value - player.speed) < Math.abs(SPEEDS[best] - player.speed) ? index : best, 0)
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, closest + direction))]

      void mpv.set('speed', next)
      showOsd({ label: `${next}×` })
    },
    [mpv, player.speed, showOsd]
  )

  const setSpeed = useCallback(
    (value: number) => {
      void mpv.set('speed', value)
      showOsd({ label: `${value}×` })
    },
    [mpv, showOsd]
  )

  const resetSpeed = useCallback(() => setSpeed(1), [setSpeed])

  const adjustSubDelay = useCallback(
    (delta: number) => {
      const next = Math.round((player.subDelay + delta) * 100) / 100
      void mpv.set('sub-delay', next)
      showOsd({ label: `Субтитры ${next > 0 ? '+' : ''}${next.toFixed(1).replace('.', ',')} с` })
    },
    [mpv, player.subDelay, showOsd]
  )

  /**
   * Покадровая перемотка. mpv сам ставит паузу на первом же шаге — иначе
   * следующий кадр немедленно сменился бы воспроизведением.
   */
  const frameStep = useCallback(
    (direction: number) => {
      void mpv.command(direction > 0 ? 'frame-step' : 'frame-back-step')
      showOsd({ label: direction > 0 ? t('Кадр +1') : t('Кадр −1'), icon: direction > 0 ? 'forward' : 'back' })
    },
    [mpv, showOsd]
  )

  const takeScreenshot = useCallback(async () => {
    const target = await window.keyframe.mpv.screenshot()
    if (!target) {
      showNotice({ kind: 'error', text: t('Не удалось сохранить снимок кадра') })
      return
    }
    showNotice({
      kind: 'info',
      text: t('Снимок сохранён в «Изображения\\Keyframe»'),
      action: { label: t('Показать'), run: () => void window.keyframe.showItem(target) }
    })
  }, [showNotice])

  const toggleSubtitles = useCallback(() => {
    const next = !player.subVisible
    void mpv.set('sub-visibility', next)
    showOsd({ label: next ? t('Субтитры вкл') : t('Субтитры выкл') })
  }, [mpv, player.subVisible, showOsd])

  // Ошибку открытия файл сам не показывает: без сообщения экран просто
  // останется чёрным, и причина будет непонятна
  useEffect(
    () =>
      window.keyframe.mpv.onEvent((name, data) => {
        if (name !== 'end-file' || data.reason !== 'error') return
        const detail = typeof data.file_error === 'string' ? `: ${data.file_error}` : ''
        showNotice({ kind: 'error', text: `Не удалось открыть файл${detail}` })
      }),
    [showNotice]
  )

  useEffect(
    () => window.keyframe.mpv.onResumed((position) => showOsd({ label: `С ${formatTime(position)}` })),
    [showOsd]
  )

  useEffect(() => {
    if (!player.crashed) return
    showNotice({
      kind: 'error',
      text: t('Движок воспроизведения упал'),
      action: { label: t('Перезапустить'), run: () => void window.keyframe.mpv.restart() }
    })
  }, [player.crashed, showNotice])

  useEffect(() => {
    // Клавиши, которые имеют смысл при удержании: перемотка и громкость.
    // Остальные срабатывают один раз на нажатие.
    const repeatable = new Set([
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'KeyJ',
      'KeyL',
      // Покадровую перемотку держат зажатой, чтобы доехать до нужного места
      'Period',
      'Comma',
      'KeyG',
      'KeyH'
    ])

    // Без файла играть нечем: mpv на seek и paused отвечает ошибкой, а не
    // молчанием. Пропускаем только то, что осмысленно на пустом экране
    const alwaysAllowed = new Set(['KeyO', 'KeyF', 'Escape'])

    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat && !repeatable.has(event.code)) return

      // Палитра и шпаргалка забирают клавиатуру целиком: под палитрой поле
      // ввода, и «пробел» там должен ставить пробел, а не паузу
      if (palette || shortcuts) {
        if (event.code === 'Escape') {
          setPalette(false)
          setShortcuts(false)
        }
        return
      }

      // Ctrl+K открывает палитру откуда угодно, в том числе из редактора
      if (event.code === 'KeyK' && event.ctrlKey) {
        event.preventDefault()
        openPalette()
        return
      }

      if (event.code === 'F1') {
        event.preventDefault()
        setShortcuts(true)
        return
      }

      // В редакторе своя раскладка целиком: S там режет, а не снимает кадр,
      // I ставит метку, а не показывает сведения. Двух обработчиков на одну
      // клавишу быть не должно — редактор ставит свой и отвечает за всё
      if (editing) return

      // Без файла играть нечем: mpv на seek и paused отвечает ошибкой, а не
      // молчанием. Палитра, шпаргалка и открытие файла сюда не попадают —
      // они разобраны выше и работают на пустом экране
      if (!hasFile && !alwaysAllowed.has(event.code)) return

      switch (event.code) {
        case 'Space':
        case 'KeyK':
          event.preventDefault()
          togglePause()
          break
        case 'ArrowRight':
          seekBy(settings.seekStep)
          break
        case 'ArrowLeft':
          seekBy(-settings.seekStep)
          break
        case 'KeyL':
          seekBy(settings.seekStep * 2)
          break
        case 'KeyJ':
          seekBy(-settings.seekStep * 2)
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
          toggleFullscreen()
          break
        // Escape только закрывает, и по одному за нажатие: меню, панель,
        // сведения, полный экран. Разворачивать им окно нельзя — от Escape
        // ждут ровно обратного
        case 'Escape':
          if (menuAt) setMenuAt(null)
          else if (panel) setPanel(null)
          else if (tracksOpen) setTracksOpen(false)
          else if (fullscreen) toggleFullscreen()
          break
        case 'BracketRight':
          changeSpeed(1)
          break
        case 'BracketLeft':
          changeSpeed(-1)
          break
        case 'Backspace':
          resetSpeed()
          break
        case 'Period':
          frameStep(1)
          break
        case 'Comma':
          frameStep(-1)
          break
        case 'KeyS':
          void takeScreenshot()
          break
        case 'KeyV':
          toggleSubtitles()
          break
        // Рассинхрон субтитров правят на слух, подряд по несколько нажатий
        case 'KeyG':
          adjustSubDelay(-0.1)
          break
        case 'KeyH':
          adjustSubDelay(0.1)
          break
        case 'KeyI':
          setPanel((open) => (open === 'info' ? null : 'info'))
          break
        // Следующий и предыдущий файл списка
        case 'KeyN':
          void mpv.command('playlist-next', 'weak')
          break
        case 'KeyP':
          void mpv.command('playlist-prev', 'weak')
          break
        case 'KeyO':
          if (event.ctrlKey) openFile()
          break
        case 'KeyE':
          void openEditor()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    togglePause,
    seekBy,
    openFile,
    toggleFullscreen,
    adjustVolume,
    toggleMute,
    changeSpeed,
    resetSpeed,
    frameStep,
    takeScreenshot,
    toggleSubtitles,
    adjustSubDelay,
    tracksOpen,
    menuAt,
    panel,
    fullscreen,
    hasFile,
    mpv,
    settings.seekStep,
    editing,
    openEditor,
    palette,
    shortcuts,
    openPalette
  ])

  /**
   * Клик по видео. Слой хрома не принимает мышь, поэтому сюда попадают только
   * клики мимо органов управления — проверка target нужна для пустого состояния,
   * где внутри лежит кнопка.
   */
  const onSurfaceClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Панель, которую только что перетащили, ушла из-под курсора, и щелчок
    // достался видео. Это не «клик мимо панели», а хвост перетаскивания
    if (justDragged()) return

    // Клик по видео мимо меню его закрывает, но не делает ничего сверх этого:
    // иначе выход из меню попутно ставил бы фильм на паузу. Проверка target
    // тут не годится — закрывать нужно и при клике по кнопке на панели
    if (menuAt || tracksOpen || panel) {
      setMenuAt(null)
      setTracksOpen(false)
      setPanel(null)
      return
    }

    if (event.target !== event.currentTarget) return
    if (hasFile) togglePause()
  }

  const onSurfaceDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (hasFile) toggleFullscreen()
  }

  /** Правая кнопка открывает меню там, где нажали, и заменяет уже открытое. */
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    // В редакторе меню плеера предлагало бы снимки и дорожки — не к месту
    if ((event.target as HTMLElement).closest('.editor')) return
    setTracksOpen(false)
    setMenuAt({ x: event.clientX, y: event.clientY })
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    // Крутить громкость нечему, пока ничего не открыто: mpv её примет, но
    // подсказка обещала бы изменение там, где менять нечего
    if (!hasFile) return

    // Колесо принадлежит тому, что открыто поверх видео: списку, настройкам,
    // палитре, дорожке редактора. Крутить громкость, прокручивая список, —
    // ровно то поведение, из-за которого громкость уезжает незаметно для себя
    if ((event.target as HTMLElement).closest(WHEEL_SURFACES)) return

    adjustVolume(event.deltaY < 0 ? 5 : -5)
  }

  /**
   * Перетаскивание. Файл субтитров подключается к тому, что уже играет, —
   * подменять им видео было бы явно не тем, чего от жеста ждут. Остальные
   * файлы открываются списком: первый играет, прочие встают в очередь.
   */
  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.keyframe.getPathForFile(file))
      .filter((path): path is string => Boolean(path))

    if (paths.length === 0) return

    const subtitles = paths.filter((path) => SUBTITLE_EXTENSIONS.test(path))
    const media = paths.filter((path) => !SUBTITLE_EXTENSIONS.test(path))

    if (hasFile && media.length === 0) {
      for (const subtitle of subtitles) void mpv.command('sub-add', subtitle, 'select')
      showOsd({ label: subtitles.length > 1 ? `Субтитры: ${subtitles.length}` : t('Субтитры добавлены') })
      return
    }

    void window.keyframe.playlist.open(media)
  }

  const commandActions: CommandActions = {
    togglePause,
    seekBy,
    frameStep,
    changeSpeed,
    resetSpeed,
    adjustVolume,
    toggleMute,
    toggleFullscreen,
    toggleAlwaysOnTop: () => void window.keyframe.window.toggleAlwaysOnTop(),
    toggleSubtitles,
    adjustSubDelay,
    screenshot: () => void takeScreenshot(),
    openFile,
    openSubtitle: () => {
      void window.keyframe.openSubtitle().then((file) => {
        if (file) void mpv.command('sub-add', file, 'select')
      })
    },
    openEditor: () => void openEditor(),
    showInfo: () => setPanel('info'),
    showSettings: () => setPanel('settings'),
    showPlaylist: () => setPanel('playlist'),
    showShortcuts: () => setShortcuts(true),
    nextFile: () => void mpv.command('playlist-next', 'weak'),
    previousFile: () => void mpv.command('playlist-prev', 'weak'),
    toggleLoop: () => void mpv.set('loop-file', player.loop ? 'no' : 'inf'),
    revealInExplorer: () => {
      if (player.path) void window.keyframe.showItem(player.path)
    },
    checkUpdate: () => void window.keyframe.update.check()
  }

  const commands = useCommands(player, { fullscreen, alwaysOnTop }, commandActions)

  const menuActions: MenuActions = {
    togglePause,
    seekBy,
    frameStep,
    setSpeed,
    toggleMute,
    toggleFullscreen,
    screenshot: () => void takeScreenshot(),
    openFile,
    showInfo: () => setPanel('info'),
    showSettings: () => setPanel('settings'),
    showPlaylist: () => setPanel('playlist'),
    openEditor: () => void openEditor()
  }

  const volumeLevel = player.muted ? 0 : volume.ratio !== null ? volume.ratio * 100 : player.volume

  // Выкрученный в ноль ползунок — это тоже «звука нет», иконка должна совпадать
  const silent = player.muted || volumeLevel < 1

  /*
   * Язык раздаётся контекстом, а не пропсом: панели обёрнуты в memo и на смену
   * языка иначе не перерисовались бы — половина окна осталась бы на прежнем.
   */
  return (
    <LangContext.Provider value={settings.language}>
    <div
      className="overlay"
      data-idle={!chromeVisible}
      onClick={onSurfaceClick}
      onDoubleClick={onSurfaceDoubleClick}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {osd && <Osd message={osd} />}
      {notice && <NoticeBar notice={notice} onClose={() => showNotice(null)} />}
      <UpdateBanner status={update} />

      {menuAt && (
        <ContextMenu
          player={player}
          position={menuAt}
          alwaysOnTop={alwaysOnTop}
          fullscreen={fullscreen}
          onClose={() => setMenuAt(null)}
          actions={menuActions}
        />
      )}

      {panel === 'info' && <FileInfo player={player} onClose={closePanel} />}

      {panel === 'settings' && (
        <SettingsPanel settings={settings} onChange={updateSettings} onClose={closePanel} />
      )}

      {panel === 'playlist' && (
        <PlaylistPanel
          entries={player.playlist}
          position={player.playlistPos}
          loopPlaylist={player.loopPlaylist}
          onClose={closePanel}
        />
      )}

      <div className="chrome-layer" data-hidden={!chromeVisible}>
        <div className="titlebar" onMouseDown={startDrag} onDoubleClick={() => void window.keyframe.window.toggleMaximize()}>
          {/*
            В редакторе mpv играет склейку, и его filename — это вся строка
            edl:// с путём и таймкодами. В заголовке должно стоять имя фильма,
            который режут
          */}
          <div className="titlebar__title">
            {editing ? editing.source.split(/[\\/]/).pop() : (player.filename ?? 'Keyframe')}
          </div>
          <div className="titlebar__buttons" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className="titlebar__button"
              onClick={() => void window.keyframe.window.minimize()}
              aria-label={t('Свернуть')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button
              className="titlebar__button"
              onClick={() => void window.keyframe.window.toggleMaximize()}
              aria-label={fullscreen || maximized ? t('Восстановить') : t('Развернуть')}
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
              aria-label={t('Закрыть')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        </div>

        {hasFile && !editing && (
          <div className="chrome">
            <Timeline duration={player.duration} expectedRatio={leftEditorRatio} />

            <div className="controls">
              <button className="control" onClick={togglePause} aria-label={player.paused ? t('Играть') : t('Пауза')}>
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

              {player.playlist.length > 1 && (
                <>
                  <button
                    className="control"
                    onClick={() => void mpv.command('playlist-prev', 'weak')}
                    disabled={player.playlistPos <= 0}
                    aria-label={t('Предыдущий файл')}
                    title={t('Предыдущий файл (P)')}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13 3L7 8l6 5z" />
                      <rect x="3" y="3" width="2" height="10" rx="1" />
                    </svg>
                  </button>
                  <button
                    className="control"
                    onClick={() => void mpv.command('playlist-next', 'weak')}
                    disabled={player.playlistPos >= player.playlist.length - 1}
                    aria-label={t('Следующий файл')}
                    title={t('Следующий файл (N)')}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M3 3l6 5-6 5z" />
                      <rect x="11" y="3" width="2" height="10" rx="1" />
                    </svg>
                  </button>
                </>
              )}

              <div className="volume">
                <button
                  className="control"
                  onClick={toggleMute}
                  aria-label={silent ? t('Включить звук') : t('Выключить звук')}
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
                  aria-label={t('Громкость')}
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

              <Timecode duration={player.duration} />

              {player.speed !== 1 && (
                <button
                  className="control control--text tnum"
                  onClick={resetSpeed}
                  aria-label={t('Вернуть обычную скорость')}
                  title={t('Обычная скорость')}
                >
                  {player.speed}×
                </button>
              )}

              <div className="spacer" />

              {player.playlist.length > 1 && (
                <button
                  className="control"
                  onClick={() => setPanel(panel === 'playlist' ? null : 'playlist')}
                  data-active={panel === 'playlist'}
                  aria-label={t('Список воспроизведения')}
                  title={t('Список воспроизведения')}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M2 4h9M2 8h9M2 12h6" strokeLinecap="round" />
                    <path d="M13 9.5l1.6 1.6L13 12.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

              <Tracks
                tracks={player.tracks}
                sid={player.sid}
                aid={player.aid}
                subVisible={player.subVisible}
                open={tracksOpen}
                onToggle={() => setTracksOpen((v) => !v)}
              />

              <button
                className="control"
                onClick={() => void takeScreenshot()}
                aria-label={t('Снимок кадра')}
                title={t('Снимок кадра (S)')}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M1.5 4.5h3l1-2h5l1 2h3v8h-13z" strokeLinejoin="round" />
                  <circle cx="8" cy="8.5" r="2.6" />
                </svg>
              </button>

              <button className="control" onClick={openFile} aria-label={t('Открыть файл')}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M1.5 4.5h5l1.5 2h6.5v7h-13z" strokeLinejoin="round" />
                </svg>
              </button>

              <button
                className="control"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? t('Выйти из полного экрана') : t('Полный экран')}
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

      {palette && (
        <Palette
          commands={commands}
          recent={recent}
          onOpenFile={(path) => void window.keyframe.playlist.open([path])}
          onClose={() => setPalette(false)}
        />
      )}

      {shortcuts && <Shortcuts commands={commands} onClose={() => setShortcuts(false)} />}

      {editing && (
        <Editor
          source={editing.source}
          duration={editing.duration}
          startAt={editing.startAt}
          hasAudio={player.tracks.some((track) => track.type === 'audio')}
          onClose={(leftAt) => {
            // Делим на длительность исходника, известную с момента входа:
            // player.duration сейчас ещё монтажная, от неё доля была бы чужой
            setLeftEditorRatio(editing.duration > 0 ? leftAt / editing.duration : null)
            setEditing(null)
          }}
          onNotice={(text) => showNotice({ kind: 'info', text })}
        />
      )}

      {!hasFile && (
        <div className="empty">
          <img className="empty__logo" src={logoUrl} alt="" />
          <div>
            <div className="empty__title">{t('Перетащите файл сюда')}</div>
            <div className="empty__hint">
              {t('или')} <kbd>Ctrl</kbd> + <kbd>O</kbd>{t(', чтобы открыть')}
            </div>
          </div>
          <button className="empty__button" onClick={openFile}>
            {t('Открыть файл')}
          </button>
        </div>
      )}
    </div>
    </LangContext.Provider>
  )
}

/**
 * Сведения о файле.
 *
 * Это то, что осталось от отладочной панели, но по запросу: разрешение и
 * декодер нужны ровно в тот момент, когда что-то тормозит, — а не поверх
 * каждого фильма постоянно.
 */
function FileInfo({ player, onClose }: { player: PlayerState; onClose: () => void }): JSX.Element {
  const t = useT()
  const audio = player.tracks.filter((track) => track.type === 'audio')
  const subs = player.tracks.filter((track) => track.type === 'sub')
  const activeAudio = audio.find((track) => track.id === player.aid)
  const hwOk = player.hwdec !== null && player.hwdec !== 'no'
  const drag = useDragPanel('info')

  return (
    <div
      className="info"
      ref={drag.ref}
      style={drag.style}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="info__head" {...drag.handleProps}>
        <span className="info__name" title={player.path ?? undefined}>
          {player.filename ?? t('Ничего не открыто')}
        </span>
        <button className="notice__close" onClick={onClose} aria-label={t('Закрыть')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <Row label={t('Длительность')} value={formatTime(player.duration)} />
      <Row
        label={t('Разрешение')}
        value={player.videoWidth ? `${player.videoWidth}×${player.videoHeight}` : '—'}
      />
      <Row label={t('Частота кадров')} value={player.fps ? `${player.fps.toFixed(1)} к/с` : '—'} />
      <Row label={t('Декодер')} value={player.hwdec ?? '—'} tone={hwOk ? 'ok' : 'warn'} />
      <Row
        label={t('Пропущено кадров')}
        value={String(player.frameDrops)}
        tone={player.frameDrops > 0 ? 'warn' : 'ok'}
      />
      <Row
        label={t('Звук')}
        value={activeAudio ? trackLabel(activeAudio, audio.indexOf(activeAudio)) : '—'}
      />
      <Row label={t('Дорожек субтитров')} value={String(subs.length)} />
    </div>
  )
}

function Row({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}): JSX.Element {
  return (
    <div className="info__row">
      <span>{label}</span>
      <span className={`info__value tnum${tone ? ` info__value--${tone}` : ''}`}>{value}</span>
    </div>
  )
}

/**
 * Сообщение об ошибке или о завершённом действии.
 *
 * В отличие от подсказки по центру, это сообщение ждёт: ошибку нужно прочитать,
 * а иногда и ответить на неё кнопкой. Само гаснет только то, что не про ошибку.
 */
function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="notice" data-kind={notice.kind} key={notice.id}>
      <span className="notice__text">{notice.text}</span>
      {notice.action && (
        <button
          className="notice__button"
          onClick={() => {
            notice.action!.run()
            onClose()
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button className="notice__close" onClick={onClose} aria-label={t('Закрыть')}>
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
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
  const t = useT()
  const api = window.keyframe.update

  if (status.state === 'idle' || status.state === 'checking' || status.state === 'error') return null

  return (
    <div className="update">
      {status.state === 'available' && (
        <>
          <span className="update__text">
            {t('Доступна версия')} <b>{status.version}</b>
          </span>
          <button className="update__button" onClick={() => void api.download()}>
            {t('Обновить')}
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
            {t('Версия')} <b>{status.version}</b> {t('готова')}
          </span>
          <button className="update__button" onClick={() => void api.install()}>
            {t('Перезапустить')}
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
