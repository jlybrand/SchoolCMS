import { Container } from '@/components/Container'
import { Link } from '@/components/Link'
import { MenuList } from '@/components/MenuList'
import type { ContactBlock, Locale, MenuLink, SocialLink } from '@/content/types'

import styles from './SiteFooter.module.css'

/**
 * The site footer — the contentinfo landmark (`03` §5, `07` §3).
 *
 * Holds the footer menu, the contact block, the social links and the site's name. The
 * contact block and social links come from the `settings` record; the accessibility
 * statement link is a footer menu item, not a prop.
 *
 * Like `SiteHeader`, it takes everything as props and fetches nothing (CLAUDE.md rule 1).
 */

export type SiteFooterProps = {
  readonly siteName: string
  readonly links: readonly MenuLink[]
  readonly contact?: ContactBlock
  readonly social?: readonly SocialLink[]
  /** The unprefixed path of the page being rendered — see `MenuList`. */
  readonly currentPath: string
  readonly locale: Locale
  /** The landmarks' names. Props because they are visitor-facing text (`08` §4). */
  readonly label?: string
  readonly socialLabel?: string
}

const NO_CONTACT: ContactBlock = { address: [], phone: null, email: null }

export const SiteFooter = ({
  siteName,
  links,
  contact = NO_CONTACT,
  social = [],
  currentPath,
  locale,
  label = 'Footer',
  socialLabel = 'Social media',
}: SiteFooterProps) => {
  const hasContact = contact.address.length > 0 || contact.phone !== null || contact.email !== null

  return (
    <footer className={styles.footer}>
      <Container width="wide">
        <MenuList label={label} links={links} currentPath={currentPath} locale={locale} />

        {/*
          `<address>` is contact information for the page's owner, which is exactly this. An
          empty one is not rendered: a site set up this morning has no contact details yet.
        */}
        {hasContact && (
          <address className={styles.contact}>
            {contact.address.map((line, index) => (
              // Positional: lines are not reordered, and two may be identical.
              <span className={styles.line} key={index}>
                {line}
              </span>
            ))}
            {/*
              `dir="ltr"` on each: a phone number is digits and punctuation, which the bidi
              algorithm reorders on an Arabic page into a number nobody can dial (`08` §6).
              A direction ATTRIBUTE on content, not a physical CSS property — rule 5 stands.
            */}
            {contact.phone && (
              <span className={styles.line} dir="ltr">
                <Link href={contact.phone.href}>{contact.phone.text}</Link>
              </span>
            )}
            {contact.email && (
              <span className={styles.line} dir="ltr">
                <Link href={contact.email.href}>{contact.email.text}</Link>
              </span>
            )}
          </address>
        )}

        {/* The platform's name is the link text — an accessible name with no icon to label. */}
        <MenuList
          label={socialLabel}
          links={social.map(({ id, label: name, href }) => ({
            id,
            label: name,
            href,
            newTab: false,
          }))}
          currentPath={currentPath}
          locale={locale}
        />

        <p className={styles.siteName}>{siteName}</p>
      </Container>
    </footer>
  )
}
