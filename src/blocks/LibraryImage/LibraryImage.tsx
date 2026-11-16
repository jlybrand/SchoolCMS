import type { ResolvedImageBlock } from '@/content/types'

import styles from './LibraryImage.module.css'

/**
 * An image from the site's library (Jason, 2026-11-13), with an optional caption.
 *
 * HANDED ITS IMAGE: `resolvePageBlocks` loaded the file — its sizes and its library alt text,
 * empty for a decorative image (`toImageAsset`). Never fetched or re-described here (rule 1;
 * rule 7 holds at upload). Width and height are set so the page doesn't jump as it loads.
 */
export type LibraryImageProps = { readonly block: ResolvedImageBlock }

/** The text column is at most ~42rem; a phone takes the full width. */
const SIZES = '(min-width: 48rem) 42rem, 100vw'

export const LibraryImage = ({ block }: LibraryImageProps) => (
  <figure className={styles.figure}>
    {/* eslint-disable-next-line @next/next/no-img-element -- library files, sized by srcSet; next/image would re-route them */}
    <img
      alt={block.image.alt}
      className={styles.image}
      decoding="async"
      height={block.image.height ?? undefined}
      loading="lazy"
      sizes={SIZES}
      src={block.image.src}
      srcSet={block.image.srcSet}
      width={block.image.width ?? undefined}
    />
    {block.caption === null ? null : (
      <figcaption className={styles.caption}>{block.caption}</figcaption>
    )}
  </figure>
)
