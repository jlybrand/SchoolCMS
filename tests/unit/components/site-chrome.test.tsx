// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { SiteFooter } from '@/components/SiteFooter'
import { SiteHeader } from '@/components/SiteHeader'
import type { ContactBlock, MenuLink, SocialLink } from '@/content/types'

import { renderComponent } from '../../helpers/render'

/**
 * The header and footer (`03` §5, `07` §3).
 *
 * Semantics only — landmarks, names, the current-page marker, locale prefixes. Contrast,
 * focus appearance and RTL mirroring are checked where a layout engine exists, by the
 * Storybook axe gate over these components' stories.
 */

const link = (label: string, href: string, newTab = false): MenuLink => ({
  id: label,
  label,
  href,
  newTab,
})

const primary = [link('About', '/about'), link('Calendar', '/calendar')]
const utility = [link('Staff email', 'https://outlook.office.com', true)]
const footer = [link('Contact', '/contact'), link('Call the office', 'tel:+18435550100')]

describe('SiteHeader', () => {
  it('is the banner landmark, holding the site name as a link home', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={utility}
        currentPath="/"
        locale="en"
        locales={['en']}
      />,
    )

    const banner = getByRole('banner')
    const home = getByRole('link', { name: 'School A' })
    expect(banner.contains(home)).toBe(true)
    expect(home.getAttribute('href')).toBe('/')
  })

  /** Site search (2026-11-16, Phase 6 D): in every header, a GET form to the results page. */
  it('holds a named search landmark that sends the words to /search, in the visitor’s language', () => {
    const header = (locale: string) =>
      renderComponent(
        <SiteHeader
          siteName="School A"
          primary={primary}
          utility={[]}
          currentPath="/"
          locale={locale}
          locales={['en', 'es']}
        />,
      )
    const { getByRole } = header('en')
    const search = getByRole('search', { name: 'Site search' })
    expect(getByRole('banner').contains(search)).toBe(true)
    expect(search.getAttribute('action')).toBe('/search')
    expect(search.getAttribute('method')).toBe('get')
    const field = getByRole('searchbox', { name: 'Search this site' })
    expect(field.getAttribute('name')).toBe('q')
    expect(getByRole('button', { name: 'Search' })).toBeTruthy()
    const spanish = header('es').container.querySelector('form[role="search"]')
    expect(spanish?.getAttribute('action')).toBe('/es/search')
  })

  it('the site name is NOT a heading — the page title is the only h1 (`07` §3)', () => {
    const { queryAllByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={[]}
        currentPath="/"
        locale="en"
        locales={['en']}
      />,
    )
    expect(queryAllByRole('heading')).toEqual([])
  })

  it('names each navigation landmark distinctly', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={utility}
        currentPath="/"
        locale="en"
        locales={['en']}
      />,
    )

    expect(getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(getByRole('navigation', { name: 'Quick links' })).toBeTruthy()
  })

  it('renders no landmark for an empty menu — an empty <nav> is a dead end in the landmark list', () => {
    const { queryAllByRole, getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={[]}
        utility={[]}
        currentPath="/"
        locale="en"
        locales={['en']}
      />,
    )

    expect(queryAllByRole('navigation')).toEqual([])
    // A brand-new tenant still gets a header with its name in it.
    expect(getByRole('link', { name: 'School A' })).toBeTruthy()
  })

  it('marks the current page, and only the current page', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={[]}
        currentPath="/about"
        locale="en"
        locales={['en']}
      />,
    )

    expect(getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page')
    expect(getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBeNull()
  })

  it('does not mark a parent as the current page — /about is not /about/staff', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={[]}
        currentPath="/about/staff"
        locale="en"
        locales={['en']}
      />,
    )
    expect(getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBeNull()
  })

  it('prefixes site paths with the locale, and leaves every other destination alone', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={primary}
        utility={utility}
        currentPath="/about"
        locale="es"
        locales={['en', 'es']}
      />,
    )

    expect(getByRole('link', { name: 'School A' }).getAttribute('href')).toBe('/es')
    expect(getByRole('link', { name: 'About' }).getAttribute('href')).toBe('/es/about')
    // Still the current page: the comparison is on the page's path, not the prefixed href.
    expect(getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('page')
    expect(getByRole('link', { name: /Staff email/ }).getAttribute('href')).toBe(
      'https://outlook.office.com',
    )
  })

  it('announces a new tab and couples rel to target, through Link', () => {
    const { getByRole } = renderComponent(
      <SiteHeader
        siteName="School A"
        primary={[]}
        utility={utility}
        currentPath="/"
        locale="en"
        locales={['en']}
      />,
    )

    const staffEmail = getByRole('link', { name: /Staff email.*opens in a new window/i })
    expect(staffEmail.getAttribute('target')).toBe('_blank')
    expect(staffEmail.getAttribute('rel')).toBe('noopener noreferrer')
  })

  describe('language switcher (`08` §6)', () => {
    const header = (locales: string[], locale = 'en', currentPath = '/about') =>
      renderComponent(
        <SiteHeader
          siteName="School A"
          primary={primary}
          utility={utility}
          currentPath={currentPath}
          locale={locale}
          locales={locales}
        />,
      )

    /**
     * It is site chrome, not page content: a visitor who cannot read the page has to find it
     * without reading the page, so it sits in the banner with the other ways around the site.
     */
    it('is a named navigation landmark inside the banner', () => {
      const { getByRole } = header(['en', 'es'])
      expect(getByRole('banner').contains(getByRole('navigation', { name: 'Language' }))).toBe(true)
    })

    it('lists each language in its own script, with lang and hreflang, pointing at this page', () => {
      const { getByRole } = header(['en', 'es', 'ar'])
      const nav = getByRole('navigation', { name: 'Language' })

      const links = [...nav.querySelectorAll('a')].map((a) => ({
        text: a.textContent,
        href: a.getAttribute('href'),
        lang: a.getAttribute('lang'),
        hrefLang: a.getAttribute('hreflang'),
      }))
      expect(links).toEqual([
        { text: 'English', href: '/about', lang: 'en', hrefLang: 'en' },
        { text: 'Español', href: '/es/about', lang: 'es', hrefLang: 'es' },
        { text: 'العربية', href: '/ar/about', lang: 'ar', hrefLang: 'ar' },
      ])
    })

    it('marks the language being read as current, and only that one', () => {
      const { getByRole } = header(['en', 'es'], 'es')
      const nav = getByRole('navigation', { name: 'Language' })
      expect(nav.querySelector('[aria-current]')?.textContent).toBe('Español')
      expect(nav.querySelectorAll('[aria-current]')).toHaveLength(1)
    })

    it('renders nothing for a site with one language — one language is not a choice', () => {
      const { queryByRole } = header(['en'])
      expect(queryByRole('navigation', { name: 'Language' })).toBeNull()
    })
  })
})

describe('SiteFooter', () => {
  it('is the contentinfo landmark with a named navigation', () => {
    const { getByRole } = renderComponent(
      <SiteFooter siteName="School A" links={footer} currentPath="/" locale="en" />,
    )

    const contentinfo = getByRole('contentinfo')
    const nav = getByRole('navigation', { name: 'Footer' })
    expect(contentinfo.contains(nav)).toBe(true)
    expect(contentinfo.textContent).toContain('School A')
  })

  it('renders no navigation landmark when it has no links', () => {
    const { queryAllByRole, getByRole } = renderComponent(
      <SiteFooter siteName="School A" links={[]} currentPath="/" locale="en" />,
    )
    expect(queryAllByRole('navigation')).toEqual([])
    expect(getByRole('contentinfo')).toBeTruthy()
  })

  it('leaves tel: and mailto: destinations unprefixed in a non-English locale', () => {
    const { getByRole } = renderComponent(
      <SiteFooter siteName="School A" links={footer} currentPath="/" locale="ar" />,
    )
    expect(getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe('/ar/contact')
    expect(getByRole('link', { name: 'Call the office' }).getAttribute('href')).toBe(
      'tel:+18435550100',
    )
  })

  describe('contact block and social links (`03` §5)', () => {
    const contact: ContactBlock = {
      address: ['123 Main Street', 'Summerville, SC 29483'],
      phone: { text: '(843) 555-0100', href: 'tel:8435550100' },
      email: { text: 'office@dd2.example', href: 'mailto:office@dd2.example' },
    }
    const social: SocialLink[] = [
      { id: 's1', platform: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/dd2' },
    ]

    it('renders the address as an <address>, one line per line, with dialable and mailable links', () => {
      const { container, getByRole } = renderComponent(
        <SiteFooter siteName="School A" links={[]} contact={contact} currentPath="/" locale="ar" />,
      )

      const address = container.querySelector('address')
      expect(address?.textContent).toContain('123 Main Street')
      expect(address?.textContent).toContain('Summerville, SC 29483')
      // Never locale-prefixed: neither is a path on this site.
      expect(getByRole('link', { name: '(843) 555-0100' }).getAttribute('href')).toBe(
        'tel:8435550100',
      )
      expect(getByRole('link', { name: 'office@dd2.example' }).getAttribute('href')).toBe(
        'mailto:office@dd2.example',
      )
    })

    it('keeps a phone number and an email address left-to-right on a right-to-left page', () => {
      const { getByRole } = renderComponent(
        <SiteFooter siteName="School A" links={[]} contact={contact} currentPath="/" locale="ar" />,
      )
      // Without it the bidi algorithm reorders "(843) 555-0100" into something undialable.
      expect(getByRole('link', { name: '(843) 555-0100' }).closest('[dir="ltr"]')).not.toBeNull()
    })

    it('renders no <address> for an empty contact block', () => {
      const { container } = renderComponent(
        <SiteFooter
          siteName="School A"
          links={[]}
          contact={{ address: [], phone: null, email: null }}
          currentPath="/"
          locale="en"
        />,
      )
      expect(container.querySelector('address')).toBeNull()
    })

    it('names the social links as their own landmark, and renders none when there are none', () => {
      const { getByRole, queryByRole, rerender } = renderComponent(
        <SiteFooter
          siteName="School A"
          links={footer}
          social={social}
          currentPath="/"
          locale="es"
        />,
      )

      const nav = getByRole('navigation', { name: 'Social media' })
      expect(nav.querySelector('a')?.getAttribute('href')).toBe('https://www.facebook.com/dd2')

      rerender(<SiteFooter siteName="School A" links={footer} currentPath="/" locale="es" />)
      expect(queryByRole('navigation', { name: 'Social media' })).toBeNull()
    })
  })
})
