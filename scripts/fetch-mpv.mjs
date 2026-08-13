/**
 * Скачивает и распаковывает сборку mpv для Windows в resources/mpv.
 *
 * mpv.exe весит ~113 МБ и в репозитории не хранится, поэтому этот скрипт нужен
 * и разработчику после клонирования, и CI перед сборкой установщика.
 *
 * Берём вариант x86_64 (не -v3): тот требует AVX2 и не запустится на
 * процессорах старше примерно 2015 года.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'resources', 'mpv')
const TMP = join(ROOT, '.tmp-mpv')
const REPO = 'zhongfly/mpv-winbuild'
const PATTERN = 'mpv-x86_64-2*.7z'

function run(command, args) {
  return execFileSync(command, args, { stdio: 'inherit' })
}

function sevenZipPath() {
  for (const candidate of ['7z', 'C:\\Program Files\\7-Zip\\7z.exe']) {
    try {
      execFileSync(candidate, ['i'], { stdio: 'ignore' })
      return candidate
    } catch {
      // пробуем следующий
    }
  }
  throw new Error('Не найден 7-Zip. Установите его: winget install 7zip.7zip')
}

if (existsSync(join(DEST, 'mpv.exe'))) {
  console.log('mpv уже на месте — пропускаю. Для переустановки удалите resources/mpv.')
  process.exit(0)
}

rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
mkdirSync(DEST, { recursive: true })

console.log(`Скачиваю mpv из ${REPO}…`)
run('gh', ['release', 'download', '--repo', REPO, '--pattern', PATTERN, '--dir', TMP, '--clobber'])

const archive = readdirSync(TMP).find((name) => name.endsWith('.7z'))
if (!archive) throw new Error('Архив с mpv не скачался')

console.log('Распаковываю…')
run(sevenZipPath(), ['x', join(TMP, archive), `-o${DEST}`, '-y'])
rmSync(TMP, { recursive: true, force: true })

if (!existsSync(join(DEST, 'mpv.exe'))) throw new Error('mpv.exe не появился после распаковки')
console.log('Готово: resources/mpv/mpv.exe')
