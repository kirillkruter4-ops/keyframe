import { useMemo } from 'react'
import type { PlayerState } from './usePlayer'

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
  const hasFile = player.filename !== null
  const list = player.playlist.length > 1

  return useMemo(
    () => [
      {
        id: 'play',
        group: 'Воспроизведение',
        label: player.paused ? 'Играть' : 'Пауза',
        keys: 'Space',
        run: actions.togglePause,
        hidden: !hasFile
      },
      {
        id: 'forward',
        group: 'Воспроизведение',
        label: 'Вперёд на 5 секунд',
        keys: '→',
        run: () => actions.seekBy(5),
        hidden: !hasFile
      },
      {
        id: 'back',
        group: 'Воспроизведение',
        label: 'Назад на 5 секунд',
        keys: '←',
        run: () => actions.seekBy(-5),
        hidden: !hasFile
      },
      {
        id: 'forward-long',
        group: 'Воспроизведение',
        label: 'Вперёд на 10 секунд',
        keys: 'L',
        run: () => actions.seekBy(10),
        hidden: !hasFile
      },
      {
        id: 'back-long',
        group: 'Воспроизведение',
        label: 'Назад на 10 секунд',
        keys: 'J',
        run: () => actions.seekBy(-10),
        hidden: !hasFile
      },
      {
        id: 'frame-next',
        group: 'Воспроизведение',
        label: 'Следующий кадр',
        keys: '.',
        run: () => actions.frameStep(1),
        hidden: !hasFile
      },
      {
        id: 'frame-prev',
        group: 'Воспроизведение',
        label: 'Предыдущий кадр',
        keys: ',',
        run: () => actions.frameStep(-1),
        hidden: !hasFile
      },
      {
        id: 'speed-up',
        group: 'Воспроизведение',
        label: 'Быстрее',
        keys: ']',
        run: () => actions.changeSpeed(1),
        hidden: !hasFile
      },
      {
        id: 'speed-down',
        group: 'Воспроизведение',
        label: 'Медленнее',
        keys: '[',
        run: () => actions.changeSpeed(-1),
        hidden: !hasFile
      },
      {
        id: 'speed-reset',
        group: 'Воспроизведение',
        label: 'Обычная скорость',
        keys: 'Backspace',
        run: actions.resetSpeed,
        hidden: !hasFile || player.speed === 1
      },
      {
        id: 'loop',
        group: 'Воспроизведение',
        label: 'Повторять файл',
        run: actions.toggleLoop,
        checked: player.loop,
        hidden: !hasFile
      },

      {
        id: 'volume-up',
        group: 'Звук',
        label: 'Громче',
        keys: '↑',
        run: () => actions.adjustVolume(5),
        hidden: !hasFile
      },
      {
        id: 'volume-down',
        group: 'Звук',
        label: 'Тише',
        keys: '↓',
        run: () => actions.adjustVolume(-5),
        hidden: !hasFile
      },
      {
        id: 'mute',
        group: 'Звук',
        label: 'Без звука',
        keys: 'M',
        run: actions.toggleMute,
        checked: player.muted,
        hidden: !hasFile
      },

      {
        id: 'subtitles',
        group: 'Субтитры',
        label: 'Показывать субтитры',
        keys: 'V',
        run: actions.toggleSubtitles,
        checked: player.subVisible,
        hidden: !hasFile
      },
      {
        id: 'sub-earlier',
        group: 'Субтитры',
        label: 'Субтитры раньше на 0,1 с',
        keys: 'G',
        run: () => actions.adjustSubDelay(-0.1),
        hidden: !hasFile
      },
      {
        id: 'sub-later',
        group: 'Субтитры',
        label: 'Субтитры позже на 0,1 с',
        keys: 'H',
        run: () => actions.adjustSubDelay(0.1),
        hidden: !hasFile
      },
      {
        id: 'sub-open',
        group: 'Субтитры',
        label: 'Подключить файл субтитров…',
        run: actions.openSubtitle,
        hidden: !hasFile
      },

      {
        id: 'editor',
        group: 'Нарезка',
        label: 'Нарезать видео',
        keys: 'E',
        run: actions.openEditor,
        hidden: !hasFile
      },
      {
        id: 'screenshot',
        group: 'Нарезка',
        label: 'Снимок кадра',
        keys: 'S',
        run: actions.screenshot,
        hidden: !hasFile
      },

      {
        id: 'next',
        group: 'Список',
        label: 'Следующий файл',
        keys: 'N',
        run: actions.nextFile,
        hidden: !list
      },
      {
        id: 'prev',
        group: 'Список',
        label: 'Предыдущий файл',
        keys: 'P',
        run: actions.previousFile,
        hidden: !list
      },
      {
        id: 'playlist',
        group: 'Список',
        label: 'Список воспроизведения',
        run: actions.showPlaylist,
        hidden: !list
      },

      {
        id: 'fullscreen',
        group: 'Окно',
        label: 'Полный экран',
        keys: 'F',
        run: actions.toggleFullscreen,
        checked: window.fullscreen
      },
      {
        id: 'ontop',
        group: 'Окно',
        label: 'Поверх остальных окон',
        run: actions.toggleAlwaysOnTop,
        checked: window.alwaysOnTop
      },

      {
        id: 'open',
        group: 'Файл',
        label: 'Открыть файл…',
        keys: 'Ctrl+O',
        run: actions.openFile
      },
      {
        id: 'info',
        group: 'Файл',
        label: 'Сведения о файле',
        keys: 'I',
        run: actions.showInfo,
        hidden: !hasFile
      },
      {
        id: 'reveal',
        group: 'Файл',
        label: 'Показать в проводнике',
        run: actions.revealInExplorer,
        hidden: !player.path
      },

      {
        id: 'settings',
        group: 'Приложение',
        label: 'Настройки',
        run: actions.showSettings
      },
      {
        id: 'shortcuts',
        group: 'Приложение',
        label: 'Сочетания клавиш',
        keys: 'F1',
        run: actions.showShortcuts
      },
      {
        id: 'update',
        group: 'Приложение',
        label: 'Проверить обновления',
        run: actions.checkUpdate
      }
    ],
    [
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
export const EDITOR_KEYS: { keys: string; label: string }[] = [
  { keys: 'E', label: 'Открыть редактор, Esc — выйти' },
  { keys: 'S', label: 'Разрезать по плейхеду' },
  { keys: 'Del', label: 'Удалить выбранное со сдвигом' },
  { keys: 'Ctrl+D', label: 'Дублировать выбранное' },
  { keys: 'I / O', label: 'Отметить начало и конец момента' },
  { keys: 'Ctrl+X', label: 'Вырезать отмеченное' },
  { keys: 'Ctrl+Shift+X', label: 'Оставить только отмеченное' },
  { keys: 'Ctrl+Z', label: 'Отменить, Ctrl+Shift+Z — повторить' },
  { keys: 'Ctrl+R', label: 'Вернуть весь файл целиком' },
  { keys: ', / .', label: 'Кадр назад и вперёд' },
  { keys: 'Alt+← / →', label: 'По границам кусков' },
  { keys: 'Ctrl+колесо', label: 'Зум, Shift+F — вписать целиком' },
  { keys: 'Ctrl+S', label: 'Сохранить нарезку' }
]
