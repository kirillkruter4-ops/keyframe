import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { Mpv } from './mpv'

/**
 * Сколько превью держим в памяти. Каждое — уменьшенный JPEG на несколько
 * килобайт, так что двести штук стоят единицы мегабайт и покрывают фильм
 * целиком при шаге в десять секунд.
 */
const CACHE_LIMIT = 300

/** Через столько бездействия второй mpv закрывается: держать его всё кино незачем. */
const IDLE_TIMEOUT = 45_000

/**
 * Превью кадра под курсором на таймлайне.
 *
 * Кадр берёт отдельный mpv без вывода: просить кадры у того экземпляра, что
 * показывает фильм, нельзя — каждый переход сбивал бы воспроизведение.
 *
 * Запросы обслуживаются по одному. Пока кадр готовится, новые запросы не
 * встают в очередь, а отбрасываются: курсор к моменту готовности всё равно
 * будет в другом месте, и очередь просто отставала бы от него всё сильнее.
 */
export class Thumbnailer {
  private mpv: Mpv | null = null
  private starting: Promise<void> | null = null
  private file: string | null = null
  private busy = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  private readonly cache = new Map<number, string>()
  private readonly dir = path.join(os.tmpdir(), 'keyframe-thumbs')

  constructor(private readonly mpvExePath: string) {}

  /**
   * Шаг сетки, к которой прижимаются запросы.
   *
   * Без него каждое движение мыши на пиксель просило бы новый кадр. Шаг тем
   * крупнее, чем длиннее фильм, но в разумных пределах: на трёхчасовом кино
   * секундная точность превью всё равно не читается глазом.
   */
  static bucketSize(duration: number): number {
    if (!Number.isFinite(duration) || duration <= 0) return 5
    return Math.min(10, Math.max(2, Math.round(duration / 300)))
  }

  async get(file: string, seconds: number, duration: number): Promise<string | null> {
    if (!file || duration <= 0) return null

    const step = Thumbnailer.bucketSize(duration)
    const bucket = Math.min(Math.max(0, Math.round(seconds / step) * step), Math.floor(duration))

    if (this.file !== file) {
      // Другой файл — прошлые кадры больше ни о чём не говорят
      this.cache.clear()
      this.file = file
      if (this.mpv) await this.mpv.loadFile(file).catch(() => undefined)
    }

    const ready = this.cache.get(bucket)
    if (ready) return ready

    if (this.busy) return null
    this.busy = true

    try {
      await this.ensureRunning(file)
      const frame = await this.grab(bucket)
      if (frame) this.remember(bucket, frame)
      return frame
    } catch {
      // Кадр — не то, ради чего стоит показывать ошибку: подсказка просто
      // останется без картинки
      return null
    } finally {
      this.busy = false
      this.scheduleIdleStop()
    }
  }

  private async ensureRunning(file: string): Promise<void> {
    if (this.mpv?.isRunning) return

    // Запуск может совпасть с несколькими запросами подряд — второй должен
    // дождаться первого, а не поднять ещё один процесс
    if (!this.starting) {
      this.starting = (async () => {
        const mpv = new Mpv(this.mpvExePath, null)
        await mpv.start()
        await mpv.loadFile(file)
        this.mpv = mpv
        this.file = file
      })().finally(() => {
        this.starting = null
      })
    }

    await this.starting
  }

  private async grab(seconds: number): Promise<string | null> {
    const mpv = this.mpv
    if (!mpv) return null

    fs.mkdirSync(this.dir, { recursive: true })
    const target = path.join(this.dir, `${randomBytes(6).toString('hex')}.jpg`)

    await mpv.command('seek', seconds, 'absolute+keyframes')
    // Флаг video: кадр берётся у декодера, без вывода и субтитров —
    // единственный режим, который вообще работает при --vo=null
    await mpv.command('screenshot-to-file', target, 'video')

    try {
      const data = fs.readFileSync(target)
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } finally {
      fs.rm(target, { force: true }, () => undefined)
    }
  }

  private remember(bucket: number, frame: string): void {
    this.cache.set(bucket, frame)
    if (this.cache.size <= CACHE_LIMIT) return

    // Map перебирает ключи в порядке вставки — первым уходит самый старый
    const oldest = this.cache.keys().next().value
    if (oldest !== undefined) this.cache.delete(oldest)
  }

  private scheduleIdleStop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), IDLE_TIMEOUT)
  }

  /** Кадры остаются в памяти: мышь вернётся на таймлайн, а процесс поднимется заново. */
  stop(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    this.mpv?.stop()
    this.mpv = null
  }

  dispose(): void {
    this.stop()
    this.cache.clear()
    fs.rm(this.dir, { recursive: true, force: true }, () => undefined)
  }
}
