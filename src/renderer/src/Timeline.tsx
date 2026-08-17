import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useMpvProperty } from './usePlayer'
import { formatTime } from './format'
import { useT } from './i18n'

/**
 * Куда мы сейчас попросили перемотать — до того, как mpv это подтвердит.
 *
 * Интерфейс не имеет права ждать движок. Между нажатием стрелки и первым
 * подтверждением от mpv лежит круг IPC плюс сам переход: на длинном фильме это
 * заметно, и раньше в этот промежуток цифра и полоса просто стояли. Теперь они
 * двигаются в момент нажатия, а пришедшее от mpv значение их только уточняет.
 *
 * Модульный список слушателей, а не контекст: подписчиков двое, оба пишут прямо
 * в DOM, и протаскивать это через дерево React значило бы перерисовывать окно
 * на каждую перемотку.
 */
const seekHints = new Set<(delta: number) => void>()

/** Сообщить, на сколько секунд мы только что попросили перемотать. */
export function hintSeek(delta: number): void {
  for (const hint of seekHints) hint(delta)
}

function useSeekHint(handler: (delta: number) => void): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    const listener = (delta: number): void => latest.current(delta)
    seekHints.add(listener)
    return () => {
      seekHints.delete(listener)
    }
  }, [])
}

/** Ширина превью кадра и боковой отступ панели — те же числа, что в styles.css. */
const PREVIEW_WIDTH = 170
const CHROME_PADDING = 16

/**
 * Где курсор окажется к моменту, когда кадр действительно окажется на экране.
 *
 * Аппаратный курсор рисует видеокарта поверх всего и без задержки, а
 * содержимое окна проходит через композитор — между «мы записали позицию» и
 * «пользователь это увидел» проходит кадр-другой. На медленном движении это
 * незаметно, на быстром подсказка тянется за курсором хвостом.
 *
 * Браузер ведёт собственное предсказание траектории именно для таких случаев.
 * Берём ближайшую предсказанную точку, а не самую дальнюю: она отстаёт меньше,
 * но и не улетает вперёд на остановках и разворотах, где предсказание всегда
 * ошибается.
 */
function predictedX(event: PointerEvent): number {
  const predicted = event.getPredictedEvents?.()
  return predicted && predicted.length > 0 ? predicted[0].clientX : event.clientX
}

/**
 * Дорожка воспроизведения с превью кадра под курсором.
 *
 * Всё, что движется, здесь пишется прямо в стиль элементов и не проходит ни
 * через состояние React, ни через requestAnimationFrame.
 *
 * Оба обхода обязательны, и оба были найдены измерением:
 *
 * Состояние — потому что положение ползунка меняется с частотой кадров видео,
 * а перерисовка всего дерева интерфейса ради двух чисел столько раз в секунду
 * невозможна. Разрежать поток вместо этого нельзя: пятнадцать обновлений в
 * секунду выглядят как ползунок, ползущий ступеньками.
 *
 * requestAnimationFrame — потому что Chromium и так выдаёт pointermove не чаще
 * одного раза на кадр. Собственное разрежение поверх этого ничего не экономит,
 * а откладывает обработку до следующего кадра: при ста двадцати кадрах в
 * секунду это лишние восемь миллисекунд отставания подсказки от курсора.
 */
export function Timeline({
  duration,
  expectedRatio
}: {
  duration: number
  /**
   * Доля дорожки, на которую плеер сейчас встанет, если она известна заранее.
   *
   * Именно доля, а не секунда: сразу после выхода из редактора mpv ещё
   * сообщает монтажную длительность, и секунду было бы не на что делить.
   */
  expectedRatio?: number | null
}): JSX.Element {
  const t = useT()
  const track = useRef<HTMLDivElement | null>(null)
  const fill = useRef<HTMLDivElement | null>(null)
  const thumb = useRef<HTMLDivElement | null>(null)
  const buffer = useRef<HTMLDivElement | null>(null)
  const preview = useRef<HTMLDivElement | null>(null)
  const previewTime = useRef<HTMLDivElement | null>(null)

  /** Кадр меняется редко и приходит асинхронно — вот он через состояние */
  const [frame, setFrame] = useState<string | null>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const dragging = useRef(false)
  const inFlight = useRef(false)
  const hovering = useRef(false)
  /** Последняя позиция от mpv: нужна буферу, который считается от неё */
  const position = useRef(0)

  const mpv = window.keyframe.mpv

  const ratioAt = (clientX: number): number => {
    const element = track.current
    if (!element) return 0
    const box = element.getBoundingClientRect()
    if (box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width))
  }

  /** Куда встали ползунок и бегунок. Единственное место, которое их двигает. */
  const drawProgress = useCallback((ratio: number): void => {
    const percent = `${Math.min(1, Math.max(0, ratio)) * 100}%`
    if (fill.current) fill.current.style.width = percent
    if (thumb.current) thumb.current.style.left = percent
  }, [])

  /**
   * Ждём подтверждения позиции после выхода из редактора.
   *
   * mpv в это время открывает исходный файл заново и присылает нулевую позицию
   * до того, как доедет до запрошенной секунды. Нарисованный по ней ноль — это
   * прыжок полосы в начало и возврат обратно, как только пойдёт
   * воспроизведение.
   */
  const awaiting = useRef(false)

  // Позиция воспроизведения: пока тащат, её задаёт палец, и приходящая от mpv
  // затирала бы положение под ним
  useMpvProperty('time-pos', (value) => {
    position.current = typeof value === 'number' ? value : 0
    if (dragging.current || duration <= 0) return

    // Ноль до окончания загрузки относится к прошлому файлу, а не к этому
    if (awaiting.current) {
      if (position.current < 0.001) return
      awaiting.current = false
    }

    drawProgress(position.current / duration)
  })

  /*
   * Перемотка стрелками: полоса уезжает в момент нажатия.
   *
   * Считаем от собственной последней позиции, а не ждём ответа: при зажатой
   * клавише нажатия идут чаще, чем mpv успевает подтверждать, и отсчёт от
   * присланного значения топтался бы на месте.
   */
  useSeekHint((delta) => {
    if (duration <= 0 || dragging.current) return

    position.current = Math.min(Math.max(position.current + delta, 0), duration)
    drawProgress(position.current / duration)
  })

  // Место известно заранее — рисуем сразу, не дожидаясь, пока mpv откроет файл
  useEffect(() => {
    if (expectedRatio === null || expectedRatio === undefined) return

    awaiting.current = true
    drawProgress(expectedRatio)
  }, [expectedRatio, drawProgress])

  useMpvProperty('demuxer-cache-duration', (value) => {
    if (!buffer.current || duration <= 0) return
    const cached = typeof value === 'number' ? value : 0
    const ratio = (position.current + cached) / duration
    buffer.current.style.width = `${Math.min(1, Math.max(0, ratio)) * 100}%`
  })

  /**
   * Подсказка следует за курсором — и во время протяжки тоже: оторвать её от
   * пальца значило бы перематывать вслепую как раз тогда, когда точность
   * нужна больше всего.
   */
  const drawPreview = (clientX: number): void => {
    const element = track.current
    const tip = preview.current
    if (!element || !tip || duration <= 0) return

    const box = element.getBoundingClientRect()
    if (box.width === 0) return

    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width))

    /*
     * Подсказка центрируется по курсору, поэтому у краёв дорожки её надо
     * придержать: половина ширины кадра плюс отступ панели — ровно то, что
     * ещё помещается в окно. Время при этом остаётся честным, смещается
     * только сама картинка.
     */
    const overhang = PREVIEW_WIDTH / 2 - CHROME_PADDING
    const x = Math.min(Math.max(ratio * box.width, overhang), box.width - overhang)

    // translate3d, а не left: смена left пересчитывает раскладку и заново
    // рисует подсказку вместе с её тенью, а сдвиг слоя — нет
    tip.style.transform = `translate3d(${x}px, 0, 0) translateX(-50%)`

    const seconds = ratio * duration
    if (previewTime.current) previewTime.current.textContent = formatTime(seconds)

    // Один запрос за раз: кадры готовит отдельный процесс, и очередь из
    // сотни запросов сделала бы каждый следующий бесполезным
    if (inFlight.current) return
    inFlight.current = true

    void mpv
      .thumbnail(seconds)
      .then((next) => {
        if (next && hovering.current) setFrame(next)
      })
      .finally(() => {
        inFlight.current = false
      })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || duration <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    setScrubbing(true)

    const ratio = ratioAt(event.clientX)
    drawProgress(ratio)
    void mpv.command('seek', ratio * duration, 'absolute+keyframes')
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    hovering.current = true

    // Предсказанная точка одна на всё: и ползунок, и подсказка. Раньше
    // подсказка брала предсказанную, а ползунок — сырую, и то, что человек
    // держит пальцем, отставало заметнее того, что рядом с ним
    const x = predictedX(event.nativeEvent)

    if (dragging.current) {
      const ratio = ratioAt(x)
      drawProgress(ratio)
      // Пока тащим — по ключевым кадрам: так картинка успевает за пальцем
      void mpv.command('seek', ratio * duration, 'absolute+keyframes')
    }

    drawPreview(x)
  }

  const release = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    setScrubbing(false)
    event.currentTarget.releasePointerCapture(event.pointerId)

    // Один точный переход на отпускании: по ключевым кадрам мы уже доехали
    const ratio = ratioAt(event.clientX)
    drawProgress(ratio)
    void mpv.command('seek', ratio * duration, 'absolute')
  }

  const onPointerEnter = (event: React.PointerEvent<HTMLDivElement>): void => {
    hovering.current = true
    drawPreview(event.clientX)
  }

  const onPointerLeave = (): void => {
    hovering.current = false
    setFrame(null)
  }

  // Новый файл — старый кадр к нему отношения не имеет
  useEffect(() => {
    setFrame(null)
  }, [duration])

  return (
    <div
      className="timeline"
      ref={track}
      data-scrubbing={scrubbing}
      data-ready={duration > 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      role="slider"
      aria-label={t('Позиция воспроизведения')}
      aria-valuemin={0}
      aria-valuemax={duration}
      tabIndex={0}
    >
      <div className="timeline__track">
        <div className="timeline__buffer" ref={buffer} />
        <div className="timeline__fill" ref={fill} />
        <div className="timeline__thumb" ref={thumb} />
      </div>

      {/*
        Подсказка есть в разметке всегда и прячется наведением через CSS.
        Создавать и удалять её на входе курсора значило бы каждый раз заново
        строить узлы и грузить картинку ровно в тот момент, когда всё должно
        двигаться плавно.
      */}
      <div className="preview" ref={preview}>
        <div className="preview__frame">
          {frame ? (
            <img src={frame} alt="" draggable={false} />
          ) : (
            <div className="preview__placeholder" />
          )}
        </div>
        <div className="preview__time tnum" ref={previewTime} />
      </div>
    </div>
  )
}

/**
 * Таймкод. Отдельным компонентом с прямой подпиской, потому что иначе он
 * перерисовывал бы вместе с собой всё окно на каждый кадр видео.
 */
export function Timecode({ duration }: { duration: number }): JSX.Element {
  const current = useRef<HTMLSpanElement | null>(null)
  const shown = useRef<string | null>(null)
  /** Последняя известная секунда: от неё считается перемотка до ответа mpv */
  const position = useRef(0)

  const paint = (seconds: number): void => {
    const text = formatTime(seconds)
    // Секунда меняется раз в секунду, а приходит время в сто раз чаще:
    // без этой проверки мы писали бы в DOM одно и то же
    if (text === shown.current || !current.current) return
    shown.current = text
    current.current.textContent = text
  }

  /**
   * Пока идёт переход, время не показываем.
   *
   * mpv доезжает до места в два приёма: сначала прыгает на ближайший ключевой
   * кадр перед целью, потом доводит декодированием до точной секунды. Обе
   * позиции он честно присылает, и на экране это выглядело как «5:46 → 5:50 →
   * 5:51» на один нажатый раз — цифра будто промахивалась мимо и доползала.
   *
   * Показываем только то, на чём переход закончился.
   */
  const seeking = useRef(false)

  useMpvProperty('seeking', (value) => {
    seeking.current = value === true
  })

  // Смена файла посреди перехода оставила бы флаг поднятым, и таймкод замер бы
  // навсегда: новое время приходит, а показывать его некому
  useEffect(() => {
    seeking.current = false
  }, [duration])

  useMpvProperty('time-pos', (value) => {
    const seconds = typeof value === 'number' ? value : 0
    position.current = seconds

    // Промежуточные позиции перехода не показываем: цифра уже стоит там, куда
    // мы попросили, и метаться между ключевым кадром и целью ей незачем
    if (seeking.current) return

    paint(seconds)
  })

  /*
   * Перемотка стрелками: цифра меняется в момент нажатия.
   *
   * Она же и останется — переход идёт точный (relative+exact), то есть mpv
   * приедет ровно туда, что мы показали, и поправлять потом будет нечего.
   */
  useSeekHint((delta) => {
    if (duration <= 0) return

    position.current = Math.min(Math.max(position.current + delta, 0), duration)
    paint(position.current)
  })

  return (
    <div className="timecode tnum">
      <span className="timecode__current" ref={current}>
        0:00
      </span>
      <span> / {formatTime(duration)}</span>
    </div>
  )
}
