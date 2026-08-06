import { getPayload } from 'payload'

import config from '../src/payload.config'

/**
 * Seeds the local/CI database with tenants and a district admin.
 *
 * Run with `pnpm run seed` — `payload run` gives the script the config context without
 * adding a separate TypeScript runner to the dependency surface.
 *
 * Needed because the public site is no longer static: it resolves a tenant from the request
 * Host, and an unknown host 404s by design (`02` §4.1). Without seeded tenants the dev
 * server and the e2e suite have nothing to serve.
 *
 * `*.localhost` hostnames match the local/CI environment in `06` §4. Bare `localhost` maps
 * to the district so the dev server and Playwright's readiness check resolve to a real
 * tenant.
 *
 * **Idempotent** — safe to re-run. Upserts by `slug`, the stable identifier (`03` §2),
 * rather than by hostname, which is routing configuration and may legitimately change.
 * Never truncates, so it will not wipe local content you are working on.
 */

const TENANTS = [
  { name: 'DD2 District', slug: 'district', hostname: 'localhost', type: 'district' as const },
  { name: 'School A', slug: 'school-a', hostname: 'a.localhost', type: 'school' as const },
  { name: 'School B', slug: 'school-b', hostname: 'b.localhost', type: 'school' as const },
]

const run = async () => {
  if (!process.env.DATABASE_URI) throw new Error('DATABASE_URI is required.')
  if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is required.')

  const payload = await getPayload({ config })

  for (const tenant of TENANTS) {
    const { docs } = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: tenant.slug } },
      limit: 1,
      overrideAccess: true,
    })

    const existing = docs[0]
    if (existing) {
      await payload.update({
        collection: 'tenants',
        id: existing.id,
        data: { ...tenant, status: 'active' },
        overrideAccess: true,
      })
      payload.logger.info(`updated tenant ${tenant.slug} (${tenant.hostname})`)
    } else {
      await payload.create({
        collection: 'tenants',
        data: { ...tenant, status: 'active' },
        overrideAccess: true,
      })
      payload.logger.info(`created tenant ${tenant.slug} (${tenant.hostname})`)
    }
  }

  /**
   * A district admin, only when one is explicitly requested via env.
   *
   * Never seeded with a default password: a known credential that ships in a repo is a
   * standing vulnerability, and interim local auth already carries enough credential risk
   * (see "Authentication" in CLAUDE.md). Without SEED_ADMIN_PASSWORD this is skipped and
   * the first user is created through Payload's own bootstrap screen at /admin.
   */
  const adminEmail = process.env.SEED_ADMIN_EMAIL
  const adminPassword = process.env.SEED_ADMIN_PASSWORD

  if (adminEmail && adminPassword) {
    const { docs } = await payload.find({
      collection: 'users',
      where: { email: { equals: adminEmail } },
      limit: 1,
      overrideAccess: true,
    })

    if (docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: { email: adminEmail, password: adminPassword, roles: ['district-admin'] },
        overrideAccess: true,
      })
      payload.logger.info(`created district-admin ${adminEmail}`)
    } else {
      payload.logger.info(`district-admin ${adminEmail} already exists`)
    }
  } else {
    payload.logger.info(
      'no SEED_ADMIN_PASSWORD set — skipping admin. Create the first user at /admin.',
    )
  }

  payload.logger.info('seed complete')
  process.exit(0)
}

await run()
