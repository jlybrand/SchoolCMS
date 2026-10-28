import styles from './PublishedDate.module.css'

/**
 * When an announcement was published, as a reader says it and as a machine reads it.
 *
 * A `<time>` with `dateTime`, so assistive technology and search engines get the exact moment
 * while the page shows words. The label arrives formatted (`formatPostDate`): the visitor's
 * language and the district's time zone are decided once, not in each component.
 */
export type PublishedDateProps = {
  readonly iso: string
  readonly label: string
}

export const PublishedDate = ({ iso, label }: PublishedDateProps) => (
  <p className={styles.date}>
    <time dateTime={iso}>{label}</time>
  </p>
)
