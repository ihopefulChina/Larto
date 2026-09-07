#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const execFileAsync = promisify(execFile)

const directory = resolve(process.argv[2] ?? 'dist')
const platform = process.argv[3] ?? 'all'
const { version } = JSON.parse(
  await readFile(resolve(import.meta.dirname, '../package.json'), 'utf8')
)
const prefix = `Larto-${version}`

const expected = {
  mac: [
    `${prefix}-mac-arm64.dmg`,
    `${prefix}-mac-arm64.dmg.blockmap`,
    `${prefix}-mac-arm64.zip`,
    `${prefix}-mac-arm64.zip.blockmap`,
    `${prefix}-mac-x64.dmg`,
    `${prefix}-mac-x64.dmg.blockmap`,
    `${prefix}-mac-x64.zip`,
    `${prefix}-mac-x64.zip.blockmap`,
    'latest-mac.yml'
  ],
  windows: [
    `${prefix}-windows-x64-setup.exe`,
    `${prefix}-windows-x64-setup.exe.blockmap`,
    `${prefix}-windows-x64-portable.exe`,
    `${prefix}-windows-x64.zip`,
    'latest.yml'
  ],
  linux: [
    `${prefix}-linux-x64.AppImage`,
    `${prefix}-linux-x64.deb`,
    `${prefix}-linux-x64.rpm`,
    `${prefix}-linux-x64.tar.gz`,
    'latest-linux.yml'
  ]
}

if (platform !== 'all' && !(platform in expected)) {
  throw new Error(`Unknown platform "${platform}" (expected mac, windows, linux, or all)`)
}

const required = platform === 'all' ? Object.values(expected).flat() : expected[platform]
const actual = new Set(await readdir(directory))
const missing = required.filter((name) => !actual.has(name))
if (missing.length > 0) throw new Error(`Missing release assets:\n${missing.join('\n')}`)

const metadataChecks = {
  'latest-mac.yml': [`${prefix}-mac-arm64.zip`, `${prefix}-mac-x64.zip`],
  'latest.yml': [`${prefix}-windows-x64-setup.exe`],
  'latest-linux.yml': [`${prefix}-linux-x64.AppImage`]
}
for (const [metadata, filenames] of Object.entries(metadataChecks)) {
  if (!required.includes(metadata)) continue
  const contents = await readFile(resolve(directory, metadata), 'utf8')
  for (const filename of filenames) {
    if (!contents.includes(filename)) {
      throw new Error(`${metadata} does not reference ${filename}`)
    }
  }
}

// electron-builder 26's legacy AppImage target defaults desktop launches to --no-sandbox.
// `appImage.executableArgs: []` removes it; inspect the actual bundle on Linux so a future builder
// change cannot silently weaken the guest webview isolation promised by this project.
if ((platform === 'linux' || platform === 'all') && process.platform === 'linux') {
  const appImage = resolve(directory, `${prefix}-linux-x64.AppImage`)
  const scratch = await mkdtemp(resolve(tmpdir(), 'larto-appimage-verify-'))
  try {
    await chmod(appImage, 0o755)
    await execFileAsync(appImage, ['--appimage-extract', '*.desktop'], { cwd: scratch })
    const extracted = await readdir(resolve(scratch, 'squashfs-root'), {
      recursive: true,
      withFileTypes: true
    })
    const desktopFiles = extracted.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.desktop')
    )
    if (desktopFiles.length === 0) throw new Error('AppImage does not contain a desktop entry')
    for (const entry of desktopFiles) {
      const contents = await readFile(resolve(entry.parentPath, entry.name), 'utf8')
      const exec = contents.split(/\r?\n/).find((line) => line.startsWith('Exec=')) ?? ''
      if (/--no-sandbox(?:\s|$)/.test(exec)) {
        throw new Error(`Unsafe AppImage desktop entry: ${exec}`)
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

console.log(`verified ${required.length} ${platform} release assets for ${version}`)
