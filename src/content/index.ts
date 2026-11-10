/**
 * THE CONTENT-ACCESS LAYER — the swap hedge (`02` §11, ADR-5).
 *
 * RULE: the public rendering layer never imports the Payload SDK. It calls functions from
 * this directory, which return DD2 domain types. Enforced by ESLint `no-restricted-imports`
 * and a CI lint gate (`06` §2.8) — not by convention, because conventions decay.
 *
 * This costs a few days of discipline and is the entire difference between "we could move
 * off Payload if we had to" and "we are married to this" (`00`).
 *
 * Phase 2 (`05`) implements the real functions against Payload's Local API:
 *
 *   pages.ts      getPageBySlug(ctx, slug, opts) -> Page
 *   posts.ts      listPosts(ctx, filter) -> Post[]; getPostBySlug; listPostPaths
 *   events.ts     listEvents(ctx, range)         -> Event[]
 *   people.ts     listPeople(ctx, filter)        -> Person[]
 *   documents.ts  listDocuments(ctx, filter)     -> Document[]
 *   alerts.ts     getActiveAlerts(ctx)           -> Alert[]
 *
 * Each is added in the phase that builds its module, not speculatively now.
 */

export type {
  AccordionBlock,
  AccordionItem,
  CallToActionBlock,
  Card,
  CardGridBlock,
  ContactBlock,
  ContactLink,
  ContentContext,
  DividerBlock,
  FeedBlock,
  Locale,
  Page,
  PageBlock,
  PageSeo,
  Post,
  RichText,
  RichTextBlock,
  RichTextHeading,
  RichTextInline,
  RichTextLink,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  ResolvedFeedBlock,
  ResolvedPageBlock,
  RichTextPageBlock,
  RichTextParagraph,
  RichTextText,
  SiteSettings,
  SocialLink,
  SocialPlatform,
  Tenant,
  TenantType,
  Visibility,
} from './types'
