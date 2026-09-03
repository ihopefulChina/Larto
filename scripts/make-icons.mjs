#!/usr/bin/env node
// Generates build/icon.icns, build/icon.png, resources/icon.png and website icons
// from resources/logo-source.png using sharp + macOS `iconutil`.
// Usage: pnpm icons
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'resources/logo-source.png')
if (!existsSync(source)) {
  console.error(`missing ${source}`)
  process.exit(1)
}

const buildDir = resolve(root, 'build')
const iconset = resolve(buildDir, 'icon.iconset')
mkdirSync(buildDir, { recursive: true })
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset)

// macOS app icons are expected to sit inside the standard rounded-rect grid:
// artwork occupies ~80% of the canvas so the app does not look oversized in the Dock.
async function renderSquare(size, { padded }) {
  if (!padded) return sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer()
  const inner = Math.round(size * 0.8)
  const art = await sharp(source).resize(inner, inner, { fit: 'cover' }).png().toBuffer()
  const offset = Math.round((size - inner) / 2)
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: art, left: offset, top: offset }])
    .png()
    .toBuffer()
}

const entries = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]
for (const [name, size] of entries) {
  const buf = await renderSquare(size, { padded: true })
  await sharp(buf).toFile(resolve(iconset, name))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', resolve(buildDir, 'icon.icns')])
rmSync(iconset, { recursive: true, force: true })

await sharp(await renderSquare(1024, { padded: true })).toFile(resolve(buildDir, 'icon.png'))
mkdirSync(resolve(root, 'resources'), { recursive: true })
await sharp(await renderSquare(512, { padded: false })).toFile(resolve(root, 'resources/icon.png'))
await sharp(await renderSquare(64, { padded: false })).toFile(
  resolve(root, 'resources/icon-64.png')
)

const site = resolve(root, 'website/public')
if (existsSync(site)) {
  await sharp(await renderSquare(512, { padded: false })).toFile(resolve(site, 'icon-512.png'))
  await sharp(await renderSquare(180, { padded: false })).toFile(
    resolve(site, 'apple-touch-icon.png')
  )
  await sharp(await renderSquare(64, { padded: false })).toFile(resolve(site, 'favicon.png'))
}
console.log('icons generated')
