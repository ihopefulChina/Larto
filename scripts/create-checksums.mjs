#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const directory = resolve(process.argv[2] ?? 'dist')
const outputName = 'SHA256SUMS.txt'
const entries = []

for (const name of await readdir(directory)) {
  if (name === outputName || name.startsWith('.')) continue
  const path = resolve(directory, name)
  if ((await stat(path)).isFile()) entries.push({ name, path })
}

entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
if (entries.length === 0) throw new Error(`No release assets found in ${directory}`)

const output = createWriteStream(resolve(directory, outputName), { encoding: 'utf8' })
for (const entry of entries) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(entry.path)) hash.update(chunk)
  output.write(`${hash.digest('hex')}  ${basename(entry.name)}\n`)
}
output.end()
await new Promise((resolveDone, reject) => {
  output.once('finish', resolveDone)
  output.once('error', reject)
})

console.log(`wrote ${outputName} for ${entries.length} assets`)
