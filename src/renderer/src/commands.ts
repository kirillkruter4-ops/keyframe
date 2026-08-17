import { useMemo } from 'react'
import type { PlayerState } from './usePlayer'
import { useT } from './i18n'

/**
 * Реестр команд — единственный список того, что приложение умеет.
 *
 * Из него растут и палитра по `Ctrl+K`, и шпаргалка по `F1`. Держать их
 * отдельными списками значило бы забывать дописывать в них новое: шпаргалка
 * первой начинает врать, а врущая шпаргалка хуже отсутствующей.
 */
export interface Command {
  id: string
  label: string
  /** Раздел шпаргалки и подпись в палитре */
  group: string
  /** Сочетание клавиш в том виде, в каком его показывают */
  keys?: string
  run: () => void
  /** Команда сейчас бессмысленна — в палитре её нет */
  hidden?: boolean
  /** Состояние переключателя: палитра ставит галочку */
  checked?: boolean
}

/** Всё, что палитра умеет запускать. Собирается в App, где эти действия живут. */
export interface CommandActions {
  togglePause: () => void
  seekBy: (delta: number) => void
  frameStep: (direction: number) => void
  changeSpeed: (direction: number) => void
  resetSpeed: () => void
  adjustVolume: (delta: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
  toggleAlwaysOnTop: () => void
  toggleSubtitles: () => void
  adjustSubDelay: (delta: number) => void
  screenshot: () => void
  openFile: () => void
  openSubtitle: () => void
  openEditor: () => void
  showInfo: () => void
  showSettings: () => void
  showPlaylist: () => void
  showShortcuts: () => void
  nextFile: () => void
  previousFile: () => void
  toggleLoop: () => void
  revealInExplorer: () => void
  checkUpdate: () => void
}

export function useCommands(
  player: PlayerState,
  window: { fullscreen: boolean; alwaysOnTop: boolean },
  actions: CommandActions
): Command[] {
  const t = useT()
  const hasFile = player.filename !== null
  const list = player.playlist.length > 1

  return useMemo(
    () => [
      {
        id: 'play',
        group: t('Воспроизведение'),
        label: player.paused ? t('Играть') : t('Пауза'),
        keys: 'Space',
        run: actions.togglePause,
        hidden: !hasFile
      },
      {
        id: 'forward',
        group: t('Воспроизведение'),
        label: t('Вперёд на 5 секунд'),
        keys: '→',
        run: () => actions.seekBy(5),
        hidden: !hasFile
      },
      {
        id: 'back',
        group: t('Воспроизведение'),
        label: t('Назад на 5 секунд'),
        keys: '←',
        run: () => actions.seekBy(-5),
        hidden: !hasFile
      },
      {
        id: 'forward-long',
        group: t('Воспроизведение'),
        label: t('Вперёд на 10 секунд'),
        keys: 'L',
        run: () => actions.seekBy(10),
        hidden: !hasFile
      },
      {
        id: 'back-long',
        group: t('Воспроизведение'),
        label: t('Назад на 10 секунд'),
        keys: 'J',
        run: () => actions.seekBy(-10),
        hidden: !hasFile
      },
      {
        id: 'frame-next',
        group: t('Воспроизведение'),
        label: t('Следующий кадр'),
        keys: '.',
        run: () => actions.frameStep(1),
        hidden: !hasFile
      },
      {
        id: 'frame-prev',
        group: t('Воспроизведение'),
        label: t('Предыдущий кадр'),
        keys: ',',
        run: () => actions.frameStep(-1),
        hidden: !hasFile
      },
      {
        id: 'speed-up',
        group: t('Воспроизведение'),
        label: t('Быстрее'),
        keys: ']',
        run: () => actions.changeSpeed(1),
        hidden: !hasFile
      },
      {
        id: 'speed-down',
        group: t('Воспроизведение'),
        label: t('Медленнее'),
        keys: '[',
        run: () => actions.changeSpeed(-1),
        hidden: !hasFile
      },
      {
        id: 'speed-reset',
        group: t('Воспроизведение'),
        label: t('Обычная скорость'),
        keys: 'Backspace',
        run: actions.resetSpeed,
        hidden: !hasFile || player.speed === 1
      },
      {
        id: 'loop',
        group: t('Воспроизведение'),
        label: t('Повторять файл'),
        run: actions.toggleLoop,
        checked: player.loop,
        hidden: !hasFile
      },

      {
        id: 'volume-up',
        group: t('Звук'),
        label: t('Громче'),
        keys: '↑',
        run: () => actions.adjustVolume(5),
        hidden: !hasFile
      },
      {
        id: 'volume-down',
        group: t('Звук'),
        label: t('Тише'),
        keys: '↓',
        run: () => actions.adjustVolume(-5),
        hidden: !hasFile
      },
      {
        id: 'mute',
        group: t('Звук'),
        label: t('Без звука'),
        keys: 'M',
        run: actions.toggleMute,
        checked: player.muted,
        hidden: !hasFile
      },

      {
        id: 'subtitles',
        group: t('Субтитры'),
        label: t('Показывать субтитры'),
        keys: 'V',
        run: actions.toggleSubtitles,
        checked: player.subVisible,
        hidden: !hasFile
      },
      {
        id: 'sub-earlier',
        group: t('Субтитры'),
        label: t('Субтитры раньше на 0,1 с'),
        keys: 'G',
        run: () => actions.adjustSubDelay(-0.1),
        hidden: !hasFile
      },
      {
        id: 'sub-later',
        group: t('Субтитры'),
        label: t('Субтитры позже на 0,1 с'),
        keys: 'H',
        run: () => actions.adjustSubDelay(0.1),
        hidden: !hasFile
      },
      {
        id: 'sub-open',
        group: t('Субтитры'),
        label: t('Подключить файл субтитров…'),
        run: actions.openSubtitle,
        hidden: !hasFile
      },

      {
        id: 'editor',
        group: t('Нарезка'),
        label: t('Нарезать видео'),
        keys: 'E',
        run: actions.openEditor,
        hidden: !hasFile
      },
      {
        id: 'screenshot',
        group: t('Нарезка'),
        label: t('Снимок кадра'),
        keys: 'S',
        run: actions.screenshot,
        hidden: !hasFile
      },

      {
        id: 'next',
        group: t('Список'),
        label: t('Следующий файл'),
        keys: 'N',
        run: actions.nextFile,
        hidden: !list
      },
      {
        id: 'prev',
        group: t('Список'),
        label: t('Предыдущий файл'),
        keys: 'P',
        run: actions.previousFile,
        hidden: !list
      },
      {
        id: 'playlist',
        group: t('Список'),
        label: t('Список воспроизведения'),
        run: actions.showPlaylist,
        hidden: !list
      },

      {
        id: 'fullscreen',
        group: t('Окно'),
        label: t('Полный экран'),
        keys: 'F',
        run: actions.toggleFullscreen,
        checked: window.fullscreen
      },
      {
        id: 'ontop',
        group: t('Окно'),
        label: t('Поверх остальных окон'),
        run: actions.toggleAlwaysOnTop,
        checked: window.alwaysOnTop
      },

      {
        id: 'open',
        group: t('Файл'),
        label: t('Открыть файл…'),
        keys: 'Ctrl+O',
        run: actions.openFile
      },
      {
        id: 'info',
        group: t('Файл'),
        label: t('Сведения о файле'),
        keys: 'I',
        run: actions.showInfo,
        hidden: !hasFile
      },
      {
        id: 'reveal',
        group: t('Файл'),
        label: t('Показать в проводнике'),
        run: actions.revealInExplorer,
        hidden: !player.path
      },

      {
        id: 'settings',
        group: t('Приложение'),
        label: t('Настройки'),
        run: actions.showSettings
      },
      {
        id: 'shortcuts',
        group: t('Приложение'),
        label: t('Сочетания клавиш'),
        keys: 'F1',
        run: actions.showShortcuts
      },
      {
        id: 'update',
        group: t('Приложение'),
        label: t('Проверить обновления'),
        run: actions.checkUpdate
      }
    ],
    [
      t,
      actions,
      hasFile,
      list,
      player.paused,
      player.muted,
      player.subVisible,
      player.speed,
      player.loop,
      player.path,
      window.fullscreen,
      window.alwaysOnTop
    ]
  )
}

/**
 * Клавиши редактора нарезки.
 *
 * Отдельным списком, а не командами: в редакторе своя раскладка, и его команды
 * живут в его собственном слое. Шпаргалке они всё равно нужны — иначе половина
 * приложения останется незадокументированной.
 */
export function editorKeys(t: (text: string) => string): { keys: string; label: string }[] {
  return [
  { keys: 'E', label: t('Открыть редактор, Esc — выйти') },
  { keys: 'S', label: t('Разрезать по плейхеду') },
  { keys: 'Del', label: t('Удалить выбранное со сдвигом') },
  { keys: 'Ctrl+D', label: t('Дублировать выбранное') },
  { keys: 'I / O', label: t('Отметить начало и конец момента') },
  { keys: 'Ctrl+X', label: t('Вырезать отмеченное') },
  { keys: 'Ctrl+Shift+X', label: t('Оставить только отмеченное') },
  { keys: 'Ctrl+Z', label: t('Отменить, Ctrl+Shift+Z — повторить') },
  { keys: 'Ctrl+R', label: t('Вернуть весь файл целиком') },
  { keys: ', / .', label: t('Кадр назад и вперёд') },
  { keys: 'Alt+← / →', label: t('По границам кусков') },
  { keys: t('Ctrl+колесо'), label: t('Зум, Shift+F — вписать целиком') },
    { keys: 'Ctrl+S', label: t('Сохранить нарезку') }
  ]
}
