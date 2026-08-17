// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { Container } from '@/components/Container'
import { Stack } from '@/components/Stack'
import { VisuallyHidden } from '@/components/VisuallyHidden'

import { renderComponent } from '../../helpers/render'

/**
 * Layout primitives.
 *
 * Variants are asserted through `data-*` attributes rather than class names. Under Vitest,
 * CSS-module imports are stubbed, so a class-name assertion would be checking the stub; the
 * data attribute is the same value in jsdom, in Chromium, and in the CSS that selects on it
 * (`Container.module.css`).
 *
 * Neither component takes a `data-testid` prop — the wrapper is found through its child,
 * which is also the only way a page can find it. A test-only prop would widen an API these
 * components deliberately keep closed (no `className`, no `as`, no `role`).
 *
 * Mirroring itself is not asserted here: jsdom has no layout. RTL is verified in real
 * Chromium over every story (`tests/a11y/storybook.spec.ts`) and enforced structurally by the
 * stylelint logical-properties guardrail (`08` §7).
 */

describe('Container', () => {
  it('constrains to the reading measure by default', () => {
    const { getByText } = renderComponent(
      <Container>
        <p>Body copy</p>
      </Container>,
    )
    expect(getByText('Body copy').parentElement?.dataset.width).toBe('prose')
  })

  it('offers a wide variant for block composition', () => {
    const { getByText } = renderComponent(
      <Container width="wide">
        <p>Cards</p>
      </Container>,
    )
    expect(getByText('Cards').parentElement?.dataset.width).toBe('wide')
  })

  it('adds no landmark or semantics of its own', () => {
    // A layout wrapper that emitted a role would appear in the landmark list of every page,
    // competing with the landmarks that mean something.
    const { getByText } = renderComponent(
      <Container>
        <p>Body copy</p>
      </Container>,
    )

    const container = getByText('Body copy').parentElement
    expect(container?.tagName).toBe('DIV')
    expect(container?.getAttribute('role')).toBeNull()
  })
})

describe('Stack', () => {
  it('applies the requested spacing step', () => {
    const { getByText } = renderComponent(
      <Stack space="lg">
        <p>One</p>
      </Stack>,
    )
    expect(getByText('One').parentElement?.dataset.space).toBe('lg')
  })

  it('defaults to the medium step', () => {
    const { getByText } = renderComponent(
      <Stack>
        <p>One</p>
      </Stack>,
    )
    expect(getByText('One').parentElement?.dataset.space).toBe('md')
  })

  it('preserves child order', () => {
    // Visual order must match DOM order (1.3.2 meaningful sequence): spacing comes from
    // `gap`, never from reordering.
    const { getByText } = renderComponent(
      <Stack>
        <p>First</p>
        <p>Second</p>
      </Stack>,
    )

    const stack = getByText('First').parentElement
    expect([...(stack?.children ?? [])].map((child) => child.textContent)).toEqual([
      'First',
      'Second',
    ])
  })
})

describe('VisuallyHidden', () => {
  it('keeps its content in the accessible tree', () => {
    const { getByText } = renderComponent(<VisuallyHidden>Required</VisuallyHidden>)

    const hidden = getByText('Required')
    expect(hidden.getAttribute('aria-hidden')).toBeNull()
    expect(hidden.hasAttribute('hidden')).toBe(false)
  })

  it('is identifiable in the DOM so tests and CSS can target it', () => {
    const { getByText } = renderComponent(<VisuallyHidden>Required</VisuallyHidden>)
    expect(getByText('Required').dataset.visuallyHidden).toBe('true')
  })
})
