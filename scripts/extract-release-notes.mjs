#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function extractReleaseNotes(changelog, tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!SEMVER.test(version)) throw new Error(`Invalid release version: ${tag}`)

  const heading = new RegExp(`^##\\s+\\[${escapeRegExp(version)}\\](?:\\s.*)?$`, 'gm')
  const matches = [...changelog.matchAll(heading)]
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `CHANGELOG.md has no section for ${version}`
        : `CHANGELOG.md has multiple sections for ${version}`
    )
  }

  const start = matches[0].index + matches[0][0].length
  const remainder = changelog.slice(start).replace(/^\r?\n/, '')
  const nextHeading = remainder.search(/^##\s+/m)
  const section = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)
  const releaseLinks = section.search(/^\[\d+\.\d+\.\d+(?:-[^\]]+)?\]:\s+/m)
  const notes = (releaseLinks === -1 ? section : section.slice(0, releaseLinks)).trim()
  if (!notes) throw new Error(`CHANGELOG.md section ${version} is empty`)
  return `${notes}\n`
}

async function main() {
  const tag = process.argv[2]
  const output = process.argv[3]
  if (!tag || !output) {
    throw new Error('Usage: node scripts/extract-release-notes.mjs <vX.Y.Z> <output.md>')
  }
  const changelog = await readFile(resolve(import.meta.dirname, '../CHANGELOG.md'), 'utf8')
  const notes = extractReleaseNotes(changelog, tag)
  await writeFile(resolve(output), notes, 'utf8')
  console.log(`wrote release notes for ${tag} to ${output}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
