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

// The source already carries transparent margins around the rounded card. Trim them first so
// the card itself (not the canvas) is what gets fitted, otherwise the artwork ends up padded
// twice and looks small in the Dock.
const art = await sharp(source).trim({ threshold: 10 }).png().toBuffer()
const artMeta = await sharp(art).metadata()
console.log(`artwork ${artMeta.width}x${artMeta.height} (trimmed from source)`)

// macOS icon grid: on a 1024 canvas the app-icon squircle is 824 px wide (80.5%) with a
// continuous-curvature corner of ~22.37% of its side. macOS 26 checks the alpha shape of legacy
// (.icns) icons against this grid: anything else, including our card whose corners are much
// rounder, is shrunk and dropped onto a grey system tile, which is what made the icon look
// small no matter how much of the canvas it filled. So the card is rendered *into* the exact
// squircle: scaled a little past it (BLEED) so its own corners fall outside the mask, on a
// backing of its frame colour, then cut with the mask.
const SQUIRCLE_FILL = 824 / 1024
const SQUIRCLE_RADIUS = 0.2237
const SQUIRCLE_SMOOTHING = 0.6 // Figma "corner smoothing" that reproduces Apple's shape
const BLEED = 0.05

/** Corner geometry of a smoothed rounded rect (figma-squircle algorithm). */
function cornerParams(radius, smoothing, budget) {
  const rad = (deg) => (deg * Math.PI) / 180
  const s = Math.min(smoothing, budget / radius - 1)
  const p = Math.min((1 + s) * radius, budget)
  const arcMeasure = 90 * (1 - s)
  const arc = Math.sin(rad(arcMeasure / 2)) * radius * Math.SQRT2
  const angleAlpha = (90 - arcMeasure) / 2
  const p3ToP4 = radius * Math.tan(rad(angleAlpha / 2))
  const angleBeta = 45 * s
  const c = p3ToP4 * Math.cos(rad(angleBeta))
  const d = c * Math.tan(rad(angleBeta))
  const b = (p - arc - c - d) / 3
  return { a: 2 * b, b, c, d, p, arc, r: radius }
}

function squirclePath(side, radius, smoothing) {
  const { a, b, c, d, p, arc: L, r } = cornerParams(radius, smoothing, side / 2)
  return [
    `M ${side - p} 0`,
    `c ${a} 0 ${a + b} 0 ${a + b + c} ${d}`,
    `a ${r} ${r} 0 0 1 ${L} ${L}`,
    `c ${d} ${c} ${d} ${b + c} ${d} ${a + b + c}`,
    `L ${side} ${side - p}`,
    `c 0 ${a} 0 ${a + b} ${-d} ${a + b + c}`,
    `a ${r} ${r} 0 0 1 ${-L} ${L}`,
    `c ${-c} ${d} ${-(b + c)} ${d} ${-(a + b + c)} ${d}`,
    `L ${p} ${side}`,
    `c ${-a} 0 ${-(a + b)} 0 ${-(a + b + c)} ${-d}`,
    `a ${r} ${r} 0 0 1 ${-L} ${-L}`,
    `c ${-d} ${-c} ${-d} ${-(b + c)} ${-d} ${-(a + b + c)}`,
    `L 0 ${p}`,
    `c 0 ${-a} 0 ${-(a + b)} ${d} ${-(a + b + c)}`,
    `a ${r} ${r} 0 0 1 ${L} ${-L}`,
    `c ${c} ${-d} ${b + c} ${-d} ${a + b + c} ${-d}`,
    'Z'
  ].join(' ')
}

async function squircleMask(size) {
  const side = size * SQUIRCLE_FILL
  const offset = (size - side) / 2
  const path = squirclePath(side, side * SQUIRCLE_RADIUS, SQUIRCLE_SMOOTHING)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<g transform="translate(${offset} ${offset})"><path d="${path}" fill="#fff"/></g></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// Mean colour of the card's outer ring (its pale frame): backs the squircle so the corners the
// card's rounder shape leaves uncovered blend in instead of showing through.
const backing = await (async () => {
  const { data, info } = await sharp(art).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const inset = Math.min(x, info.width - 1 - x, y, info.height - 1 - y) / info.width
      const i = (y * info.width + x) * 4
      if (inset < 0.02 || inset > 0.05 || data[i + 3] < 250) continue
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n++
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n), alpha: 1 }
})()

async function renderSquare(size, { padded }) {
  // The card is a rounded square that is ~3% wider than tall; `fill` makes it exactly square
  // (macOS icons are) instead of leaving uneven margins. A uniform 3% squeeze is invisible on
  // this artwork, whereas a 3% shorter card next to square neighbours is not.
  if (!padded) return sharp(art).resize(size, size, { fit: 'fill' }).png().toBuffer()
  const inner = Math.round(size * SQUIRCLE_FILL * (1 + BLEED))
  const card = await sharp(art).resize(inner, inner, { fit: 'fill' }).png().toBuffer()
  const offset = Math.round((size - inner) / 2)
  const filled = await sharp({
    create: { width: size, height: size, channels: 4, background: backing }
  })
    .composite([{ input: card, left: offset, top: offset }])
    .png()
    .toBuffer()
  return sharp(filled)
    .composite([{ input: await squircleMask(size), blend: 'dest-in' }])
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
await sharp(await renderSquare(512, { padded: false })).toFile(
  resolve(root, 'src/renderer/src/assets/icon.png')
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
