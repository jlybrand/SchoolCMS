import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import type { ResolvedHeroBlock } from '@/content/types'

import styles from './Hero.module.css'

/**
 * A hero (Jason, 2026-11-13): a large image across the top of a page, wider than the text
 * column, and — when it has any — its words on a solid band under the image (beside it on a
 * wide screen). "Images will not always have a heading", so every word is optional; with none,
 * the hero is the image alone.
 *
 * THE BAND, NOT TEXT OVER A PHOTO: words on `--color-surface-raised` meet contrast whatever the
 * image, and the button is `Link`'s button, a token pair checked at token level (`07` §3).
 * The heading takes the block's level, as every block's does (`03` §3.2).
 */
export type HeroProps = {
  readonly block: ResolvedHeroBlock
  readonly baseLevel: HeadingLevel
}

/** As wide as the hero can be: the wide measure, or the screen. */
const SIZES = '(min-width: 72rem) 72rem, 100vw'

export const Hero = ({ block, baseLevel }: HeroProps) => {
  const words = block.heading !== null || block.subheading !== null || block.href !== null
  return (
    <div className={styles.hero} data-words={words || undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- library files, sized by srcSet */}
      <img
        alt={block.image.alt}
        className={styles.image}
        decoding="async"
        fetchPriority="high"
        height={block.image.height ?? undefined}
        sizes={SIZES}
        src={block.image.src}
        srcSet={block.image.srcSet}
        width={block.image.width ?? undefined}
      />
      {words ? (
        <div className={styles.band}>
          {block.heading === null ? null : (
            <Heading level={baseLevel} size="xl">
              {block.heading}
            </Heading>
          )}
          {block.subheading === null ? null : (
            <p className={styles.subheading}>{block.subheading}</p>
          )}
          {block.href === null || block.linkLabel === null ? null : (
            <p className={styles.action}>
              <Link href={block.href} newWindow={block.newTab} variant="button">
                {block.linkLabel}
              </Link>
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
