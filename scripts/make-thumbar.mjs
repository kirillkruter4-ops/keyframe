/**
 * Рисует иконки для кнопок на превью окна в панели задач.
 *
 * Windows берёт их из файлов, а не из разметки, поэтому растр лежит в
 * resources/thumbar и попадает в сборку как обычный ресурс. Размер 16×16 —
 * именно столько запрашивает система; крупнее она бы ужала сама и размылила
 * тонкие линии.
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'resources', 'thumbar')
const SIZE = 16

// Белые, как остальные значки на тёмной панели задач Windows
const ICONS = {
  play: '<path d="M4 2.5l9 5.5-9 5.5z"/>',
  pause: '<rect x="3.5" y="2.5" width="3.5" height="11" rx="1"/><rect x="9" y="2.5" width="3.5" height="11" rx="1"/>',
  forward: '<path d="M2 3l5.5 5L2 13zM8.5 3L14 8l-5.5 5z"/>',
  back: '<path d="M14 3L8.5 8 14 13zM7.5 3L2 8l5.5 5z"/>'
}

mkdirSync(OUT_DIR, { recursive: true })

for (const [name, body] of Object.entries(ICONS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 16 16" fill="#ffffff">${body}</svg>`
  await sharp(Buffer.from(svg)).png().toFile(join(OUT_DIR, `${name}.png`))
}

console.log(`Готово: resources/thumbar (${Object.keys(ICONS).length} иконки, ${SIZE}×${SIZE})`)
