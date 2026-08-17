import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/Container'
import { Heading, PAGE_TITLE_LEVEL } from '@/components/Heading'
import { Link } from '@/components/Link'
import { MAIN_CONTENT_ID } from '@/components/SkipLink'
import { Stack } from '@/components/Stack'
import { getTenantByHostname } from '@/content/tenants'
import { tenantTag } from '@/lib/cache-tags'
import { ALL_LOCALES, hreflangAlternates, localizedPath } from '@/lib/locales'

type Params = { hostname: string; locale: string; segments?: string[] }

const pathOf = (segments: string[] | undefined) => `/${(segments ?? []).join('/')}`

/**
 * Public page (`02` §5).
 *
 * PHASE 2 SCOPE — this proves the DELIVERY path, not the content model. It resolves the
 * tenant, renders in the requested locale, and emits `hreflang`. Pages, blocks and typed
 * content arrive in Phase 3 and slot in here without changing the routing or caching shape.
 *
 * Availability model: the tenant lookup runs at build/revalidate time, never per visitor.
 * Visitors are served cached static/ISR artifacts from the edge, so an admin or database
 * outage pauses *publishing*, never *serving* (`00` principle 3, `02` §5).
 *
 * Note what is absent: no Payload import. Content comes through `src/content/*`, which
 * returns DD2 domain types (`02` §11, ADR-5).
 */
export const revalidate = 3600

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { hostname, locale, segments } = await params
  const tenant = await getTenantByHostname(decodeURIComponent(hostname))
  if (!tenant) return {}

  const path = pathOf(segments)

  return {
    title: tenant.name,
    alternates: {
      canonical: localizedPath(path, locale),
      // `08` §5 — alternates for every enabled locale plus x-default.
      languages: Object.fromEntries(
        hreflangAlternates(path).map(({ hrefLang, href }) => [hrefLang, href]),
      ),
    },
  }
}

export default async function SitePage({ params }: { params: Promise<Params> }) {
  const { hostname, locale, segments } = await params

  const tenant = await getTenantByHostname(decodeURIComponent(hostname))

  /**
   * An unknown or hidden host 404s. It is NEVER served a default tenant's content — that
   * would put one school's pages on another school's domain, and no access function would
   * catch it because the mistake happens before any scoping (`02` §4.1).
   */
  if (!tenant) notFound()

  const path = pathOf(segments)

  return (
    /**
     * `id` comes from the `SkipLink` module rather than a literal, so the bypass-blocks
     * target cannot be renamed out from under the link (`07` §3). The measure and gutters
     * come from `Container` — the single owner of both, in logical properties.
     */
    <main id={MAIN_CONTENT_ID} data-cache-tag={tenantTag(tenant.id)}>
      <Container>
        <Stack space="lg">
          <Heading level={PAGE_TITLE_LEVEL}>{tenant.name}</Heading>
          <p>
            Phase 2 delivery scaffold, now rendered through the Phase 3 component foundation. Tenant
            resolved from the request host; locale resolved from the path. Page content arrives with
            the `pages` collection.
          </p>

          <dl>
            <dt>Tenant</dt>
            <dd data-testid="tenant-slug">{tenant.slug}</dd>
            <dt>Type</dt>
            <dd data-testid="tenant-type">{tenant.type}</dd>
            <dt>Locale</dt>
            <dd data-testid="locale">{locale}</dd>
            <dt>Path</dt>
            <dd data-testid="path">{path}</dd>
          </dl>

          <nav aria-label="Language">
            {/*
              `08` §6 — each language is listed in its OWN script and language, with `lang` on
              each link. Never flag icons (a flag is a country, not a language) and never
              "translate this page" as the only affordance. Labels stay untranslated here
              deliberately; that is what a language switcher is for.
            */}
            <ul>
              {ALL_LOCALES.map((code) => (
                <li key={code}>
                  <Link href={localizedPath(path, code)} lang={code} hrefLang={code}>
                    {LANGUAGE_NAMES[code] ?? code}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Stack>
      </Container>
    </main>
  )
}

/** Endonyms — each language named as its own speakers write it (`08` §6). */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  'zh-Hans': '简体中文',
  ko: '한국어',
  pt: 'Português',
  ar: 'العربية',
}
