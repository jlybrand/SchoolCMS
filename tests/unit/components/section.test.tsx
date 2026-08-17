// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { nextHeadingLevel } from '@/components/Heading'
import { Section } from '@/components/Section'

import { renderComponent } from '../../helpers/render'

/**
 * `Section` is where the page outline is assembled (`07` §3).
 *
 * It carries one piece of accessibility knowledge that would otherwise be re-decided by
 * every block author: a landmark is only useful if it has an accessible name. An unnamed
 * `<section>` adds a "region" to the screen-reader landmark list with nothing to identify
 * it, which is noise on a page with several blocks — so `Section` only emits a landmark when
 * it has a heading to name it with.
 */

describe('Section', () => {
  it('emits a named landmark when it has a heading', () => {
    const { getByRole } = renderComponent(
      <Section level={2} heading="Upcoming events" headingId="upcoming-events">
        <p>Content</p>
      </Section>,
    )

    const region = getByRole('region', { name: 'Upcoming events' })
    expect(region.tagName).toBe('SECTION')
    expect(getByRole('heading', { level: 2 }).textContent).toBe('Upcoming events')
  })

  it('names the landmark by reference to its own heading', () => {
    // aria-labelledby rather than aria-label: the name then stays in sync with the visible
    // heading, including once headings are translated (`08` §4).
    const { getByRole } = renderComponent(
      <Section level={2} heading="Upcoming events" headingId="upcoming-events">
        <p>Content</p>
      </Section>,
    )

    const region = getByRole('region', { name: 'Upcoming events' })
    expect(region.getAttribute('aria-labelledby')).toBe('upcoming-events')

    const heading = getByRole('heading', { level: 2 })
    expect(heading.id).toBe('upcoming-events')
  })

  it('emits no landmark when it has no heading, but still renders its content', () => {
    const { queryByRole, getByText } = renderComponent(
      <Section level={2}>
        <p>Ungrouped content</p>
      </Section>,
    )

    expect(queryByRole('region')).toBeNull()
    expect(getByText('Ungrouped content')).toBeTruthy()
  })

  it('nests without producing a heading-order violation', () => {
    /**
     * The outline is built by threading `nextHeadingLevel` down, not by React context:
     * blocks render as server components and server components have no context.
     * Prop-threading is the only mechanism that works in an RSC tree, and it keeps the level
     * a rendering decision rather than an editable field.
     */
    const outer = 2 as const
    const { getAllByRole } = renderComponent(
      <Section level={outer} heading="Athletics" headingId="athletics">
        <Section level={nextHeadingLevel(outer)} heading="Schedules" headingId="schedules">
          <p>Content</p>
        </Section>
      </Section>,
    )

    expect(getAllByRole('heading').map((heading) => heading.tagName)).toEqual(['H2', 'H3'])
  })

  it('nests landmarks so each one is reachable by its own name', () => {
    const { getByRole } = renderComponent(
      <Section level={2} heading="Athletics" headingId="athletics">
        <Section level={3} heading="Schedules" headingId="schedules">
          <p>Content</p>
        </Section>
      </Section>,
    )

    expect(getByRole('region', { name: 'Athletics' })).toBeTruthy()
    expect(getByRole('region', { name: 'Schedules' })).toBeTruthy()
  })
})
