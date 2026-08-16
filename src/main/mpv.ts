import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'

/**
 * Свойства mpv, за которыми мы следим постоянно. Каждое получает числовой id,
 * mpv шлёт property-change с этим id при любом изменении.
 */
const OBSERVED = [
  'pause',
  'time-pos',
  'duration',
  'volume',
  'mute',
  'filename',
  'path',
  'eof-reached',
  'seeking',
  'core-idle',
  'demuxer-cache-duration',
  'video-params/w',
  'video-params/h',
  'hwdec-current',
  'frame-drop-count',
  'estimated-vf-fps',
  'speed',
  // Дорожки приходят одним массивом; выбранные читаем отдельно, потому что
  // track-list не переприсылается при простой смене sid/aid
  'track-list',
  'sid',
  'aid',
  'sub-visibility',
  'sub-delay',
  'audio-delay',
  'loop-file',
  'loop-playlist',
  'video-aspect-override',
  'playlist',
  'playlist-pos',
  'playlist-count'
] as const

export type MpvProperty = (typeof OBSERVED)[number]

export type MpvState = Partial<Record<MpvProperty, unknown>>

interface PendingCommand {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
}

/**
 * Обёртка над mpv.exe, запущенным отдельным процессом.
 *
 * Видео рисуется в дочернее окно, созданное mpv внутри переданного HWND.
 * Управление идёт через именованный канал в формате JSON IPC: одна команда —
 * одна строка JSON. Ответы сопоставляются с командами по request_id.
 *
 * Процесс намеренно отдельный: сегфолт в декодере убивает mpv, но не приложение.
 */
export class Mpv extends EventEmitter {
  private proc: ChildProcess | null = null
  private socket: net.Socket | null = null
  private readonly pipePath: string
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingCommand>()
  private buffer = ''
  private readonly propertyById = new Map<number, MpvProperty>()

  /** Последнее известное состояние — чтобы UI мог отрисоваться сразу при подключении. */
  readonly state: MpvState = {}

  /**
   * hwnd — окно, в которое рисовать. null означает экземпляр без вывода:
   * такой нужен для превью кадров, где картинка забирается прямо у декодера
   * и никуда не показывается.
   */
  constructor(
    private readonly mpvExePath: string,
    private readonly hwnd: string | null
  ) {
    super()
    this.pipePath = `\\\\.\\pipe\\keyframe-mpv-${process.pid}-${randomBytes(4).toString('hex')}`
  }

  async start(): Promise<void> {
    const args = this.hwnd === null ? this.headlessArgs() : this.playerArgs()

    this.proc = spawn(this.mpvExePath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) this.emit('log', text)
    })

    this.proc.on('exit', (code, signal) => {
      this.socket?.destroy()
      this.socket = null
      this.proc = null
      // Отклоняем всё, что не успело получить ответ
      for (const [, p] of this.pending) p.reject(new Error('mpv завершился'))
      this.pending.clear()
      this.emit('exit', { code, signal })
    })

    this.proc.on('error', (err) => this.emit('error', err))

    await this.connect()
    if (this.hwnd !== null) await this.observeAll()
  }

  private playerArgs(): string[] {
    return [
      `--wid=${this.hwnd}`,
      `--input-ipc-server=${this.pipePath}`,

      // Окно живёт всегда, даже без файла — иначе при старте нечего показывать
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=yes',

      // Весь интерфейс рисуем сами: убираем встроенный OSC, OSD и обработку ввода
      '--no-osc',
      '--osd-level=0',
      '--no-input-default-bindings',
      '--input-vo-keyboard=no',
      '--input-cursor=no',

      // Системная плашка Windows: заголовок, кнопки и медиа-клавиши.
      // Её рисует сама Windows по данным mpv — своей реализации не нужно
      '--media-controls=yes',

      // Вывод и аппаратное декодирование
      '--vo=gpu-next',
      '--gpu-api=d3d11',
      '--hwdec=auto-safe',

      // Без своего терминала; логи забираем через stderr
      '--terminal=no',
      '--msg-level=all=warn'
    ]
  }

  /**
   * Экземпляр для превью кадров.
   *
   * Ни окна, ни звука, ни аппаратного декодера: декодировать нужно по одному
   * кадру, а место на видеокарте пусть остаётся тому mpv, который показывает
   * фильм. Кадр уменьшается фильтром до отрисовки, чтобы не гонять через диск
   * полноразмерные JPEG.
   */
  private headlessArgs(): string[] {
    return [
      `--input-ipc-server=${this.pipePath}`,
      '--idle=yes',
      '--keep-open=yes',
      '--pause=yes',
      '--vo=null',
      '--ao=null',
      '--no-audio',
      '--no-sub',
      '--hwdec=no',
      '--vf=scale=224:-2',
      '--screenshot-format=jpg',
      '--screenshot-jpeg-quality=75',
      // Точный поиск здесь не нужен: превью показывает, что примерно в этом
      // месте, а поиск по ключевым кадрам на порядок быстрее
      '--hr-seek=no',
      '--terminal=no',
      '--msg-level=all=error'
    ]
  }

  /**
   * mpv создаёт именованный канал не мгновенно — ждём его появления,
   * а не падаем на первой же неудачной попытке.
   */
  private async connect(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      try {
        this.socket = await new Promise<net.Socket>((resolve, reject) => {
          const sock = net.createConnection(this.pipePath)
          sock.once('connect', () => resolve(sock))
          sock.once('error', reject)
        })
        break
      } catch (err) {
        if (Date.now() > deadline) {
          throw new Error(`Не удалось подключиться к mpv за ${timeoutMs} мс: ${String(err)}`)
        }
        await new Promise((r) => setTimeout(r, 50))
      }
    }

    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => this.onData(chunk))
    this.socket.on('error', (err) => this.emit('error', err))
  }

  /** mpv шлёт по одному JSON-объекту на строку; между чтениями строка может порваться. */
  private onData(chunk: string): void {
    this.buffer += chunk
    let newlineAt: number
    while ((newlineAt = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineAt).trim()
      this.buffer = this.buffer.slice(newlineAt + 1)
      if (!line) continue

      try {
        this.onMessage(JSON.parse(line))
      } catch {
        this.emit('log', `Нераспознанный ответ mpv: ${line}`)
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    const requestId = msg.request_id as number | undefined
    if (typeof requestId === 'number') {
      const pending = this.pending.get(requestId)
      if (pending) {
        this.pending.delete(requestId)
        if (msg.error === 'success') pending.resolve(msg.data)
        else pending.reject(new Error(String(msg.error)))
      }
      return
    }

    if (msg.event === 'property-change') {
      const name = this.propertyById.get(msg.id as number)
      if (name) {
        this.state[name] = msg.data
        this.emit('property', name, msg.data)
      }
      return
    }

    if (typeof msg.event === 'string') this.emit('mpv-event', msg.event, msg)
  }

  private async observeAll(): Promise<void> {
    await Promise.all(
      OBSERVED.map((name, index) => {
        const id = index + 1
        this.propertyById.set(id, name)
        return this.command('observe_property', id, name)
      })
    )
  }

  command(...args: unknown[]): Promise<unknown> {
    if (!this.socket) return Promise.reject(new Error('mpv не запущен'))

    const requestId = this.nextRequestId++
    const payload = JSON.stringify({ command: args, request_id: requestId }) + '\n'

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      this.socket!.write(payload, (err) => {
        if (err) {
          this.pending.delete(requestId)
          reject(err)
        }
      })
    })
  }

  setProperty(name: string, value: unknown): Promise<unknown> {
    return this.command('set_property', name, value)
  }

  loadFile(path: string): Promise<unknown> {
    return this.command('loadfile', path, 'replace')
  }

  getProperty(name: string): Promise<unknown> {
    return this.command('get_property', name)
  }

  get isRunning(): boolean {
    return this.proc !== null
  }

  stop(): void {
    this.socket?.destroy()
    this.socket = null
    this.proc?.kill()
    this.proc = null
  }
}
