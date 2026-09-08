import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/rdf/**/*.test.js', 'tests/search/**/*.test.js', 'tests/bookmark/**/*.test.js', 'tests/vectors/**/*.test.js', 'tests/enrich/**/*.test.js'],
    testTimeout: 30000
  }
})
