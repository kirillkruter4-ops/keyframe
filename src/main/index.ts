import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
  screen,
  nativeImage,
  powerSaveBlocker
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mpv } from './mpv'
import { setupUpdater } from './updater'
import { Store, DEFAULT_SETTINGS, type Settings } from './store'
import { appendPaths, isMediaFile, isPlaylistFile, openPath } from './playlist'
import { Thumbnailer } from './thumbnailer'
import { setupEditor } from './editor'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

/**
 * Без этого дочернее окно mpv не видно.
 *
 * По умолчанию Chromium выводит содержимое окна через DirectComposition —
 * поверхность DWM, которая рисуется поверх всех дочерних окон HWND независимо
 * от их z-порядка. Дочернее окно mpv при этом полностью закрыто.
 *
 * С выключенным DirectComposition Chromium рисует в обычное дочернее окно,
 * и обычные правила z-порядка снова работают.
 */
app.commandLine.appendSwitch('disable-direct-composition')

/**
 * Идентификатор приложения для Windows: по нему группируются окна в панели
 * задач и подписываются уведомления.
 *
 * На системную плашку проигрывателя он не влияет: её регистрирует mpv из
 * своего процесса, а идентификатор процессу не наследуется — в плашке
 * останется имя mpv. Исправить это можно только своей реализацией плашки
 * через нативный модуль, и ради подписи это того не стоит.
 */
app.setAppUserModelId('io.keyframe.player')

/**
 * Архитектура окон.
 *
 * hostWindow  — обычное окно. Внутрь его HWND mpv создаёт своё дочернее окно и
 *               рисует туда видео напрямую через D3D11. HTML этого окна не виден:
 *               дочернее окно mpv всегда поверх отрисовки родителя.
 * overlayWindow — прозрачное безрамочное окно, приклеенное к host по координатам.
 *               Здесь живёт весь React-интерфейс. Это единственный способ показать
 *               HTML поверх нативного видеослоя.
 */
let hostWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let mpv: Mpv | null = null
let store: Store | null = null

/**
 * Вторая копия приложения не нужна: у неё будет свой mpv, свой GPU-контекст и
 * своё окно, а пользователь всего лишь открыл ещё один файл через ассоциацию.
 * Файл из аргументов второй копии загружаем в уже запущенную.
 *
 * Замок берётся до whenReady: проигравшая копия должна закрыться, не успев
 * создать окно.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function resourcePath(...segments: string[]): string {
  return isDev
    ? path.join(app.getAppPath(), 'resources', ...segments)
    : path.join(process.resourcesPath, ...segments)
}

function mpvExecutablePath(): string {
  return resourcePath('mpv', 'mpv.exe')
}

/**
 * Что открыть при запуске: файл из «Открыть с помощью» или переменная
 * окружения для отладки.
 *
 * Проверка на обычный файл здесь обязательна. Без неё в режиме разработки
 * сюда попадал путь до папки проекта из argv, mpv раскрывал её в плейлист и
 * начинал перебирать содержимое node_modules файл за файлом.
 */
function fileToOpen(argv: string[]): string | null {
  const candidates = [process.env.KEYFRAME_OPEN, ...argv.slice(1)]

  for (const candidate of candidates) {
    if (!candidate || candidate.startsWith('-')) continue

    // Сетевые потоки существуют не на диске — их пропускаем через проверку
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return candidate

    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // не путь или недоступен — не наш случай
    }
  }

  return null
}

/** HWND лежит в буфере как 64-битное целое (x64 Windows). */
function nativeHandleOf(win: BrowserWindow): string {
  return win.getNativeWindowHandle().readBigUInt64LE(0).toString()
}

function syncOverlayBounds(): void {
  if (!hostWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = hostWindow.getContentBounds()
  overlayWindow.setBounds(bounds)
}

/**
 * Единственный источник правды о состоянии окна для интерфейса.
 *
 * Читаем его у самого окна, а не запоминаем при переключении: развернуть или
 * выйти из полного экрана можно и мимо наших кнопок — через Aero Snap,
 * двойной клик или системные сочетания.
 */
function emitWindowState(): void {
  if (!hostWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  syncOverlayBounds()
  overlayWindow.webContents.send('window:state', {
    fullscreen: hostWindow.isFullScreen(),
    maximized: hostWindow.isMaximized(),
    alwaysOnTop: hostWindow.isAlwaysOnTop()
  })
}

/**
 * Windows сообщает о смене состояния окна раньше, чем окно её совершает:
 * внутри обработчика enter-full-screen окно ещё не полноэкранное, а внутри
 * leave-full-screen — ещё полноэкранное. Прочитанное там значение уходило бы в
 * интерфейс перевёрнутым, и кнопка показывала бы выход из режима, в котором
 * окно уже не находится. Поэтому читаем состояние следующим тиком, когда
 * переход завершён.
 */
function deferWindowState(): void {
  setImmediate(emitWindowState)
}

/**
 * Держит оверлей над host.
 *
 * Одной привязки parent недостаточно: при активации host через панель задач
 * или Alt+Tab он на мгновение оказывается выше своего же оверлея, и интерфейс
 * пропадает до следующей перерисовки. Поэтому на каждом показе и получении
 * фокуса поднимаем оверлей принудительно.
 *
 * showInactive, а не show: иначе фокус уйдёт на оверлей, а клавиатуру должен
 * получать host.
 */
function raiseOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  syncOverlayBounds()
  if (!overlayWindow.isVisible()) overlayWindow.showInactive()
  overlayWindow.moveTop()
}

/**
 * Сохранённая геометрия, если она всё ещё попадает на существующий экран.
 *
 * Монитор могли отключить: окно, восстановленное на координатах отсутствующего
 * второго экрана, откроется за пределами видимой области, и найти его можно
 * будет только через клавиатуру.
 */
function restoredBounds(): { x: number; y: number; width: number; height: number } | null {
  const saved = store?.window
  if (!saved) return null

  const fits = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      saved.x < area.x + area.width &&
      saved.x + saved.width > area.x &&
      saved.y < area.y + area.height &&
      saved.y + saved.height > area.y
    )
  })

  return fits ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : null
}

function rememberBounds(): void {
  if (!hostWindow || hostWindow.isFullScreen()) return

  // В развёрнутом состоянии getBounds отдаёт размер во весь экран; запоминаем
  // тот, что был до разворачивания, иначе окно уже никогда не станет обычным
  const bounds = hostWindow.isMaximized() ? hostWindow.getNormalBounds() : hostWindow.getBounds()
  store?.setWindow({ ...bounds, maximized: hostWindow.isMaximized() })
}

function createWindows(): void {
  const saved = restoredBounds()

  hostWindow = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 720,
    x: saved?.x,
    y: saved?.y,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#0A0A0B',
    title: 'Keyframe',
    // Рамку и заголовок рисуем сами в оверлее. thickFrame оставляем включённым,
    // иначе пропадут изменение размера за края, Aero Snap и анимация сворачивания.
    frame: false,
    show: false
  })

  // Меню Alt-клавишей безрамочному окну не нужно
  Menu.setApplicationMenu(null)

  // Host не показывает ничего своего — весь его клиентский прямоугольник займёт mpv.
  // Если этот фон когда-нибудь станет виден, значит дочернее окно mpv перекрыто.
  //
  // Загрузку не ждём. Раньше окно показывалось по ready-to-show, и полсекунды
  // старта уходило на ожидание того, как отдельный процесс отрисует пустой
  // прямоугольник цвета фона. Показывать его можно сразу: backgroundColor
  // окно красит само, а поверх всё равно ляжет дочернее окно mpv.
  hostWindow.loadURL('data:text/html,<body style="margin:0;background:%230A0A0B"></body>')

  overlayWindow = new BrowserWindow({
    parent: hostWindow,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Оверлей забирает мышь целиком и не пропускает её вниз.
  //
  // Сквозной режим (setIgnoreMouseEvents с forward) здесь не работает
  // принципиально: Electron возвращает перехваченные события только если под
  // курсором окно того же приложения, а у нас под оверлеем чужое нативное окно
  // mpv — сообщения уходят туда и не возвращаются. Пропускать их вниз и не
  // нужно: собственный ввод mpv выключен, в видеослое кликать некому.

  // Ошибки интерфейса иначе умирают молча: у оверлея нет видимой консоли
  overlayWindow.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  overlayWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] не загрузилось: ${desc} (${code}) ${url}`)
  })
  overlayWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] процесс упал:', details)
  })
  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[renderer] загружен')
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    overlayWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  hostWindow.on('resize', syncOverlayBounds)
  hostWindow.on('move', syncOverlayBounds)
  hostWindow.on('resize', rememberBounds)
  hostWindow.on('move', rememberBounds)
  hostWindow.on('maximize', rememberBounds)
  hostWindow.on('unmaximize', rememberBounds)
  hostWindow.on('restore', syncOverlayBounds)
  hostWindow.on('maximize', syncOverlayBounds)
  hostWindow.on('unmaximize', syncOverlayBounds)

  hostWindow.on('enter-full-screen', deferWindowState)
  hostWindow.on('leave-full-screen', deferWindowState)
  hostWindow.on('maximize', deferWindowState)
  hostWindow.on('unmaximize', deferWindowState)
  hostWindow.on('restore', deferWindowState)
  // Последнее слово за resize: он приходит уже после самого перехода,
  // когда окно наконец отвечает о себе правду
  hostWindow.on('resize', deferWindowState)

  hostWindow.on('focus', raiseOverlay)
  hostWindow.on('show', raiseOverlay)
  hostWindow.on('restore', raiseOverlay)
  // Свёрнутое окно не должно оставлять на экране висящий прозрачный оверлей
  hostWindow.on('minimize', () => overlayWindow?.hide())

  hostWindow.on('closed', () => {
    savePosition()
    store?.flush()
    releasePowerBlocker()
    thumbnailer?.dispose()
    thumbnailer = null
    mpv?.stop()
    mpv = null
    hostWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
    overlayWindow = null
  })

  setupUpdater(overlayWindow)

  /*
   * Порядок здесь — это и есть скорость запуска.
   *
   * Раньше окно показывалось по ready-to-show, то есть после того, как
   * отдельный процесс отрисует пустой прямоугольник цвета фона, а движок
   * запускался уже следом — полсекунды и почти секунда складывались одна с
   * другой. Теперь окно показывается сразу, а движок стартует параллельно:
   * HWND существует с момента создания окна, ждать отрисовки незачем.
   */
  if (store?.window?.maximized) hostWindow.maximize()
  hostWindow.show()
  raiseOverlay()
  updateThumbar()

  void startMpv()
}

// ---------- Питание, панель задач, медиа-клавиши ----------

let powerBlockerId: number | null = null

/**
 * Пока идёт воспроизведение, Windows не должна гасить экран и засыпать:
 * фильм смотрят, не трогая мышь, и через десять минут система решила бы,
 * что за компьютером никого нет.
 */
function updatePowerBlocker(playing: boolean): void {
  if (playing) {
    if (powerBlockerId === null) {
      powerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
    }
    return
  }
  releasePowerBlocker()
}

function releasePowerBlocker(): void {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId)
  }
  powerBlockerId = null
}

function thumbarIcon(name: string): Electron.NativeImage {
  return nativeImage.createFromPath(resourcePath('thumbar', `${name}.png`))
}

let thumbarPaused: boolean | null = null

/**
 * Кнопки на превью окна в панели задач: то же, что нижняя панель, но не
 * разворачивая окно.
 *
 * Перерисовываем только на смене паузы. core-idle дёргается при каждой
 * подгрузке буфера, и панель задач успевала бы моргать иконкой на ровном месте.
 */
function updateThumbar(): void {
  if (!hostWindow || hostWindow.isDestroyed()) return

  const paused = mpv?.state.pause !== false
  if (paused === thumbarPaused) return
  thumbarPaused = paused

  hostWindow.setThumbarButtons([
    {
      tooltip: 'Назад на 10 секунд',
      icon: thumbarIcon('back'),
      click: () => void mpv?.command('seek', -10, 'relative')
    },
    {
      tooltip: paused ? 'Играть' : 'Пауза',
      icon: thumbarIcon(paused ? 'play' : 'pause'),
      click: () => void mpv?.command('cycle', 'pause')
    },
    {
      tooltip: 'Вперёд на 10 секунд',
      icon: thumbarIcon('forward'),
      click: () => void mpv?.command('seek', 10, 'relative')
    }
  ])
}

let progressShown = -1

/** Полоска на иконке в панели задач повторяет таймлайн. */
function updateTaskbarProgress(): void {
  if (!hostWindow || hostWindow.isDestroyed()) return

  const duration = Number(mpv?.state.duration) || 0
  const position = Number(mpv?.state['time-pos']) || 0
  const value = duration > 0 ? Math.min(1, position / duration) : -1

  // Округляем до процента: чаще перерисовывать нечего, а вызов не бесплатный
  const rounded = value < 0 ? -1 : Math.round(value * 100) / 100
  const paused = mpv?.state.pause !== false
  if (rounded === progressShown) return
  progressShown = rounded

  hostWindow.setProgressBar(rounded, { mode: rounded < 0 ? 'none' : paused ? 'paused' : 'normal' })
}

/*
 * Медиа-клавиши мы не перехватываем.
 *
 * Их обрабатывает системная плашка, которую регистрирует mpv (--media-controls):
 * Windows сама решает, какому проигрывателю адресовать нажатие, и умеет это
 * лучше нас. Своя регистрация через globalShortcut перехватывала бы клавиши
 * раньше плашки — и отбирала бы их у браузера и Spotify всё время, пока
 * Keyframe открыт в фоне.
 */

// ---------- Позиция просмотра ----------

/** Путь файла, который сейчас играет: по нему запоминается позиция. */
let currentFile: string | null = null
let lastSavedAt = 0

/**
 * Пока открыт редактор, плеер показывает не файл, а склейку `edl://`.
 *
 * Позиция в ней — монтажная, к исходнику отношения не имеет, и запоминать её
 * как «место, где остановились» нельзя: вернувшись к фильму, зритель уехал бы
 * непонятно куда. Возврат к сохранённой позиции в редакторе тоже не нужен —
 * туда, куда надо, редактор попадает сам.
 */
let editorActive = false

/** Сколько ближайших загрузок не должны прыгать к сохранённой позиции. */
let skipResume = 0

function savePosition(): void {
  if (editorActive) return
  if (!currentFile || !mpv) return
  const position = Number(mpv.state['time-pos'])
  const duration = Number(mpv.state.duration)
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return
  store?.rememberPosition(currentFile, position, duration)
}

/**
 * Возврат к тому месту, где бросили.
 *
 * Прыжок делается сразу после загрузки, на паузе или нет — неважно: mpv к
 * этому моменту уже знает длительность, и переход не виден как рывок.
 */
async function resumeIfNeeded(): Promise<void> {
  if (editorActive) return
  if (skipResume > 0) {
    skipResume -= 1
    return
  }
  if (!mpv || !settings().resumePlayback) return

  // Путь обычно приходит наблюдателем раньше события загрузки, но полагаться
  // на порядок незачем: он есть и в состоянии
  if (!currentFile && typeof mpv.state.path === 'string') currentFile = mpv.state.path
  if (!currentFile) return

  const duration = Number(await mpv.getProperty('duration').catch(() => null))
  if (!Number.isFinite(duration) || duration <= 0) return

  const position = store?.positionFor(currentFile, duration) ?? null
  if (position === null) return

  await mpv.command('seek', position, 'absolute').catch(() => undefined)
  overlayWindow?.webContents.send('mpv:resumed', position)
}

/**
 * Всё, что известно до запуска движка, уходит ему флагами командной строки.
 *
 * Заодно это снимает старую ловушку с громкостью: mpv присылает своё значение
 * сразу после подписки, и раньше оно затирало сохранённое, пока мы не успевали
 * его выставить. Теперь присланное значение и есть сохранённое.
 */
function startupArgs(): string[] {
  const current = settings()
  return [
    `--volume=${store?.volume ?? 100}`,
    `--mute=${store?.muted ? 'yes' : 'no'}`,
    `--alang=${current.audioLanguage}`,
    `--slang=${current.subtitleLanguage}`,
    `--sub-font-size=${current.subtitleFontSize}`
  ]
}

/**
 * Отправка в оверлей, переживающая его смерть.
 *
 * Проверять одно только окно недостаточно: когда падает процесс интерфейса,
 * окно ещё живо, а его webContents уже нет.
 *
 * Свойства уходят все и сразу, без разрежения по времени. Разрежение здесь
 * пробовалось и было ошибкой: позиция воспроизведения приходит с частотой
 * кадров, и пятнадцать сообщений в секунду вместо ста двадцати — это ползунок,
 * который дёргается ступеньками. Держать частоту должен тот, кто рисует, а не
 * тот, кто отправляет.
 */
function sendProperty(name: string, value: unknown): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlayWindow.webContents.isDestroyed()) return
  overlayWindow.webContents.send('mpv:property', name, value)
}

async function startMpv(): Promise<void> {
  if (!hostWindow) return

  // Кэш панели задач относился к прошлому процессу mpv
  thumbarPaused = null
  progressShown = -1

  mpv = new Mpv(mpvExecutablePath(), nativeHandleOf(hostWindow), startupArgs())

  mpv.on('property', (name: string, value: unknown) => {
    sendProperty(name, value)

    switch (name) {
      case 'pause':
      case 'core-idle':
        updatePowerBlocker(mpv?.state.pause === false && mpv?.state['core-idle'] === false)
        updateThumbar()
        updateTaskbarProgress()
        // Пауза — самый вероятный момент закрыть окно силой, запоминаем сразу
        if (name === 'pause') savePosition()
        break

      case 'time-pos':
        updateTaskbarProgress()
        // Позицию пишем раз в несколько секунд: она меняется каждый кадр
        if (Date.now() - lastSavedAt > 5000) {
          lastSavedAt = Date.now()
          savePosition()
        }
        break

      case 'volume':
      case 'mute':
        store?.setAudio(Number(mpv?.state.volume ?? 100), Boolean(mpv?.state.mute))
        break

      case 'path':
        if (typeof value !== 'string') break
        currentFile = value
        // Склейка редактора — не файл, который открывали: в истории ей не место
        if (!value.startsWith('edl://')) store?.addRecent(value)
        break
    }
  })

  mpv.on('mpv-event', (name: string, data: Record<string, unknown>) => {
    overlayWindow?.webContents.send('mpv:event', name, data)

    if (name === 'file-loaded') void resumeIfNeeded()

    // Досмотренный до конца файл открывать с середины больше не нужно
    if (name === 'end-file' && data.reason === 'eof' && currentFile) {
      store?.forgetPosition(currentFile)
    }
  })

  mpv.on('log', (line: string) => {
    if (isDev) console.log('[mpv]', line)
    overlayWindow?.webContents.send('mpv:log', line)
  })
  mpv.on('exit', (info: unknown) => {
    releasePowerBlocker()
    overlayWindow?.webContents.send('mpv:exit', info)
  })


  try {
    await mpv.start()

    overlayWindow?.webContents.send('mpv:ready')

    const autoOpen = fileToOpen(process.argv)
    if (autoOpen) await openPath(mpv, autoOpen, settings().fillPlaylistFromFolder)


  } catch (err) {
    dialog.showErrorBox('Keyframe', `Не удалось запустить движок воспроизведения:\n${String(err)}`)
  }
}

// ---------- IPC ----------

ipcMain.handle('mpv:command', (_e, args: unknown[]) => mpv?.command(...args))
ipcMain.handle('mpv:set', (_e, name: string, value: unknown) => mpv?.setProperty(name, value))
ipcMain.handle('mpv:state', () => mpv?.state ?? {})

/**
 * Перезапуск движка после падения. Окно то же самое, поэтому mpv получает тот
 * же HWND и рисует туда, куда рисовал: пересоздавать окно не нужно.
 */
ipcMain.handle('mpv:restart', async () => {
  mpv?.stop()
  mpv = null
  currentFile = null
  await startMpv()
})

/**
 * Снимок кадра.
 *
 * Кладём в «Изображения/Keyframe» — в рабочую папку процесса, куда mpv пишет по
 * умолчанию, пользователь не заглянет никогда. Флаг subtitles берёт кадр с
 * субтитрами, но без нашего интерфейса: интерфейса mpv всё равно не видит.
 */
ipcMain.handle('mpv:screenshot', async () => {
  if (!mpv) return null

  const dir = settings().screenshotDir || path.join(app.getPath('pictures'), 'Keyframe')
  fs.mkdirSync(dir, { recursive: true })

  const source = typeof mpv.state.filename === 'string' ? mpv.state.filename : 'keyframe'
  const base = path.parse(source).name.slice(0, 60).replace(/[\\/:*?"<>|]/g, '_')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(dir, `${base} ${stamp}.png`)

  try {
    await mpv.command('screenshot-to-file', target, 'subtitles')
    return target
  } catch (err) {
    console.error('[screenshot]', err)
    return null
  }
})

ipcMain.handle('shell:showItem', (_e, target: string) => shell.showItemInFolder(target))

// ---------- Редактор ----------

ipcMain.handle('editor:active', (_e, active: boolean) => {
  editorActive = active
})

/**
 * Выход из редактора: вернуть исходный файл на ту секунду, где стоял плейхед.
 *
 * Загрузку делает главный процесс, а не интерфейс, потому что вместе с ней
 * надо погасить возврат к сохранённой позиции: она относится к этому же файлу,
 * и без этого фильм прыгнул бы туда, где его бросили в прошлый раз, вместо
 * того места, откуда только что вышли из редактора.
 */
ipcMain.handle('editor:leave', async (_e, source: string, seconds: number) => {
  skipResume += 1
  editorActive = false
  await mpv?.command('loadfile', source, 'replace', -1, `start=${seconds}`).catch(() => undefined)
})

setupEditor({
  store: () => store,
  thumbnailer: () => {
    if (!thumbnailer) thumbnailer = new Thumbnailer(mpvExecutablePath())
    return thumbnailer
  },
  overlay: () => overlayWindow,
  bundledFfmpeg: resourcePath('mpv', 'ffmpeg.exe'),

  // stop, а не пауза: пока файл открыт на чтение, Windows не даст его
  // переименовать. Кадры для полосы держит второй mpv — его тоже отпускаем
  release: async () => {
    thumbnailer?.stop()
    await mpv?.command('stop').catch(() => undefined)
    // Файл закрывается не в тот же миг, когда команда принята
    await new Promise((resolve) => setTimeout(resolve, 250))
  },

  reopen: async (file: string) => {
    skipResume += 1
    currentFile = file
    await mpv?.loadFile(file).catch(() => undefined)
  }
})

// ---------- Превью кадра на таймлайне ----------

let thumbnailer: Thumbnailer | null = null

/**
 * Кадр для подсказки под курсором.
 *
 * null здесь — нормальный ответ, а не ошибка: кадр может быть ещё не готов
 * или недоступен вовсе, и интерфейс просто покажет подсказку без картинки.
 */
ipcMain.handle('thumbnail:at', async (_e, seconds: number) => {
  if (!currentFile || !mpv) return null

  // У сетевого потока перемотка стоит запроса к серверу — превью того не стоит
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(currentFile)) return null

  const duration = Number(mpv.state.duration)
  if (!Number.isFinite(duration) || duration <= 0) return null

  if (!thumbnailer) thumbnailer = new Thumbnailer(mpvExecutablePath())
  return thumbnailer.get(currentFile, seconds, duration)
})

// ---------- Настройки ----------

function settings(): Settings {
  return store?.settings ?? DEFAULT_SETTINGS
}

/**
 * Настройки, которые живут в самом mpv. Применяются и при запуске движка, и
 * сразу после изменения: ждать перезапуска ради размера субтитров незачем.
 *
 * Язык дорожек действует со следующего файла — у текущего дорожки выбраны
 * ещё при загрузке, и менять их за спиной у зрителя мы не станем.
 */
async function applySettingsToMpv(next: Settings): Promise<void> {
  if (!mpv) return
  await mpv.setProperty('alang', next.audioLanguage).catch(() => undefined)
  await mpv.setProperty('slang', next.subtitleLanguage).catch(() => undefined)
  await mpv.setProperty('sub-font-size', next.subtitleFontSize).catch(() => undefined)
}

ipcMain.handle('settings:get', () => settings())

ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
  const next = store?.updateSettings(patch) ?? DEFAULT_SETTINGS
  await applySettingsToMpv(next)
  overlayWindow?.webContents.send('settings:changed', next)
  return next
})

/** Папка снимков: пользователь мог выбрать свою. */
ipcMain.handle('settings:chooseScreenshotDir', async () => {
  if (!hostWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(hostWindow, {
    title: 'Куда сохранять снимки кадров',
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || filePaths.length === 0) return null

  const next = store?.updateSettings({ screenshotDir: filePaths[0] }) ?? DEFAULT_SETTINGS
  overlayWindow?.webContents.send('settings:changed', next)
  return filePaths[0]
})

/**
 * Назначить Keyframe плеером по умолчанию из приложения Windows 10 и 11 не
 * позволяют — это делает пользователь. Открываем ему нужную страницу
 * параметров, чтобы не искать её вручную.
 */
ipcMain.handle('settings:openDefaultApps', () => {
  void shell.openExternal('ms-settings:defaultapps')
})

ipcMain.handle('dialog:openFile', async () => {
  if (!hostWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(hostWindow, {
    title: 'Открыть медиафайл',
    properties: ['openFile'],
    filters: [
      { name: 'Медиафайлы', extensions: ['mkv', 'mp4', 'avi', 'mov', 'webm', 'flv', 'ts', 'm2ts', 'mp3', 'flac', 'aac', 'opus', 'wav', 'ogg'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  })
  if (canceled || filePaths.length === 0) return null
  if (mpv) await openPath(mpv, filePaths[0], settings().fillPlaylistFromFolder)
  return filePaths[0]
})

/**
 * Открыть перетащенное. Первый файл начинает играть, остальные встают в
 * очередь: бросив на плеер несколько файлов, ждут именно этого.
 */
ipcMain.handle('playlist:open', async (_e, targets: string[]) => {
  if (!mpv || targets.length === 0) return
  const playable = targets.filter((target) => isMediaFile(target) || isPlaylistFile(target))
  if (playable.length === 0) return

  await openPath(mpv, playable[0], playable.length === 1 && settings().fillPlaylistFromFolder)
  if (playable.length > 1) await appendPaths(mpv, playable.slice(1))
})

/**
 * История для палитры команд.
 *
 * Файлы, которых уже нет на диске, отсеиваются здесь, а не при записи: диск
 * между запусками меняется, и хранить в истории ссылку на удалённое — значит
 * предлагать открыть то, чего нет.
 */
ipcMain.handle('recent:list', () => {
  const files = store?.recent ?? []

  return files.filter((file) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file)) return true
    try {
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  })
})

ipcMain.handle('playlist:remove', (_e, index: number) => mpv?.command('playlist-remove', index))
ipcMain.handle('playlist:clear', () => mpv?.command('playlist-clear'))

ipcMain.handle('dialog:openSubtitle', async () => {
  if (!hostWindow) return null
  const { canceled, filePaths } = await dialog.showOpenDialog(hostWindow, {
    title: 'Выбрать файл субтитров',
    properties: ['openFile'],
    filters: [
      { name: 'Субтитры', extensions: ['srt', 'ass', 'ssa', 'sub', 'vtt', 'sup', 'idx'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  })
  if (canceled || filePaths.length === 0) return null
  // select, а не auto: файл выбрали руками, значит хотят видеть его прямо сейчас
  await mpv?.command('sub-add', filePaths[0], 'select')
  return filePaths[0]
})

ipcMain.handle('window:toggleFullscreen', () => {
  if (!hostWindow) return false
  const next = !hostWindow.isFullScreen()
  hostWindow.setFullScreen(next)
  return next
})

ipcMain.handle('app:version', () => app.getVersion())

ipcMain.handle('window:state', () => ({
  fullscreen: hostWindow?.isFullScreen() ?? false,
  maximized: hostWindow?.isMaximized() ?? false,
  alwaysOnTop: hostWindow?.isAlwaysOnTop() ?? false
}))

/**
 * Поверх всех окон. Флаг ставится только на host: оверлей — его дочернее окно
 * и поднимается вместе с ним, а собственный alwaysOnTop сделал бы интерфейс
 * видимым даже поверх чужих окон, закрывших видео.
 */
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  if (!hostWindow) return false
  const next = !hostWindow.isAlwaysOnTop()
  hostWindow.setAlwaysOnTop(next)
  raiseOverlay()
  emitWindowState()
  return next
})

ipcMain.handle('window:minimize', () => hostWindow?.minimize())
ipcMain.handle('window:close', () => hostWindow?.close())

// Перетаскивание безрамочного окна: курсор находится над оверлеем,
// а двигать нужно host, поэтому считаем дельту от точки начала жеста.
let dragOrigin: { mouseX: number; mouseY: number; winX: number; winY: number } | null = null

ipcMain.handle('window:dragStart', (_e, mouseX: number, mouseY: number) => {
  if (!hostWindow || hostWindow.isFullScreen()) return
  const [winX, winY] = hostWindow.getPosition()
  dragOrigin = { mouseX, mouseY, winX, winY }
})

ipcMain.handle('window:dragMove', (_e, mouseX: number, mouseY: number) => {
  if (!hostWindow || !dragOrigin) return
  if (hostWindow.isMaximized()) hostWindow.unmaximize()
  hostWindow.setPosition(
    dragOrigin.winX + (mouseX - dragOrigin.mouseX),
    dragOrigin.winY + (mouseY - dragOrigin.mouseY)
  )
})

ipcMain.handle('window:dragEnd', () => {
  dragOrigin = null
})

ipcMain.handle('window:toggleMaximize', () => {
  if (!hostWindow) return

  // Из полного экрана эта кнопка просто возвращает окно: разворачивать
  // что-то поверх полного экрана бессмысленно, а Windows при этом не шлёт
  // leave-full-screen — интерфейс оставался бы с иконкой выхода навсегда.
  if (hostWindow.isFullScreen()) {
    hostWindow.setFullScreen(false)
    return
  }

  if (hostWindow.isMaximized()) hostWindow.unmaximize()
  else hostWindow.maximize()
})

// ---------- Жизненный цикл ----------

/**
 * Файл, открытый второй копией, играет уже запущенная. Окно при этом надо
 * поднять и развернуть из свёрнутого: пользователь щёлкнул по файлу и ждёт,
 * что плеер окажется перед ним.
 */
app.on('second-instance', (_e, argv) => {
  if (!hostWindow) return

  if (hostWindow.isMinimized()) hostWindow.restore()
  hostWindow.focus()
  raiseOverlay()

  const file = fileToOpen(argv)
  if (file && mpv) void openPath(mpv, file, settings().fillPlaylistFromFolder)
})

app.whenReady().then(() => {
  store = new Store()

  app.on('web-contents-created', (_e, contents) => {
    // Внешние ссылки — в системный браузер, никогда внутрь приложения
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  createWindows()
})

app.on('will-quit', () => {
  releasePowerBlocker()
  thumbnailer?.dispose()
  savePosition()
  store?.flush()
})

app.on('window-all-closed', () => {
  mpv?.stop()
  app.quit()
})
