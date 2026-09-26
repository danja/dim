import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/store/**/*.test.js'],
    testTimeout: 120000
  }
})
