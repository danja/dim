import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/common/**/*.test.js', 'tests/gnamgnam/**/*.test.js', 'tests/app/**/*.test.js'],
    exclude: ['tests/store/**'],
    testTimeout: 30000
  }
})
