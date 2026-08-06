/**
 * PHASE 0 PLACEHOLDER — the "empty app" the Phase 0 exit criteria refer to (`05`).
 *
 * It exists so the axe gate, Lighthouse budget, and e2e smoke test have a real page to run
 * against from commit one. Phase 2 replaces it with tenant-resolved, ISR-rendered content
 * fetched through `src/content/*`.
 *
 * Note what this file does NOT do: it does not import Payload. That is the boundary rule,
 * and CI fails if it is broken (`02` §11).
 */
export default function HomePage() {
  return (
    <main>
      <h1>DD2 Website Platform</h1>
      <p>
        Phase 0 scaffold. Tenancy, authentication, and content rendering arrive in Phases 1 and 2.
      </p>
    </main>
  )
}
