import assert from 'node:assert/strict'
import test from 'node:test'
import { extractReleaseNotes } from './extract-release-notes.mjs'

const changelog = `# Changelog

## [0.2.0] — 2026-09-04

Release summary.

### Fixed

- A release issue.

## [0.1.0] — 2026-09-01

Older notes.

[0.2.0]: https://example.test/v0.2.0
[0.1.0]: https://example.test/v0.1.0
`

test('extractReleaseNotes selects only the exact tagged section', () => {
  assert.equal(
    extractReleaseNotes(changelog, 'v0.2.0'),
    'Release summary.\n\n### Fixed\n\n- A release issue.\n'
  )
})

test('extractReleaseNotes accepts a version without the v prefix', () => {
  assert.equal(extractReleaseNotes(changelog, '0.1.0'), 'Older notes.\n')
})

test('extractReleaseNotes rejects malformed, missing, duplicate, and empty releases', () => {
  assert.throws(() => extractReleaseNotes(changelog, 'release-0.2.0'), /Invalid release version/)
  assert.throws(() => extractReleaseNotes(changelog, 'v9.9.9'), /no section/)
  assert.throws(
    () => extractReleaseNotes(`${changelog}\n## [0.2.0]\n\nAgain.\n`, 'v0.2.0'),
    /multiple sections/
  )
  assert.throws(() => extractReleaseNotes('## [1.0.0]\n\n## [0.9.0]\nNotes.\n', 'v1.0.0'), /empty/)
})
