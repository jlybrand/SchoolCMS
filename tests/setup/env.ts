/**
 * Test environment, applied BEFORE any test module is imported.
 *
 * This has to be a setup file rather than something the helper does. `src/payload.config.ts`
 * reads `process.env` at module-evaluation time, and any test that imports a content-layer
 * function pulls the config in transitively at import — which happens before the first line
 * of the test body runs. Setting env inside a helper is therefore too late.
 *
 * Points at a disposable database. Never the development one: the isolation suite truncates
 * collections between runs (`06` §4).
 */
process.env.DATABASE_URI =
  process.env.TEST_DATABASE_URI ?? 'postgres:///dd2_test?host=/var/run/postgresql'

process.env.PAYLOAD_SECRET ??= 'test-only-secret-not-used-in-any-environment'

/**
 * Never send email from a test run, whatever the developer's environment holds. The approval
 * suites trigger the submitter's email (`notify-review-outcome.ts`); with no key, Payload has no
 * adapter and logs instead. The suites that assert on email spy on `payload.sendEmail`.
 */
process.env.RESEND_API_KEY = ''
