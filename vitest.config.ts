import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirrors the `@shared` alias from electron.vite.config.ts so main-process modules that do
// not touch `electron` (openapi, url helpers…) can be unit-tested directly.
export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: { include: ['tests/**/*.test.ts'] }
})
