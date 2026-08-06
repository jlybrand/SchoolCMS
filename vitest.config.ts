import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // Guardrail tests shell out to ESLint and Stylelint; give them room.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `06` §7 — coverage is a signal, not a goal, EXCEPT on the five load-bearing
      // areas. Thresholds are added per-area as those modules land (Phase 1+).
      include: ['src/**/*.ts'],
      exclude: ['src/payload-types.ts', 'src/**/*.d.ts'],
    },
  },
})
