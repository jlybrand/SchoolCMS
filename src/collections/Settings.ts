import type { CollectionConfig } from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { libraryImageField } from '@/collections/fields/library-image'
import { SOCIAL_PLATFORMS } from '@/content/site-settings'
import { toEmailHref, toPhoneHref, toSocialHref } from '@/lib/contact'
import { LOCALE_NAMES, TIER_1_LOCALES, localeFieldName } from '@/lib/locales'

/**
 * `settings` — a tenant's site title, contact block, social links, default description and
 * enabled languages (`03` §5).
 *
 * One row per tenant and district-only for every operation, for the reasons
 * `src/collections/Navigation.ts` gives: registered `isGlobal` with the multi-tenant plugin,
 * which makes `tenant` unique, and `03` §6.1 puts settings out of a school-manager's reach.
 *
 * NOT HERE YET: a default Open Graph image — an upload, like the logo, which now picks from the
 * site's library (`logo`); an image URL would bypass alt-required-at-upload (CLAUDE.md rule 7).
 *
 * Per CLAUDE.md's TDD exception table the declarations are not test-first. The behaviour is
 * the validators in `src/lib/contact.ts` and the mapper in `src/content/site-settings.ts`,
 * and both are.
 */

const optional =
  (toHref: (value: unknown) => string | null, message: string) =>
  (value: unknown): string | true => {
    if (value === null || value === undefined || value === '') return true
    return toHref(value) === null ? message : true
  }

export const Settings: CollectionConfig = {
  slug: 'settings',
  labels: { singular: 'Site details', plural: 'Site details' },
  admin: { group: 'Site' },

  access: {
    read: districtOnly,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },

  fields: [
    {
      name: 'siteTitle',
      type: 'text',
      label: 'Site name',
      maxLength: 80,
      admin: {
        description:
          'Shown in the header, the footer and the browser tab. Leave empty to use the name the site was set up with.',
      },
    },
    /**
     * The site's logo, from its own library (Jason, 2026-11-18). The DISTRICT site's logo also
     * heads the admin's start screens (`src/admin/Brand/`). An upload, so its alt text is the
     * library's and rule 7 holds at upload — the reason this waited for the file library.
     */
    libraryImageField({
      name: 'logo',
      label: 'Logo',
      required: false,
      description:
        'An image from this site’s library. The district site’s logo also appears at the top of the admin’s start screens.',
    }),
    {
      name: 'contact',
      type: 'group',
      label: 'Contact details',
      admin: { description: 'Shown at the bottom of every page. Leave any of these empty.' },
      fields: [
        {
          name: 'address',
          type: 'textarea',
          label: 'Address',
          admin: { description: 'One line per line, the way it goes on an envelope.' },
        },
        {
          name: 'phone',
          type: 'text',
          label: 'Phone',
          admin: { placeholder: '(843) 555-0100' },
          validate: optional(
            toPhoneHref,
            'Use a phone number people can dial, like (843) 555-0100, without an extension.',
          ),
        },
        {
          name: 'email',
          type: 'text',
          label: 'Email',
          admin: { placeholder: 'office@example.org' },
          validate: optional(toEmailHref, 'Use one email address, like office@example.org.'),
        },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      label: 'Social media',
      labels: { singular: 'Account', plural: 'Accounts' },
      maxRows: 6,
      admin: { description: 'Shown at the bottom of every page.' },
      fields: [
        {
          name: 'platform',
          // A radio group, not a select — see `enabledLocales` below.
          type: 'radio',
          required: true,
          label: 'Where',
          options: Object.entries(SOCIAL_PLATFORMS).map(([value, label]) => ({ value, label })),
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          label: 'Address',
          admin: { placeholder: 'https://www.facebook.com/…' },
          validate: (value: unknown) =>
            toSocialHref(value) === null
              ? "Use the account's full web address, starting https://"
              : true,
        },
      ],
    },
    {
      name: 'defaultDescription',
      type: 'textarea',
      label: 'Site description',
      // As the page-level description (src/collections/Pages.ts).
      maxLength: 200,
      admin: {
        description:
          'One or two sentences about the school, for search results and link previews. Used only for a page that has no description and no text of its own.',
      },
    },
    {
      /**
       * THE MECHANISM, NOT THE LIST. Which languages DD2 must serve is a Title VI question
       * for counsel and the Title VI coordinator (`08` §10) — so every platform locale
       * starts ON, and turning one off is a deliberate act by a district admin. English is
       * not an option because it is not optional (`toEnabledLocales`).
       *
       * CHECKBOXES, NOT A MULTI-SELECT, which is what this field was first. Payload's select
       * is react-select: its chosen values are draggable `role="button"`s with a remove
       * button nested inside, and its search box has no accessible name — one serious and
       * one critical axe violation (rule 6; tests/e2e/settings-fields.spec.ts). A checkbox is
       * a native input with a label. Same reason `platform` above is a radio group.
       *
       * Tier 1 only. A Tier 2 locale has nothing behind it until Phase 7 (`08` §2).
       */
      name: 'enabledLocales',
      type: 'group',
      label: 'Languages',
      admin: {
        description:
          'The languages this site is offered in, as well as English. Which languages the district has to offer is a language-access decision — check with the Title VI coordinator before turning one off.',
      },
      fields: TIER_1_LOCALES.map((locale) => ({
        name: localeFieldName(locale),
        type: 'checkbox' as const,
        label: LOCALE_NAMES[locale] ?? locale,
        defaultValue: true,
      })),
    },
  ],
}
