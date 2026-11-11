import { getPayload } from 'payload'

import { ensureMainCalendars } from '../src/collections/hooks/event-hooks'
import config from '../src/payload.config'

/**
 * Gives every site made before calendars existed its own calendar (Jason, 2026-10-28: "each site
 * gets its own main calendar automatically"). A new site gets one from `makeMainCalendar`; this is
 * for the rest — `dd2_dev`, and production once, at the deploy that brings events.
 *
 * `pnpm calendars:backfill`. Idempotent: a site that has its calendar is left alone. Touches
 * nothing else, unlike the seed, which also restates the seeded pages.
 */
const run = async () => {
  const payload = await getPayload({ config })
  const made = await ensureMainCalendars(payload)
  // console, not payload.logger: the logger writes asynchronously and `exit` can drop the line.
  console.log(
    made.length === 0
      ? 'every site already has its calendar'
      : `made calendars for ${made.join(', ')}`,
  )
  process.exit(0)
}

await run()
