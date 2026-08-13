/**
 * Растрирует логотип в build/icon.png, из которого electron-builder собирает
 * .ico для установщика, ярлыков и панели задач.
 *
 * В самом SVG знак занимает середину холста с большими полями — для иконки
 * приложения это выглядит мелко, поэтому обрезаем поля и добавляем свои,
 * пропорциональные размеру.
 */
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'resources', 'logo.svg')
const OUT_DIR = join(ROOT, 'build')
const SIZE = 1024
const PADDING = Math.round(SIZE * 0.12)

mkdirSync(OUT_DIR, { recursive: true })

// Рендерим вдвое крупнее итога, чтобы обрезка полей не съела резкость.
// Плотность не задаём: холст SVG и так 2251×2359 единиц, и любой множитель
// выводит растр за предел sharp по числу пикселей.
const rendered = await sharp(SOURCE)
  .resize({ width: SIZE * 2, height: SIZE * 2, fit: 'contain', background: '#00000000' })
  .png()
  .toBuffer()

const glyph = await sharp(rendered)
  .trim()
  .resize({
    width: SIZE - PADDING * 2,
    height: SIZE - PADDING * 2,
    fit: 'contain',
    background: '#00000000'
  })
  .toBuffer()

await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: '#00000000' }
})
  .composite([{ input: glyph, gravity: 'center' }])
  .png()
  .toFile(join(OUT_DIR, 'icon.png'))

console.log(`Готово: build/icon.png (${SIZE}×${SIZE})`)
