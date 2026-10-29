/**
 * The linked-page mark (Jason, 2026-10-29): a chain link, and the ONLY thing that identifies a
 * linked page — no word beside it. So it carries its own name: `role="img"` with an
 * `aria-label` for assistive technology (WCAG 1.1.1), and a `<title>` for a hover tooltip. Used
 * in the district's page list and the school's "Update a page".
 */
export const LinkedIcon = ({ className }: { className?: string | undefined }) => (
  <svg
    aria-label="Linked page"
    className={className}
    fill="none"
    focusable="false"
    height="16"
    role="img"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <title>Linked page</title>
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
)
