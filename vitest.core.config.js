import { defineConfig } from 'vitest/config'

// Everything except tests/store/, which needs a live SPARQL endpoint
// (npm run test:store).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['tests/store/**', '**/node_modules/**'],
    testTimeout: 30000
  }
})
