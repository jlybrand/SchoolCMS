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
    // `.tsx` for the component suites, which opt into jsdom per file with a
    // `@vitest-environment` docblock rather than paying for a DOM in every unit test.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    /**
     * Runs before any test module is imported. Required because the Payload config reads
     * env at module-evaluation time, and importing a content-layer function pulls it in
     * transitively — too early for a helper to configure.
     */
    setupFiles: ['tests/setup/env.ts'],
    // Guardrail tests shell out to ESLint and Stylelint; give them room.
    testTimeout: 30_000,
    /**
     * Integration files share ONE Postgres and each calls `seed()`, which truncates and
     * recreates fixtures. Running files in parallel makes them race — two seeds inserting
     * the same unique tenant slug.
     *
     * Serialized rather than made "mostly fine" with retries: the isolation suite is the
     * tenant guarantee (`06` §2.2) and must never be flaky-and-ignored. Total runtime is a
     * few seconds, so this costs nothing worth optimizing. If it ever does, give each file
     * its own database rather than re-enabling parallelism.
     */
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `06` §7 — coverage is a signal, not a goal, EXCEPT on the five load-bearing
      // areas. Thresholds are added per-area as those modules land (Phase 1+).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/payload-types.ts', 'src/**/*.d.ts'],
    },
  },
})
