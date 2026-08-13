import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

let status: UpdateStatus = { state: 'idle' }
let target: BrowserWindow | null = null

function publish(next: UpdateStatus): void {
  status = next
  if (target && !target.isDestroyed()) target.webContents.send('update:status', next)
}

/**
 * Автообновление через electron-updater.
 *
 * Скачивание не начинается само: пользователь смотрит фильм, и незапрошенная
 * загрузка 200 МБ в фоне — плохая идея. Мы только сообщаем о новой версии,
 * а качаем по явному согласию.
 *
 * Установка происходит при выходе, а не сразу: прерывать просмотр ради
 * перезапуска недопустимо.
 */
export function setupUpdater(window: BrowserWindow): void {
  target = window

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Проверка обновлений против локального сервера вместо GitHub. Нужна, чтобы
  // прогонять весь цикл, ничего не публикуя. В обычном запуске переменной нет
  // и канал остаётся тем, что зашит при сборке.
  if (process.env.KEYFRAME_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.KEYFRAME_UPDATE_URL })
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => publish({ state: 'available', version: info.version }))

  autoUpdater.on('update-not-available', () => publish({ state: 'idle' }))

  autoUpdater.on('download-progress', (progress) => {
    const version = status.state === 'downloading' || status.state === 'available' ? status.version : ''
    publish({ state: 'downloading', version, percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => publish({ state: 'ready', version: info.version }))

  autoUpdater.on('error', (error) => {
    publish({ state: 'error', message: error.message })
  })

  ipcMain.handle('update:status', () => status)

  ipcMain.handle('update:check', async () => {
    // В разработке проверять нечего: версия берётся из package.json и всегда свежее
    if (!app.isPackaged && !process.env.KEYFRAME_TEST_UPDATES) return status
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      publish({ state: 'error', message: String(error) })
    }
    return status
  })

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      publish({ state: 'error', message: String(error) })
    }
  })

  ipcMain.handle('update:install', () => {
    // Второй аргумент — не тихая установка: пользователь должен видеть, что происходит
    autoUpdater.quitAndInstall(false, true)
  })

  // Первая проверка не сразу при старте: приложение должно сначала открыть файл,
  // а не тратить первые секунды на сеть
  setTimeout(() => {
    if (app.isPackaged || process.env.KEYFRAME_TEST_UPDATES) void autoUpdater.checkForUpdates()
  }, 8_000)
}
