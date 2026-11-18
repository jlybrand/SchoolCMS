import { PLATFORM_NAME } from './brand'
import styles from './Brand.module.css'
import logo from './district-header-logo.svg'
import mark from './district-footer-home-logo.svg'

/**
 * The platform's own logo and mark in Payload's graphics slots (Jason, 2026-11-18: white-label
 * the platform). FIXED files, committed beside this component and imported, so the build serves
 * them as hashed assets — no `public/` folder needed.
 *
 * `PlatformLogo` is `admin.components.graphics.Logo`: the sign-in screens. Named, as the logo is
 * the page's identity there. The logo is black on transparent, so it sits on a white plate
 * (`Brand.module.css`) — visible in Payload's dark theme too.
 *
 * `PlatformMark` is `admin.components.graphics.Icon`: Payload draws it ONLY as the content of the
 * breadcrumb's home link, so its alt text is that link's whole name — "Dashboard", where it goes.
 */
export const PlatformLogo = () => (
  // A fixed SVG: nothing for next/image to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt={PLATFORM_NAME}
    className={styles.platformLogo}
    height={logo.height}
    src={logo.src}
    width={logo.width}
  />
)

export const PlatformMark = () => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Dashboard"
    className={styles.platformMark}
    height={mark.height}
    src={mark.src}
    width={mark.width}
  />
)
