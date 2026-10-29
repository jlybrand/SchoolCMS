/**
 * The linked-page mark (Jason, 2026-10-29): a chain link, always beside the word "Linked", so
 * it is never the only signal (WCAG 1.1.1, 1.4.1). Decorative to assistive technology for that
 * reason. Used in the district's page list and the school's "Update a page".
 */
export const LinkedIcon = ({ className }: { className?: string | undefined }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    focusable="false"
    height="16"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
)
