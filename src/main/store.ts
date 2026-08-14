import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

interface ResumeEntry {
  /** Секунда, на которой остановились */
  position: number
  /** Длительность файла: путь может указывать уже на другое видео */
  duration: number
  /** Время записи, по нему вытесняются старые записи */
  at: number
}

interface Data {
  volume: number
  muted: boolean
  window: WindowBounds | null
  resume: Record<string, ResumeEntry>
}

const DEFAULTS: Data = { volume: 100, muted: false, window: null, resume: {} }

/** Больше — только лишний вес файла: столько фильмов подряд никто не бросает. */
const RESUME_LIMIT = 200

/**
 * Досматривать с середины имеет смысл только достаточно длинное видео.
 * Для трёхминутного клипа возврат на середину — помеха, а не удобство.
 */
const RESUME_MIN_DURATION = 180
/** У самого начала возвращать некуда, у конца — уже досмотрено. */
const RESUME_MIN_POSITION = 30
const RESUME_TAIL = 45

/**
 * Настройки и позиции просмотра в одном файле в userData.
 *
 * Запись отложенная: позиция обновляется каждые несколько секунд всё время,
 * пока идёт фильм, и синхронно писать на диск на каждое обновление незачем.
 * Поэтому есть flush() — его зовут перед выходом, чтобы последние секунды
 * не потерялись.
 */
export class Store {
  private readonly file = path.join(app.getPath('userData'), 'state.json')
  private data: Data
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.data = this.read()
  }

  private read(): Data {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Data>
      return {
        volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULTS.volume,
        muted: Boolean(parsed.muted),
        window: parsed.window ?? null,
        resume: parsed.resume ?? {}
      }
    } catch {
      // Файла нет или он испорчен — начинаем с чистого состояния,
      // это не повод мешать запуску
      return { ...DEFAULTS, resume: {} }
    }
  }

  private schedule(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, 1000)
  }

  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[store] не удалось сохранить состояние:', err)
    }
  }

  get volume(): number {
    return this.data.volume
  }

  get muted(): boolean {
    return this.data.muted
  }

  setAudio(volume: number, muted: boolean): void {
    if (this.data.volume === volume && this.data.muted === muted) return
    this.data.volume = volume
    this.data.muted = muted
    this.schedule()
  }

  get window(): WindowBounds | null {
    return this.data.window
  }

  setWindow(bounds: WindowBounds): void {
    this.data.window = bounds
    this.schedule()
  }

  /** Ключ по пути: одно и то же видео на диске — одна запись. */
  private static key(file: string): string {
    return file.toLowerCase()
  }

  rememberPosition(file: string, position: number, duration: number): void {
    if (duration < RESUME_MIN_DURATION) return

    const key = Store.key(file)

    // Досмотренное до конца больше не нужно возобновлять
    if (position > duration - RESUME_TAIL) {
      if (this.data.resume[key]) {
        delete this.data.resume[key]
        this.schedule()
      }
      return
    }

    // У самого начала запоминать нечего. Именно return, а не удаление записи:
    // сразу после loadfile позиция равна нулю, и удаление стёрло бы то самое
    // место, к которому мы в этот момент собираемся вернуться
    if (position < RESUME_MIN_POSITION) return

    this.data.resume[key] = { position, duration, at: Date.now() }
    this.prune()
    this.schedule()
  }

  forgetPosition(file: string): void {
    const key = Store.key(file)
    if (!this.data.resume[key]) return
    delete this.data.resume[key]
    this.schedule()
  }

  /**
   * Позиция, с которой стоит продолжить. Длительность сверяем: по тому же пути
   * может лежать уже другой файл, и прыжок на 40-ю минуту двухминутного ролика
   * выглядел бы поломкой.
   */
  positionFor(file: string, duration: number): number | null {
    const entry = this.data.resume[Store.key(file)]
    if (!entry) return null
    if (Math.abs(entry.duration - duration) > 1) return null
    if (entry.position > duration - RESUME_TAIL) return null
    return entry.position
  }

  private prune(): void {
    const keys = Object.keys(this.data.resume)
    if (keys.length <= RESUME_LIMIT) return

    keys
      .sort((a, b) => this.data.resume[a].at - this.data.resume[b].at)
      .slice(0, keys.length - RESUME_LIMIT)
      .forEach((key) => delete this.data.resume[key])
  }
}
