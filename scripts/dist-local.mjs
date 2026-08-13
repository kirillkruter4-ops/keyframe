/**
 * Локальная сборка установщика во временную папку.
 *
 * Обычный `npm run dist` кладёт результат в release/ внутри проекта. Если
 * проект лежит в папке, которую индексирует Windows Search — например на
 * Рабочем столе, — индексатор открывает свежие файлы ровно в тот момент, когда
 * electron-builder их удаляет, и сборка падает с EBUSY на default_app.asar.
 *
 * Здесь результат уходит в %TEMP%, вне индекса. В CI этой проблемы нет, там
 * работает обычный `npm run dist`.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const output = join(tmpdir(), 'keyframe-release')

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

console.log(`Собираю в ${output}`)

execFileSync('npx', ['electron-builder', '--win', `-c.directories.output=${output}`], {
  stdio: 'inherit',
  shell: true
})

console.log(`\nГотово. Установщик: ${output}`)
