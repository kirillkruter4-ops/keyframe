import { spawn } from 'node:child_process'
import { parentPort, workerData } from 'node:worker_threads'

/**
 * Запуск mpv в отдельном потоке.
 *
 * spawn на Windows синхронный, и на mpv.exe размером в сто с лишним мегабайт
 * он занимает около восьмисот миллисекунд. Выполненный в главном потоке, он
 * останавливал весь процесс: окно уже показано, а интерфейс в нём не
 * появлялся, потому что файлы для него отдаёт тот же самый заблокированный
 * процесс. В отдельном потоке ожидание никому не мешает.
 *
 * Поток остаётся жив, пока жив дочерний процесс: он пересылает его вывод и
 * сообщает о завершении.
 */
const { exe, args } = workerData as { exe: string; args: string[] }

const proc = spawn(exe, args, {
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'pipe']
})

// pid нужен главному потоку: убивать процесс он будет сам, напрямую. Через
// сообщение сюда это делать нельзя — при закрытии приложения оно может не
// успеть дойти, и mpv остался бы жить без окна
parentPort?.postMessage({ type: 'spawned', pid: proc.pid })

proc.stderr?.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim()
  if (text) parentPort?.postMessage({ type: 'log', text })
})

proc.on('error', (err) => parentPort?.postMessage({ type: 'error', message: String(err) }))

proc.on('exit', (code, signal) => {
  parentPort?.postMessage({ type: 'exit', code, signal })
  parentPort?.close()
})
