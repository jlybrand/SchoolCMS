import type { CollectionConfig } from 'payload'

import { districtOnly } from '@/access/tenant-scoped'
import { libraryImageField } from '@/collections/fields/library-image'
import { SOCIAL_PLATFORMS } from '@/content/site-settings'
import { toEmailHref, toPhoneHref, toSocialHref, toStateCode, toZipCode } from '@/lib/contact'
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
  labels: { singular: 'Site settings', plural: 'Site settings' },
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
    /**
     * Logos and thumbnails (Jason, 2026-11-18) — images from the site's own library, so each one's
     * alt text is the library's (rule 7). `logo` keeps the name it was added under; it is the
     * PRIMARY logo. The secondary logo and thumbnail are stored for uses not built yet.
     */
    libraryImageField({
      name: 'logo',
      label: 'Primary logo',
      required: false,
      description:
        'Shown at the top of every page. The district site’s also appears at the top of the admin’s start screens. From this site’s library.',
    }),
    libraryImageField({
      name: 'secondaryLogo',
      label: 'Secondary logo',
      required: false,
      description:
        'Another version of the logo, for places the primary one doesn’t suit. From this site’s library.',
    }),
    libraryImageField({
      name: 'primaryThumbnail',
      label: 'Primary thumbnail',
      required: false,
      description:
        'The picture shown beside a link to this site when it’s shared — in a text, an email or on social media. From this site’s library.',
    }),
    libraryImageField({
      name: 'secondaryThumbnail',
      label: 'Secondary thumbnail',
      required: false,
      description:
        'Another picture for the site, for places the primary one doesn’t suit. From this site’s library.',
    }),
    {
      name: 'contact',
      type: 'group',
      label: 'Contact details',
      admin: { description: 'Shown at the bottom of every page. Leave any of these empty.' },
      fields: [
        // The address in parts (Jason, 2026-11-18), as an envelope has it.
        { name: 'street', type: 'text', label: 'Street address', maxLength: 120 },
        {
          type: 'row',
          fields: [
            { name: 'city', type: 'text', label: 'City', maxLength: 80 },
            {
              name: 'state',
              type: 'text',
              label: 'State',
              maxLength: 2,
              admin: { placeholder: 'SC', width: '25%' },
              validate: optional(toStateCode, 'Use the two-letter state code, like SC.'),
            },
            {
              name: 'zip',
              type: 'text',
              label: 'Zip code',
              maxLength: 10,
              admin: { placeholder: '29483', width: '25%' },
              validate: optional(
                toZipCode,
                'Use five digits, like 29483, or ZIP+4, like 29483-1234.',
              ),
            },
          ],
        },
        /**
         * The one-box address the fields above replace. HIDDEN, not removed: expand/contract
         * (CLAUDE.md) — a row saved before the split still shows it (`toSiteSettings`) until any
         * part is filled. Drop the column once real migrations exist (`docs/phases/06` §16).
         */
        { name: 'address', type: 'textarea', label: 'Address', admin: { hidden: true } },
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
          name: 'fax',
          type: 'text',
          label: 'Fax',
          admin: { placeholder: '(843) 555-0101' },
          validate: optional(toPhoneHref, 'Use a fax number like (843) 555-0101.'),
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
          // A radio group, not a select: Payload's select is react-select, which fails axe.
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
       * NO LONGER A PER-SITE SETTING (Jason, 2026-11-18: languages "should be handled
       * differently"; every site is English only until then — `toSiteSettings`). HIDDEN, not
       * removed: expand/contract (CLAUDE.md); nothing reads it. Drop its columns once real
       * migrations exist (`docs/phases/06` §16). Which languages DD2 must serve remains a Title VI
       * question for counsel (`08` §10).
       */
      name: 'enabledLocales',
      type: 'group',
      label: 'Languages',
      admin: { hidden: true },
      fields: TIER_1_LOCALES.map((locale) => ({
        name: localeFieldName(locale),
        type: 'checkbox' as const,
        label: LOCALE_NAMES[locale] ?? locale,
        defaultValue: true,
      })),
    },
  ],
}
