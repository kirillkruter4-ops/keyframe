import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mpv } from './mpv'

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

function mpvExecutablePath(): string {
  return isDev
    ? path.join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe')
    : path.join(process.resourcesPath, 'mpv', 'mpv.exe')
}

/**
 * Что открыть при запуске: файл из «Открыть с помощью» или переменная
 * окружения для отладки.
 *
 * Проверка на обычный файл здесь обязательна. Без неё в режиме разработки
 * сюда попадал путь до папки проекта из argv, mpv раскрывал её в плейлист и
 * начинал перебирать содержимое node_modules файл за файлом.
 */
function fileToOpenAtStartup(): string | null {
  const candidates = [process.env.KEYFRAME_OPEN, ...process.argv.slice(1)]

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

function createWindows(): void {
  hostWindow = new BrowserWindow({
    width: 1280,
    height: 720,
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
  hostWindow.on('restore', syncOverlayBounds)
  hostWindow.on('maximize', syncOverlayBounds)
  hostWindow.on('unmaximize', syncOverlayBounds)
  hostWindow.on('enter-full-screen', syncOverlayBounds)
  hostWindow.on('leave-full-screen', syncOverlayBounds)

  hostWindow.on('focus', raiseOverlay)
  hostWindow.on('show', raiseOverlay)
  hostWindow.on('restore', raiseOverlay)
  // Свёрнутое окно не должно оставлять на экране висящий прозрачный оверлей
  hostWindow.on('minimize', () => overlayWindow?.hide())

  hostWindow.on('closed', () => {
    mpv?.stop()
    mpv = null
    hostWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
    overlayWindow = null
  })

  hostWindow.once('ready-to-show', async () => {
    hostWindow!.show()
    raiseOverlay()
    await startMpv()
  })
}

async function startMpv(): Promise<void> {
  if (!hostWindow) return

  mpv = new Mpv(mpvExecutablePath(), nativeHandleOf(hostWindow))

  mpv.on('property', (name: string, value: unknown) => {
    overlayWindow?.webContents.send('mpv:property', name, value)
  })
  mpv.on('log', (line: string) => {
    if (isDev) console.log('[mpv]', line)
    overlayWindow?.webContents.send('mpv:log', line)
  })
  mpv.on('exit', (info: unknown) => {
    overlayWindow?.webContents.send('mpv:exit', info)
  })

  try {
    await mpv.start()
    overlayWindow?.webContents.send('mpv:ready')

    const autoOpen = fileToOpenAtStartup()
    if (autoOpen) await mpv.loadFile(autoOpen)
  } catch (err) {
    dialog.showErrorBox('Keyframe', `Не удалось запустить движок воспроизведения:\n${String(err)}`)
  }
}

// ---------- IPC ----------

ipcMain.handle('mpv:command', (_e, args: unknown[]) => mpv?.command(...args))
ipcMain.handle('mpv:set', (_e, name: string, value: unknown) => mpv?.setProperty(name, value))
ipcMain.handle('mpv:state', () => mpv?.state ?? {})

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
  await mpv?.loadFile(filePaths[0])
  return filePaths[0]
})

ipcMain.handle('window:toggleFullscreen', () => {
  if (!hostWindow) return false
  const next = !hostWindow.isFullScreen()
  hostWindow.setFullScreen(next)
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
  if (hostWindow.isMaximized()) hostWindow.unmaximize()
  else hostWindow.maximize()
})

// ---------- Жизненный цикл ----------

app.whenReady().then(() => {
  app.on('web-contents-created', (_e, contents) => {
    // Внешние ссылки — в системный браузер, никогда внутрь приложения
    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  createWindows()
})

app.on('window-all-closed', () => {
  mpv?.stop()
  app.quit()
})
