import { createContext, useContext } from 'react'

/**
 * Перевод интерфейса.
 *
 * Ключ — сама русская строка, а не выдуманное имя вроде `player.fullscreen`.
 * Причины две. Код остаётся читаемым: в компоненте видно текст, который
 * увидит человек, а не ссылку на словарь, которую надо идти проверять. И
 * пропущенный перевод не ломает ничего — показывается русский оригинал, а не
 * `player.fullscreen` посреди кнопки.
 *
 * Словарь один и только английский: русский — исходный язык, и хранить его
 * копию значило бы держать две правды об одной строке.
 */
export type Lang = 'ru' | 'en'

export const EN: Record<string, string> = {
  // Титлбар и общее
  'Открыть файл': 'Open file',
  'Открыть файл…': 'Open file…',
  Свернуть: 'Minimize',
  Развернуть: 'Maximize',
  'Восстановить размер': 'Restore',
  Закрыть: 'Close',
  Настройки: 'Settings',
  Пусто: 'Empty',
  Готово: 'Done',
  Отменить: 'Undo',
  Отмена: 'Cancel',
  Сохранить: 'Save',
  Повторить: 'Redo',
  Повторять: 'Repeat',
  Очистить: 'Clear',
  Список: 'Playlist',
  'Список воспроизведения': 'Playlist',
  'Убрать из списка': 'Remove from playlist',
  'Ничего не нашлось': 'Nothing found',

  // Воспроизведение
  Воспроизведение: 'Playback',
  Играть: 'Play',
  Пауза: 'Pause',
  'Вперёд на 5 секунд': 'Forward 5 seconds',
  'Назад на 5 секунд': 'Back 5 seconds',
  'Вперёд на 10 секунд': 'Forward 10 seconds',
  'Назад на 10 секунд': 'Back 10 seconds',
  'Следующий кадр': 'Next frame',
  'Предыдущий кадр': 'Previous frame',
  Быстрее: 'Faster',
  Медленнее: 'Slower',
  'Обычная скорость': 'Normal speed',
  'Повторять файл': 'Loop file',
  Скорость: 'Speed',

  // Звук
  Звук: 'Audio',
  Громче: 'Louder',
  Тише: 'Quieter',
  'Без звука': 'Muted',
  'Дорожка звука': 'Audio track',
  'Задержка звука': 'Audio delay',

  // Субтитры
  Субтитры: 'Subtitles',
  'Показывать субтитры': 'Show subtitles',
  'Субтитры раньше на 0,1 с': 'Subtitles 0.1s earlier',
  'Субтитры позже на 0,1 с': 'Subtitles 0.1s later',
  'Подключить файл субтитров…': 'Add subtitle file…',
  'Выбрать файл субтитров': 'Choose subtitle file',
  'Дорожка субтитров': 'Subtitle track',
  'Задержка субтитров': 'Subtitle delay',
  'Субтитры выкл': 'Subtitles off',
  'Субтитры вкл': 'Subtitles on',
  Выключены: 'Off',

  // Файл и окно
  Файл: 'File',
  Окно: 'Window',
  Приложение: 'App',
  'Сведения о файле': 'File info',
  'Показать в проводнике': 'Show in Explorer',
  'Полный экран': 'Fullscreen',
  'Поверх остальных окон': 'Always on top',
  'Проверить обновления': 'Check for updates',
  'Сочетания клавиш': 'Keyboard shortcuts',
  'Следующий файл': 'Next file',
  'Предыдущий файл': 'Previous file',
  'Пропорции кадра': 'Aspect ratio',
  Исходные: 'Original',
  'Снимок кадра': 'Take screenshot',
  Недавние: 'Recent',
  'Команда или недавний файл': 'Command or recent file',

  // Нарезка
  Нарезка: 'Trimming',
  'Нарезать видео': 'Trim video',
  'Нарезка видео': 'Video trimming',
  'Разрезать по плейхеду': 'Split at playhead',
  'Удалить выбранное со сдвигом': 'Delete selection and close the gap',
  Дублировать: 'Duplicate',
  'Дублировать выбранное': 'Duplicate selection',
  'Отметить начало момента': 'Mark start',
  'Отметить конец момента': 'Mark end',
  'Отметить начало и конец момента': 'Mark start and end',
  'Снять метки': 'Clear marks',
  Вырезать: 'Cut out',
  Оставить: 'Keep only',
  'Вырезать отмеченное': 'Cut out the marked range',
  'Оставить только отмеченное': 'Keep only the marked range',
  'Вернуть весь файл целиком': 'Restore the whole file',
  'Кадр назад и вперёд': 'Frame back and forward',
  'По границам кусков': 'Jump between cuts',
  'Вписать целиком': 'Fit whole timeline',
  Приблизить: 'Zoom in',
  Отдалить: 'Zoom out',
  'Играть или пауза': 'Play or pause',
  'Сохранить нарезку': 'Save the trimmed video',
  'Открыть редактор, Esc — выйти': 'Open the editor, Esc to leave',
  'Выйти из редактора': 'Leave the editor',
  'Выйти из редактора (Esc)': 'Leave the editor (Esc)',
  'Выйти на ту же секунду фильма': 'Leave, staying at the same moment',
  'Отменить, Ctrl+Shift+Z — повторить': 'Undo, Ctrl+Shift+Z to redo',
  'Зум, Shift+F — вписать целиком': 'Zoom, Shift+F fits the whole timeline',
  'Ctrl+колесо': 'Ctrl+wheel',
  вырезано: 'cut out',

  // Сохранение нарезки
  Куда: 'Where',
  Как: 'How',
  Кодек: 'Codec',
  Качество: 'Quality',
  'Новый файл': 'New file',
  'Заменить исходный': 'Replace the original',
  'Заменить файл': 'Replace file',
  'Выбрать файл…': 'Choose file…',
  Быстро: 'Fast',
  Точно: 'Exact',
  'Куда сохранить нарезку': 'Where to save the trimmed video',
  'Куда сохранять снимки кадров': 'Where to save screenshots',
  'Готовлю…': 'Preparing…',
  'Сохранение отменено': 'Saving cancelled',
  'Файл заменён': 'File replaced',
  'H.264 на видеокарте': 'H.264 on the GPU',
  'HEVC на видеокарте': 'HEVC on the GPU',
  'H.264 на процессоре': 'H.264 on the CPU',
  'HEVC на процессоре': 'HEVC on the CPU',
  Высокое: 'High',
  Обычное: 'Balanced',
  Компактное: 'Small',
  кусок: 'segment',
  куска: 'segments',
  кусков: 'segments',

  // Мышь в шпаргалке
  Мышь: 'Mouse',
  Клик: 'Click',
  Колесо: 'Wheel',
  Правая: 'Right button',
  Громкость: 'Volume',
  'Пауза, двойной — полный экран': 'Pause, double click for fullscreen',
  'Меню со всем остальным': 'Menu with everything else',
  'Палитра команд и недавних файлов': 'Command and recent-file palette',

  // Ошибки и сообщения
  'Резать можно только файлы на диске, не потоки':
    'Only files on disk can be trimmed, not streams',
  'Чтобы записать поверх исходного файла, выберите «Заменить исходный»':
    'To write over the original file, choose “Replace the original”',
  'Не удалось запустить движок воспроизведения': 'Could not start the playback engine',
  Обновление: 'Update',
  Загрузка: 'Downloading',
  'Первый раз нужно скачать ffmpeg — около 165 МБ.':
    'ffmpeg has to be downloaded once — about 165 MB.',
  'Доступна версия': 'Version available:',
  Обновить: 'Update',
  Версия: 'Version',
  готова: 'is ready',
  Перезапустить: 'Restart',
  'Перетащите файл сюда': 'Drop a file here',
  или: 'or',
  ', чтобы открыть': ' to open',
  'Субтитры добавлены': 'Subtitles added',
  'Снимок сохранён в «Изображения\\Keyframe»': 'Screenshot saved to Pictures\\Keyframe',
  Дорожка: 'Track',
  с: 's',
  /*
   * Разделитель дробной части. Не текст интерфейса, а правило языка: русский
   * пишет 0,3 — английский 0.3. Держим здесь же, чтобы не заводить второй
   * механизм ради одного знака.
   */
  DECIMAL_COMMA: '.',

  // Настройки
  'Шаг перемотки стрелками': 'Arrow-key seek step',
  'J и L перематывают вдвое дальше': 'J and L seek twice as far',
  'Подхватывать соседние файлы из папки': 'Pick up neighbouring files from the folder',
  '«Дальше» и «Назад» идут по папке, как в проводнике':
    '“Next” and “Previous” follow the folder, like Explorer does',
  'Продолжать с места остановки': 'Resume where you left off',
  'Для видео длиннее трёх минут': 'For videos longer than three minutes',
  Дорожки: 'Tracks',
  'Язык звука': 'Audio language',
  'Язык субтитров': 'Subtitle language',
  'Коды через запятую: rus,eng. Действует со следующего файла':
    'Comma-separated codes: rus,eng. Applies from the next file',
  'Размер субтитров': 'Subtitle size',
  'как в файле': 'as in the file',
  Файлы: 'Files',
  'Папка для снимков кадра': 'Screenshot folder',
  'Плеер по умолчанию': 'Default player',
  'Назначить себя программой по умолчанию Windows приложению не даёт — это делается в параметрах системы':
    'Windows does not let an app make itself the default — that is done in system settings',
  'Открыть параметры': 'Open settings',
  'Выбрать…': 'Choose…',
  'По умолчанию': 'Default',
  'Пусто — как решит файл': 'Empty — up to the file',
  Язык: 'Language',
  Русский: 'Russian',
  Английский: 'English',
  Интерфейс: 'Interface',
  'Язык / Language': 'Language / Язык',
  'Русский — исходный язык интерфейса, английский берётся из словаря':
    'Russian is the source language; English comes from a dictionary',
  'Изображения\\Keyframe': 'Pictures\\Keyframe',

  // Меню по правой кнопке
  Видео: 'Video',
  Выход: 'Quit',
  'Вперёд 10 секунд': 'Forward 10 seconds',
  'Назад 10 секунд': 'Back 10 seconds',
  'Кадр вперёд': 'Next frame',
  'Кадр назад': 'Previous frame',
  'Добавить из файла…': 'Add from file…',
  'Добавить субтитры из файла…': 'Add subtitles from file…',
  'Дорожки и субтитры': 'Tracks and subtitles',
  'Нарезать видео…': 'Trim video…',
  'Очистить список': 'Clear playlist',
  'Поверх всех окон': 'Always on top',
  'Повторять список': 'Loop playlist',
  'Позже на 0,1 с': '0.1s later',
  'Раньше на 0,1 с': '0.1s earlier',
  'Показать список': 'Show playlist',
  Воспроизвести: 'Play',
  'Как в файле': 'As in the file',
  Обычная: 'Normal',
  вкл: 'on',
  выкл: 'off',
  нет: 'none',
  внешние: 'external',

  // Сведения о файле и хром
  Декодер: 'Decoder',
  Длительность: 'Duration',
  Разрешение: 'Resolution',
  'Частота кадров': 'Frame rate',
  'Пропущено кадров': 'Dropped frames',
  'Дорожек субтитров': 'Subtitle tracks',
  'Позиция воспроизведения': 'Playback position',
  'Ничего не открыто': 'Nothing is open',
  Показать: 'Show',
  Восстановить: 'Restore',
  'Выйти из полного экрана': 'Leave fullscreen',
  'Включить звук': 'Unmute',
  'Выключить звук': 'Mute',
  'Вернуть обычную скорость': 'Back to normal speed',
  'Кадр +1': 'Frame +1',
  'Кадр −1': 'Frame −1',
  'Следующий файл (N)': 'Next file (N)',
  'Предыдущий файл (P)': 'Previous file (P)',
  'Снимок кадра (S)': 'Take screenshot (S)',
  'Движок воспроизведения упал': 'The playback engine crashed',
  'Не удалось сохранить снимок кадра': 'Could not save the screenshot',

  // Редактор
  Пробел: 'Space',
  'Выход из редактора (Esc)': 'Leave the editor (Esc)',
  'Сохранить нарезку (Ctrl+S)': 'Save the trimmed video (Ctrl+S)',
  'Резы уже стоят на ключевых кадрах': 'Cuts already sit on keyframes',
  'Здесь резать нечего: плейхед на стыке кусков':
    'Nothing to split here: the playhead sits on a cut',
  'Нельзя удалить всё: должен остаться хотя бы один кусок':
    'At least one segment has to remain',
  'Отметьте начало клавишей I и конец клавишей O': 'Mark the start with I and the end with O',
  'Сначала выберите кусок': 'Select a segment first',

  // Сохранение нарезки
  видео: 'video',
  'Резать можно только по ключевым кадрам.': 'Cuts can only land on keyframes.',
  'Режет ровно там, где показано. На видеокарте — в разы быстрее просмотра.':
    'Cuts exactly where shown. On the GPU, many times faster than watching.',
  'Перенести резы на ключевые кадры, чтобы превью совпало с файлом':
    'Move the cuts onto keyframes so the preview matches the file',
  'Определится после загрузки ffmpeg': 'Will be known once ffmpeg is downloaded'

}

export const LangContext = createContext<Lang>('ru')

/**
 * Переводчик, привязанный к текущему языку.
 *
 * Хук, а не голая функция: смена языка обязана перерисовать и те панели,
 * которые обёрнуты в memo и не получают язык пропсом.
 */
export function useT(): (text: string) => string {
  const lang = useContext(LangContext)
  return (text: string) => translate(lang, text)
}

export function translate(lang: Lang, text: string): string {
  if (lang === 'ru') return text
  return EN[text] ?? text
}

/** Язык при первом запуске: русский только если система русская. */
export function defaultLang(): Lang {
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}
