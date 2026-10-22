import { describe, expect, it, vi } from 'vitest'

import { makeRevalidateOnPublish, tenantSitePath } from '@/collections/hooks/revalidate-on-publish'

/**
 * "The district approves … and it goes live within seconds" (`05` Phase 4 exit).
 *
 * Public pages are ISR with `revalidate = 3600`, so without this an approved page could wait an
 * hour. On a publish, the hook revalidates the owning school's whole site: the page itself,
 * and every menu, section list and sitemap that names it. One tenant, never all 28 — over-
 * purging is the other failure mode `src/lib/cache-tags.ts` warns about.
 */

const hostnames: Record<string, string> = { '2': 'a.localhost', '3': 'b.localhost' }

const setup = () => {
  const revalidate = vi.fn()
  const logError = vi.fn()
  const logDebug = vi.fn()
  const hook = makeRevalidateOnPublish({
    revalidate,
    hostnameFor: async (tenantId) => hostnames[String(tenantId)] ?? null,
  })
  const req = { payload: { logger: { error: logError, debug: logDebug } } }
  const run = (doc: Record<string, unknown>, previousDoc?: Record<string, unknown>) =>
    hook({ doc, previousDoc, req } as never)
  return { revalidate, logError, logDebug, run }
}

describe('tenantSitePath', () => {
  it('is the rewrite target root for the school, every locale beneath it', () => {
    expect(tenantSitePath('a.localhost')).toBe('/sites/a.localhost')
  })

  it('encodes the hostname the way the proxy does', () => {
    expect(tenantSitePath('weird host')).toBe('/sites/weird%20host')
  })
})

describe('revalidateOnPublish', () => {
  it('a publish revalidates the owning school, layout-deep', async () => {
    const { revalidate, run } = setup()
    const doc = { id: 1, tenant: 2, _status: 'published' }
    await expect(run(doc)).resolves.toBe(doc)
    expect(revalidate).toHaveBeenCalledExactlyOnceWith('/sites/a.localhost', 'layout')
  })

  it('reads a populated tenant', async () => {
    const { revalidate, run } = setup()
    await run({ id: 1, tenant: { id: 3 }, _status: 'published' })
    expect(revalidate).toHaveBeenCalledExactlyOnceWith('/sites/b.localhost', 'layout')
  })

  it('a draft save revalidates nothing — the public site has not changed', async () => {
    const { revalidate, run } = setup()
    await run({ id: 1, tenant: 2, _status: 'draft' }, { _status: 'published' })
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('an unknown tenant revalidates nothing and logs, rather than purging everything', async () => {
    const { revalidate, logError, run } = setup()
    await run({ id: 1, tenant: 99, _status: 'published' })
    expect(revalidate).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledOnce()
  })

  it('a failing revalidation never fails the publish — it logs, and the hour-long ISR is the floor', async () => {
    const { revalidate, logError, run } = setup()
    revalidate.mockRejectedValue(new Error('cache unreachable'))
    const doc = { id: 1, tenant: 2, _status: 'published' }
    await expect(run(doc)).resolves.toBe(doc)
    expect(logError).toHaveBeenCalledOnce()
  })

  it('outside a Next request (the seed, the test suite) it notes the skip at debug, not as an error', async () => {
    const { revalidate, logError, logDebug, run } = setup()
    revalidate.mockRejectedValue(
      new Error('Invariant: static generation store missing in revalidatePath /sites/a.localhost'),
    )
    await run({ id: 1, tenant: 2, _status: 'published' })
    expect(logError).not.toHaveBeenCalled()
    expect(logDebug).toHaveBeenCalledOnce()
  })
})
