import { replacementProblems, resourceProblems, type ResourceKind } from '@/lib/resources'

import { MAX_UPLOAD_BYTES } from './upload-file'

/**
 * "Replace a file" on the school plane (Jason, 2026-11-16) — the form's rules. PURE.
 *
 * A new file in the old one's place, of the SAME KIND (`replacementProblems`), keeping its library
 * entry so every page using it shows the new one. An image's description is asked again,
 * prefilled — sending it is the confirmation — in the library's own words (`resourceProblems`). A
 * document asks nothing more: the server marks the new one "not checked yet". No approval.
 */

export type ReplaceInput = {
  original: { kind: ResourceKind; mimeType: string }
  file: { name: string; type: string; size: number } | null
  alt?: unknown
  isDecorative?: unknown
}

export type ReplaceField = 'file' | 'alt'

export type ReplaceCheck =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: Partial<Record<ReplaceField, string>> }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const checkReplace = ({ original, file, alt, isDecorative }: ReplaceInput): ReplaceCheck => {
  if (!file) return { ok: false, errors: { file: 'Choose the new file.' } }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, errors: { file: 'That file is too big — 25 MB at most.' } }
  }
  const [wrongKind] = replacementProblems(original.mimeType, file.type)
  if (wrongKind) return { ok: false, errors: { file: wrongKind.message } }

  if (original.kind === 'document') return { ok: true, data: {} }

  const decorative = isDecorative === true
  const [problem] = resourceProblems({ mimeType: file.type, alt, isDecorative: decorative }).filter(
    (p) => p.path === 'alt',
  )
  if (problem) return { ok: false, errors: { alt: problem.message } }
  return {
    ok: true,
    data: decorative ? { isDecorative: true } : { alt: text(alt), isDecorative: false },
  }
}
