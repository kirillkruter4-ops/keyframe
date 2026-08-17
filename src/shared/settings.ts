/**
 * Настройки нужны обоим процессам: главный их хранит и применяет к mpv,
 * интерфейс — показывает и меняет. Поэтому они живут здесь, а не в store:
 * иначе окно настроек тянуло бы за собой модуль с доступом к диску.
 */
export interface Settings {
  /** Шаг стрелок в секундах; J/L всегда вдвое больше */
  seekStep: number
  /** Подхватывать соседние файлы из папки в список воспроизведения */
  fillPlaylistFromFolder: boolean
  /** Возвращаться к месту, на котором остановились */
  resumePlayback: boolean
  /** Языки дорожек через запятую в порядке предпочтения: rus,eng */
  audioLanguage: string
  subtitleLanguage: string
  /** Размер шрифта субтитров в единицах mpv; 55 — его же значение по умолчанию */
  subtitleFontSize: number
  /** Папка для снимков; пусто — «Изображения/Keyframe» */
  screenshotDir: string
  /** Язык интерфейса. Русский — исходный, английский берётся из словаря */
  language: 'ru' | 'en'
}

export const DEFAULT_SETTINGS: Settings = {
  seekStep: 5,
  fillPlaylistFromFolder: true,
  resumePlayback: true,
  audioLanguage: '',
  subtitleLanguage: '',
  subtitleFontSize: 55,
  screenshotDir: '',
  language: 'ru'
}
