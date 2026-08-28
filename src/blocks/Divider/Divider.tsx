import styles from './Divider.module.css'

/**
 * A thematic break between sections of a page (`03` §3.1).
 *
 * AN `<hr>`, NOT AN `aria-hidden` DIV. The element means "thematic break" — a real semantic
 * an editor is expressing when they reach for it — and screen readers convey it. Hiding it
 * would throw away the only thing that distinguishes this block from extra whitespace, which
 * `Stack` already owns.
 *
 * It takes no props. There is no `baseLevel` to thread because it has no heading, and no
 * style field because per-tenant themes own appearance (`02` §4.4).
 */

export const Divider = () => <hr className={styles.divider} />
