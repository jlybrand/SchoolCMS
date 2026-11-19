import type { Data, Payload, PayloadRequest } from 'payload'

import { relationshipIdOf } from '@/access/predicates'

import styles from './SiteName.module.css'

/**
 * "Site: School A" atop a document's form (`siteNameField`, Jason 2026-11-18). The site is read
 * AS THE USER from the document's own `tenant`, so it names the site the document is really on —
 * not whatever the left menu's tenant select happens to say. Nothing on a new document that has
 * no site yet.
 */
export const SiteNameField = async ({
  data,
  payload,
  req,
}: {
  data?: Data
  payload: Payload
  req: PayloadRequest
}) => {
  const tenant = relationshipIdOf((data as { tenant?: unknown } | undefined)?.tenant as never)
  if (tenant === null) return null
  const site = await payload
    .findByID({
      collection: 'tenants',
      id: tenant,
      req,
      overrideAccess: false,
      depth: 0,
      select: { name: true },
    })
    .catch(() => null)
  if (!site || typeof site.name !== 'string') return null
  return (
    <p className={styles.site} id="doc-site">
      <span className={styles.label}>Site</span>
      <strong className={styles.name}>{site.name}</strong>
    </p>
  )
}
