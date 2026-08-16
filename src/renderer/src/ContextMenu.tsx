import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { PlayerState, Track } from './usePlayer'

/**
 * Название дорожки. Язык и заголовок есть далеко не всегда, поэтому у
 * безымянной дорожки остаётся хотя бы её номер — выбирать вслепую между двумя
 * пустыми строками невозможно.
 */
export function trackLabel(track: Track, index: number): string {
  const parts: string[] = []
  if (track.lang) parts.push(track.lang.toUpperCase())
  if (track.title) parts.push(track.title)
  if (parts.length === 0) parts.push(`Дорожка ${index + 1}`)
  if (track.external) parts.push('внешние')
  return parts.join(' · ')
}

/**
 * Быстрый доступ к дорожкам с нижней панели.
 *
 * Кнопка появляется только когда выбирать есть из чего: у файла с одной
 * звуковой дорожкой и без субтитров она была бы кнопкой, открывающей список
 * из одной строки.
 */
export function Tracks({
  tracks,
  sid,
  aid,
  subVisible,
  open,
  onToggle
}: {
  tracks: Track[]
  sid: number | false
  aid: number | false
  subVisible: boolean
  open: boolean
  onToggle: () => void
}): JSX.Element | null {
  const mpv = window.keyframe.mpv

  const audio = tracks.filter((track) => track.type === 'audio')
  const subs = tracks.filter((track) => track.type === 'sub')

  if (audio.length < 2 && subs.length === 0) return null

  return (
    <div className="tracks">
      {open && (
        <div className="tracks__panel" role="menu">
          {subs.length > 0 && (
            <>
              <div className="tracks__title">Субтитры</div>
              <button
                className="tracks__item"
                data-selected={sid === false || !subVisible}
                onClick={() => void mpv.set('sid', 'no')}
              >
                Выключены
              </button>
              {subs.map((track, index) => (
                <button
                  key={track.id}
                  className="tracks__item"
                  data-selected={sid === track.id && subVisible}
                  onClick={() => selectSubtitle(track.id, subVisible)}
                >
                  {trackLabel(track, index)}
                </button>
              ))}
            </>
          )}

          {audio.length > 0 && (
            <>
              <div className="tracks__title">Звук</div>
              {audio.map((track, index) => (
                <button
                  key={track.id}
                  className="tracks__item"
                  data-selected={aid === track.id}
                  onClick={() => void mpv.set('aid', track.id)}
                >
                  {trackLabel(track, index)}
                </button>
              ))}
            </>
          )}

          <button className="tracks__add" onClick={() => void window.keyframe.openSubtitle()}>
            Добавить субтитры из файла…
          </button>
        </div>
      )}

      <button
        className="control"
        onClick={onToggle}
        aria-label="Дорожки и субтитры"
        aria-expanded={open}
        title="Дорожки и субтитры"
        data-active={open}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.2" y="3.2" width="13.6" height="9.6" rx="2" />
          <path d="M4.4 9.6h2.4M9.2 9.6h2.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

/** Выбор дорожки при выключенных субтитрах не показал бы ничего. */
function selectSubtitle(id: number, subVisible: boolean): void {
  void window.keyframe.mpv.set('sid', id)
  if (!subVisible) void window.keyframe.mpv.set('sub-visibility', true)
}

/** Пропорции, ради которых вообще лезут в это меню: остальное встречается раз в год. */
const ASPECTS: Array<{ label: string; value: number }> = [
  { label: 'Как в файле', value: -1 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '1:1', value: 1 },
  { label: '2.35:1', value: 2.35 },
  { label: '2.39:1', value: 2.39 }
]

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3]

/** Шаг задержки. Меньше на слух не различить, больше — уже перелёт. */
const DELAY_STEP = 0.1

export interface MenuActions {
  togglePause: () => void
  seekBy: (delta: number) => void
  frameStep: (direction: number) => void
  setSpeed: (value: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  screenshot: () => void
  openFile: () => void
  showInfo: () => void
  showSettings: () => void
  showPlaylist: () => void
  openEditor: () => void
}

/**
 * Меню по правой кнопке.
 *
 * Всё, что плеер умеет, собрано здесь: клавиши помнят не все, а нижняя панель
 * вмещает только самое частое. Пункты, у которых есть сочетание клавиш,
 * показывают его — меню заодно учит этим сочетаниям.
 */
export function ContextMenu({
  player,
  position,
  alwaysOnTop,
  fullscreen,
  actions,
  onClose
}: {
  player: PlayerState
  position: { x: number; y: number }
  alwaysOnTop: boolean
  fullscreen: boolean
  actions: MenuActions
  onClose: () => void
}): JSX.Element {
  const mpv = window.keyframe.mpv
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{
    left: number
    top: number
    flip: boolean
    scroll: boolean
  } | null>(null)

  /*
   * Меню не должно вылезать за окно: у нижнего края оно раскрывается вверх, у
   * правого — влево. Размер известен только после отрисовки, поэтому до
   * измерения меню держим невидимым — иначе оно бы прыгнуло на глазах.
   */
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const { width, height } = element.getBoundingClientRect()
    const margin = 8

    const left =
      position.x + width > window.innerWidth - margin
        ? Math.max(margin, position.x - width)
        : position.x
    const top =
      position.y + height > window.innerHeight - margin
        ? Math.max(margin, position.y - height)
        : position.y

    setBox({
      left,
      top,
      // Подменю уходит влево, если справа от меню для него нет места
      flip: left + width * 2 > window.innerWidth,
      // В совсем низком окне меню целиком не помещается: тогда пусть
      // прокручивается, иначе нижние пункты недостижимы
      scroll: height > window.innerHeight - margin * 2
    })
  }, [position])

  const hasFile = player.filename !== null
  const audio = player.tracks.filter((track) => track.type === 'audio')
  const subs = player.tracks.filter((track) => track.type === 'sub')

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  return (
    <div
      className="menu"
      ref={ref}
      role="menu"
      style={{ left: box?.left ?? position.x, top: box?.top ?? position.y, opacity: box ? 1 : 0 }}
      data-flip={box?.flip ?? false}
      data-scroll={box?.scroll ?? false}
      // Меню не место для колеса громкости и для паузы по клику мимо пунктов
      onWheel={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {hasFile && (
        <>
          <Item
            label={player.paused ? 'Воспроизвести' : 'Пауза'}
            hint="Space"
            onClick={run(actions.togglePause)}
          />
          <Item label="Назад 10 секунд" hint="J" onClick={run(() => actions.seekBy(-10))} />
          <Item label="Вперёд 10 секунд" hint="L" onClick={run(() => actions.seekBy(10))} />
          <Separator />

          <Sub label="Субтитры" value={subs.length === 0 ? 'нет' : player.subVisible && player.sid !== false ? 'вкл' : 'выкл'}>
            <Item
              label="Выключены"
              checked={!player.subVisible || player.sid === false}
              onClick={run(() => void mpv.set('sid', 'no'))}
            />
            {subs.map((track, index) => (
              <Item
                key={track.id}
                label={trackLabel(track, index)}
                checked={player.sid === track.id && player.subVisible}
                onClick={run(() => selectSubtitle(track.id, player.subVisible))}
              />
            ))}
            <Separator />
            <Item
              label="Добавить из файла…"
              onClick={run(() => void window.keyframe.openSubtitle())}
            />
            <Separator />
            <Item
              label="Раньше на 0,1 с"
              hint="G"
              disabled={subs.length === 0}
              onClick={() => void mpv.set('sub-delay', round(player.subDelay - DELAY_STEP))}
            />
            <Item
              label="Позже на 0,1 с"
              hint="H"
              disabled={subs.length === 0}
              onClick={() => void mpv.set('sub-delay', round(player.subDelay + DELAY_STEP))}
            />
            <Item
              label={`Сбросить задержку (${formatDelay(player.subDelay)})`}
              disabled={player.subDelay === 0}
              onClick={run(() => void mpv.set('sub-delay', 0))}
            />
          </Sub>

          <Sub label="Звук" value={audio.length > 1 ? `${audio.length} дорожки` : undefined}>
            {audio.map((track, index) => (
              <Item
                key={track.id}
                label={trackLabel(track, index)}
                checked={player.aid === track.id}
                onClick={run(() => void mpv.set('aid', track.id))}
              />
            ))}
            {audio.length > 0 && <Separator />}
            <Item label="Без звука" hint="M" checked={player.muted} onClick={run(actions.toggleMute)} />
            <Separator />
            <Item
              label="Раньше на 0,1 с"
              onClick={() => void mpv.set('audio-delay', round(player.audioDelay - DELAY_STEP))}
            />
            <Item
              label="Позже на 0,1 с"
              onClick={() => void mpv.set('audio-delay', round(player.audioDelay + DELAY_STEP))}
            />
            <Item
              label={`Сбросить задержку (${formatDelay(player.audioDelay)})`}
              disabled={player.audioDelay === 0}
              onClick={run(() => void mpv.set('audio-delay', 0))}
            />
          </Sub>

          <Sub label="Видео">
            {ASPECTS.map((aspect) => (
              <Item
                key={aspect.label}
                label={aspect.label}
                checked={
                  aspect.value < 0 ? player.aspect <= 0 : Math.abs(player.aspect - aspect.value) < 0.01
                }
                onClick={run(() => void mpv.set('video-aspect-override', aspect.value))}
              />
            ))}
            <Separator />
            <Item label="Кадр назад" hint="," onClick={() => actions.frameStep(-1)} />
            <Item label="Кадр вперёд" hint="." onClick={() => actions.frameStep(1)} />
          </Sub>

          <Sub label="Скорость" value={`${player.speed}×`}>
            {SPEEDS.map((speed) => (
              <Item
                key={speed}
                label={speed === 1 ? 'Обычная' : `${speed}×`}
                checked={Math.abs(player.speed - speed) < 0.01}
                onClick={run(() => actions.setSpeed(speed))}
              />
            ))}
          </Sub>

          <Sub
            label="Список"
            value={player.playlist.length > 1 ? `${player.playlistPos + 1} из ${player.playlist.length}` : undefined}
          >
            <Item
              label="Следующий файл"
              hint="N"
              disabled={player.playlistPos >= player.playlist.length - 1}
              onClick={run(() => void mpv.command('playlist-next', 'weak'))}
            />
            <Item
              label="Предыдущий файл"
              hint="P"
              disabled={player.playlistPos <= 0}
              onClick={run(() => void mpv.command('playlist-prev', 'weak'))}
            />
            <Separator />
            <Item label="Показать список" onClick={run(actions.showPlaylist)} />
            <Item
              label="Повторять список"
              checked={player.loopPlaylist}
              onClick={run(() => void mpv.set('loop-playlist', player.loopPlaylist ? 'no' : 'inf'))}
            />
            <Item
              label="Очистить список"
              disabled={player.playlist.length < 2}
              onClick={run(() => void window.keyframe.playlist.clear())}
            />
          </Sub>

          <Separator />
          <Item
            label="Повторять файл"
            checked={player.loop}
            onClick={run(() => void mpv.set('loop-file', player.loop ? 'no' : 'inf'))}
          />
        </>
      )}

      <Item
        label="Поверх всех окон"
        checked={alwaysOnTop}
        onClick={run(() => void window.keyframe.window.toggleAlwaysOnTop())}
      />
      <Item label="Полный экран" hint="F" checked={fullscreen} onClick={run(actions.toggleFullscreen)} />

      {hasFile && (
        <>
          <Separator />
          <Item label="Нарезать видео…" hint="E" onClick={run(actions.openEditor)} />
          <Item label="Снимок кадра" hint="S" onClick={run(actions.screenshot)} />
          <Item
            label="Показать в проводнике"
            disabled={!player.path}
            onClick={run(() => {
              if (player.path) void window.keyframe.showItem(player.path)
            })}
          />
          <Item label="Сведения о файле" hint="I" onClick={run(actions.showInfo)} />
        </>
      )}

      <Separator />
      <Item label="Открыть файл…" hint="Ctrl+O" onClick={run(actions.openFile)} />
      <Item label="Настройки" onClick={run(actions.showSettings)} />
      <Item label="Выход" onClick={run(() => void window.keyframe.window.close())} />
    </div>
  )
}

/** Задержки копятся из шагов по 0,1 — без округления получаются хвосты вида 0,30000000000000004. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

function formatDelay(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} с`
}

function Item({
  label,
  hint,
  checked,
  disabled,
  onClick
}: {
  label: string
  hint?: string
  checked?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="menu__item"
      role="menuitem"
      disabled={disabled}
      data-checked={checked === true}
      onClick={onClick}
    >
      <span className="menu__label">{label}</span>
      {hint && <span className="menu__hint">{hint}</span>}
    </button>
  )
}

/**
 * Подменю раскрывается наведением, как в проводнике: щелчок по строке с
 * треугольником никуда не ведёт и только сбивал бы с толку.
 */
function Sub({
  label,
  value,
  children
}: {
  label: string
  value?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="menu__parent">
      <div className="menu__item" role="menuitem" aria-haspopup="true">
        <span className="menu__label">{label}</span>
        {value && <span className="menu__hint">{value}</span>}
        <svg className="menu__arrow" width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
          <path d="M2.5 0.5L6 4l-3.5 3.5z" />
        </svg>
      </div>
      <div className="menu__sub">{children}</div>
    </div>
  )
}

function Separator(): JSX.Element {
  return <div className="menu__sep" />
}
