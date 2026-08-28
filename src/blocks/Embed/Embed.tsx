import { Link } from '@/components/Link'
import type { EmbedBlock } from '@/content/types'

import styles from './Embed.module.css'

/**
 * A third-party video (`03` §3.1, `07` §6).
 *
 * ============================================================================
 * AN EMBED IS DD2'S ACCESSIBILITY OBLIGATION EVEN THOUGH DD2 DID NOT BUILD IT.
 * ============================================================================
 *
 * Which is why this component is two things, not one: the frame, and a **visible fallback
 * link** (`07` §6). The frame can be blocked at the network, refused by a browser setting, or
 * simply unusable with a visitor's assistive technology — and in every one of those cases the
 * link is what keeps the content reachable. It is not a nicety and it is not conditional.
 *
 * The link points at the WATCH PAGE, never at the frame URL. An embed URL opened as a page is
 * a bare player with no title, no description and no captions menu.
 *
 * WHAT THIS COMPONENT DOES NOT DO: parse, validate, or allowlist. `src` and `href` arrive
 * already normalized and rebuilt from constants by `src/lib/embed-url.ts`, which the mapper
 * calls. A renderer that re-derived either would be a second definition of what is allowed.
 *
 * CAPTIONS ARE POLICY, NOT SCHEMA (`07` §6, decided 2026-08-28). They are configured on
 * YouTube, so a field here would record a claim rather than enforce a state. It is owned by
 * whoever publishes the video.
 */

export type EmbedProps = {
  readonly block: EmbedBlock
}

export const Embed = ({ block }: EmbedProps) => (
  <figure className={styles.figure}>
    {/*
      The wrapper owns the aspect ratio so the frame cannot decide its own height — a frame
      that sizes itself is a layout shift, and this one sits inside a page whose LCP budget is
      fixed (`01` §6).
    */}
    <div className={styles.frame}>
      <iframe
        allow="encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        className={styles.player}
        /*
         * Below the fold on most pages, and a third-party player is the heaviest thing on any
         * of them.
         */
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={block.src}
        // The frame's accessible name (WCAG 4.1.2). Required at the schema, dropped if absent.
        title={block.title}
      />
    </div>

    {/*
      Named for its destination rather than "click here" (WCAG 2.4.4). No `newWindow`: leaving
      for YouTube is ordinary navigation, and `Link` reserves the new-window announcement for
      destinations that genuinely must not replace the page.

      The English words here are render-layer text, translated by the Phase 7 pipeline like
      every other string the templates own (`08` §4).
    */}
    <figcaption className={styles.caption}>
      <Link href={block.href}>{`Watch “${block.title}” on YouTube`}</Link>
    </figcaption>
  </figure>
)
