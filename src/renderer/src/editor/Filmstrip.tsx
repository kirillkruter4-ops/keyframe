import { useEffect, useRef, type JSX } from 'react'

/**
 * Полоса кадров внутри куска.
 *
 * Кадры не проходят через состояние React вовсе: их сотни, они приезжают по
 * одному в течение секунд, и перерисовывать дерево на каждый приехавший кадр —
 * ровно то, от чего в этом проекте уже уходили. Готовый кадр записывается
 * прямо в стиль своей плитки.
 *
 * Просим только то, что видно: на часовом фильме при мелком зуме плиток
 * несколько тысяч, а видно из них два десятка.
 */

/** Кадры переживают перерисовки, смену зума и выход из редактора. */
const cache = new Map<string, string>()

/** Ключ по секунде: одна и та же секунда на разных зумах — один и тот же кадр. */
function key(source: string, seconds: number): string {
  return `${source}|${Math.round(seconds * 1000)}`
}

export function cachedFrame(source: string, seconds: number): string | undefined {
  return cache.get(key(source, seconds))
}

interface Wanted {
  source: string
  seconds: number
  element: HTMLElement
}

const queue: Wanted[] = []
let working = false

/**
 * Очередь запросов.
 *
 * По одному за раз: кадры готовит отдельный экземпляр mpv, и десяток
 * параллельных запросов только выстроился бы в очередь там же, но уже без
 * возможности передумать. Передумать важно: пользователь прокручивает дорожку
 * быстрее, чем приезжают кадры, и запрос на уехавшую с экрана плитку надо
 * просто выбросить.
 */
async function pump(): Promise<void> {
  if (working) return
  working = true

  try {
    while (queue.length > 0) {
      // С конца: последними встали те плитки, которые пользователь видит сейчас
      const next = queue.pop()
      if (!next) break

      // Плитку удалили из дерева или увезли за край — она больше не нужна
      if (!next.element.isConnected || next.element.dataset.visible !== 'yes') continue

      const id = key(next.source, next.seconds)
      if (cache.has(id)) {
        next.element.style.backgroundImage = `url(${cache.get(id)})`
        continue
      }

      const frame = await window.keyframe.editor.thumb(next.source, next.seconds)
      if (!frame) continue

      cache.set(id, frame)
      if (cache.size > 1200) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }

      if (next.element.isConnected) next.element.style.backgroundImage = `url(${frame})`
    }
  } finally {
    working = false
  }
}

function request(item: Wanted): void {
  queue.push(item)
  void pump()
}

export interface FilmstripProps {
  source: string
  /** Границы куска в секундах исходника */
  from: number
  to: number
  /** Шаг сетки кадров в секундах — общий для всей дорожки */
  step: number
  pxPerSec: number
  /** Прокручиваемый контейнер: по нему определяется, что видно */
  root: React.RefObject<HTMLElement | null>
}

export function Filmstrip({ source, from, to, step, pxPerSec, root }: FilmstripProps): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)

  /*
   * Наблюдатель на плитки этого куска. Пересоздаётся при смене зума и границ:
   * плитки при этом другие, а старые наблюдения указывали бы на удалённые узлы.
   */
  useEffect(() => {
    const element = host.current
    const container = root.current
    if (!element || !container) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const tile = entry.target as HTMLElement
          tile.dataset.visible = entry.isIntersecting ? 'yes' : 'no'

          if (!entry.isIntersecting || tile.style.backgroundImage) continue
          request({ source, seconds: Number(tile.dataset.t), element: tile })
        }
      },
      {
        root: container,
        // Кадры для соседних экранов: прокрутка чаще всего продолжается
        rootMargin: '400px 0px'
      }
    )

    for (const tile of element.children) observer.observe(tile)
    return () => observer.disconnect()
  }, [source, from, to, step, pxPerSec, root])

  const tiles: number[] = []
  // Сетка общая для всей дорожки, а не своя у каждого куска: тогда один и тот
  // же кадр переиспользуется соседними кусками и разными уровнями зума
  const first = Math.floor(from / step) * step
  for (let time = first; time < to; time += step) tiles.push(time)

  const width = step * pxPerSec

  return (
    <div className="estrip" ref={host}>
      {tiles.map((time) => {
        const ready = cachedFrame(source, time)
        return (
          <div
            key={time}
            className="estrip__tile"
            data-t={time}
            style={{
              left: `${(time - from) * pxPerSec}px`,
              width: `${width}px`,
              ...(ready ? { backgroundImage: `url(${ready})` } : {})
            }}
          />
        )
      })}
    </div>
  )
}

/**
 * Шаг сетки кадров под текущий зум.
 *
 * Плитка должна быть не уже примерно семидесяти пикселей — иначе в ней ничего
 * не разобрать, а кадров придётся просить втрое больше. Шаги ступенчатые и
 * кратные друг другу: при смене зума часть кадров попадает в те же секунды и
 * берётся из кэша, а не запрашивается заново.
 */
const STEPS = [0.5, 1, 2, 5, 10, 20, 60, 120, 300, 600]

export function frameStep(pxPerSec: number): number {
  const wanted = 78 / pxPerSec
  return STEPS.find((step) => step >= wanted) ?? STEPS[STEPS.length - 1]
}
