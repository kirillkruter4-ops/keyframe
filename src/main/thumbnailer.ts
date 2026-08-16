import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { Mpv } from './mpv'

/**
 * Сколько превью держим в памяти. Каждое — уменьшенный JPEG на несколько
 * килобайт, так что и восемьсот штук стоят единицы мегабайт.
 *
 * Столько нужно полосе кадров в редакторе: она просит кадр на плитку, и на
 * разных уровнях зума плитки приходятся на разные секунды. Вытесняться должно
 * то, к чему давно не возвращались, а не половина видимой полосы.
 */
const CACHE_LIMIT = 800

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

  /**
   * Очередь: один mpv, одна перемотка за раз.
   *
   * Полоса кадров в редакторе просит по кадру на плитку, и параллельные
   * запросы к одному экземпляру перебивали бы друг другу перемотку — снимок
   * приходил бы не из того места, которое просили.
   */
  private queue: Promise<unknown> = Promise.resolve()

  private readonly cache = new Map<string, string>()
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

  /** Ключ кэша: файл и секунда до миллисекунды. */
  private static key(file: string, seconds: number): string {
    return `${file.toLowerCase()}|${Math.round(seconds * 1000)}`
  }

  /**
   * Кадр для подсказки под курсором на таймлайне.
   *
   * Пока кадр готовится, новые запросы не встают в очередь, а отбрасываются:
   * курсор к моменту готовности всё равно будет в другом месте, и очередь
   * просто отставала бы от него всё сильнее.
   */
  async get(file: string, seconds: number, duration: number): Promise<string | null> {
    if (!file || duration <= 0) return null

    const step = Thumbnailer.bucketSize(duration)
    const bucket = Math.min(Math.max(0, Math.round(seconds / step) * step), Math.floor(duration))

    const ready = this.cache.get(Thumbnailer.key(file, bucket))
    if (ready) return ready

    if (this.busy) return null
    this.busy = true

    try {
      return await this.frame(file, bucket)
    } finally {
      this.busy = false
    }
  }

  /**
   * Кадр из точно указанной секунды — для полосы кадров в редакторе.
   *
   * В отличие от подсказки, запрос не отбрасывается: плитки полосы никуда не
   * денутся и дождутся своей очереди.
   */
  frame(file: string, seconds: number): Promise<string | null> {
    const key = Thumbnailer.key(file, seconds)
    const ready = this.cache.get(key)
    if (ready) return Promise.resolve(ready)

    return this.enqueue(async () => {
      // Пока запрос стоял в очереди, кадр мог приехать по соседнему запросу
      const meanwhile = this.cache.get(key)
      if (meanwhile) return meanwhile

      await this.use(file)
      const frame = await this.grab(seconds)
      if (frame) this.remember(key, frame)
      return frame
    })
  }

  /**
   * Ближайший ключевой кадр не позже указанной секунды.
   *
   * Ровно туда уедет граница при быстром экспорте: он копирует потоки как есть
   * и резать между ключевыми кадрами не умеет. Спрашиваем mpv, а не ffmpeg, —
   * ffmpeg может быть ещё не скачан, а показать честную границу нужно раньше,
   * чем пользователь дойдёт до экспорта.
   */
  keyframeAt(file: string, seconds: number): Promise<number | null> {
    return this.enqueue(async () => {
      await this.use(file)
      const mpv = this.mpv
      if (!mpv) return null

      await mpv.command('seek', seconds, 'absolute+keyframes')
      const position = await mpv.getProperty('time-pos')
      if (typeof position !== 'number') return null

      /*
       * Проверка на несуразицу. Ключевые кадры бывают редкими, но не настолько:
       * промежуток больше тридцати секунд означает, что перемотка не доехала и
       * нам ответили прошлой позицией. Показать такое пользователю хуже, чем
       * не показать ничего: он поверит, что экспорт заберёт лишние полминуты.
       */
      if (position > seconds + 0.5 || position < seconds - 30) return null
      return position
    })
  }

  /**
   * Поставить работу в общую очередь.
   *
   * Ошибки гасятся здесь же: кадр — не то, ради чего стоит показывать
   * сообщение, подсказка просто останется без картинки. Но упавший запрос не
   * должен обрывать очередь тем, кто стоит за ним.
   */
  private enqueue<T>(task: () => Promise<T | null>): Promise<T | null> {
    const attempt = async (): Promise<T | null> => {
      try {
        return await task()
      } catch {
        return null
      } finally {
        this.scheduleIdleStop()
      }
    }

    const next = this.queue.then(attempt, attempt)
    this.queue = next
    return next
  }

  /** Переключение на другой файл: прошлые кадры к нему отношения не имеют. */
  private async use(file: string): Promise<void> {
    if (this.file !== file) {
      this.cache.clear()
      this.file = file
      if (this.mpv?.isRunning) {
        await this.mpv.loadFile(file).catch(() => undefined)
        await Thumbnailer.awaitLoad(this.mpv)
      }
    }
    await this.ensureRunning(file)
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
        await Thumbnailer.awaitLoad(mpv)
        this.mpv = mpv
        this.file = file
      })().finally(() => {
        this.starting = null
      })
    }

    await this.starting
  }

  /**
   * Дождаться, пока файл действительно откроется.
   *
   * `loadfile` отвечает «принято», а не «готово»: команда возвращается сразу,
   * а демультиплексор к этому моменту ещё ничего не знает. Перемотка, посланная
   * в этот промежуток, отвергается с «error running command» — и раньше это
   * было незаметно, потому что подсказка под курсором просто оставалась без
   * картинки и спрашивала снова. Полоса кадров спрашивает всё сразу, и в этот
   * промежуток попадали все её запросы разом: дорожка оставалась пустой.
   */
  private static awaitLoad(mpv: Mpv, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer)
        mpv.off('mpv-event', onEvent)
        resolve()
      }

      const onEvent = (name: string): void => {
        if (name === 'file-loaded') finish()
      }

      // Ждать вечно нельзя: битый файл события загрузки не пришлёт никогда,
      // а очередь кадров за ним встанет намертво
      const timer = setTimeout(finish, timeoutMs)
      mpv.on('mpv-event', onEvent)
    })
  }

  private async grab(seconds: number): Promise<string | null> {
    const mpv = this.mpv
    if (!mpv) return null

    fs.mkdirSync(this.dir, { recursive: true })
    const target = path.join(this.dir, `${randomBytes(6).toString('hex')}.jpg`)

    await mpv.command('seek', seconds, 'absolute+keyframes')

    // Флаг video: кадр берётся у декодера, без вывода и субтитров —
    // единственный режим, который вообще работает при --vo=null
    try {
      await mpv.command('screenshot-to-file', target, 'video')
    } catch {
      // Событие загрузки приходит раньше, чем декодер выдаёт первый кадр, и
      // самый первый снимок после открытия файла отвергается. Второй попытки
      // хватает: дальше кадр всегда есть
      await new Promise((resolve) => setTimeout(resolve, 150))
      await mpv.command('screenshot-to-file', target, 'video')
    }

    try {
      const data = fs.readFileSync(target)
      return `data:image/jpeg;base64,${data.toString('base64')}`
    } finally {
      fs.rm(target, { force: true }, () => undefined)
    }
  }

  private remember(key: string, frame: string): void {
    this.cache.set(key, frame)
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
