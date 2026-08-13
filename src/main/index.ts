import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
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

/** HWND лежит в буфере как 64-битное целое (x64 Windows). */
function nativeHandleOf(win: BrowserWindow): string {
  return win.getNativeWindowHandle().readBigUInt64LE(0).toString()
}

function syncOverlayBounds(): void {
  if (!hostWindow || !overlayWindow || overlayWindow.isDestroyed()) return
  const bounds = hostWindow.getContentBounds()
  overlayWindow.setBounds(bounds)
}

function createWindows(): void {
  hostWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#0A0A0B',
    title: 'Keyframe',
    show: false
  })

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

  // По умолчанию оверлей полностью прозрачен для мыши — клики уходят в видео.
  // Renderer включает перехват только когда курсор над интерактивным элементом.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true })

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

  hostWindow.on('closed', () => {
    mpv?.stop()
    mpv = null
    hostWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy()
    overlayWindow = null
  })

  // Фокус всегда должен быть на host: иначе клавиатура уходит в невидимый оверлей
  overlayWindow.on('focus', () => hostWindow?.focus())

  hostWindow.once('ready-to-show', async () => {
    hostWindow!.show()
    syncOverlayBounds()
    overlayWindow!.show()
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

    // Путь или URL, открываемый сразу при запуске. Нужен для отладки и тестов,
    // чтобы не проходить каждый раз через диалог открытия файла.
    const autoOpen = process.env.KEYFRAME_OPEN ?? process.argv.slice(1).find((a) => !a.startsWith('-'))
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

ipcMain.handle('window:setIgnoreMouse', (_e, ignore: boolean) => {
  overlayWindow?.setIgnoreMouseEvents(ignore, { forward: true })
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
