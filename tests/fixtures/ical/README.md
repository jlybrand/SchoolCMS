# iCal fixtures

The payloads the feed-calendar parser is tested against (CLAUDE.md: first contact with an
external format → capture the response as a fixture, then TDD against it).

- `google-us-holidays.ics` — a REAL Google Calendar public feed ("Holidays in United States",
  `calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics`),
  captured 2026-11-11 and trimmed to its header and eight 2026 events. All-day events,
  Google's escaping and line folding.
- `google-recurring.ics` — hand-written in Google's export format, for what the holiday feed
  lacks: timed events in a VTIMEZONE, a weekly RRULE with an EXDATE and a RECURRENCE-ID override,
  a UTC event, a CANCELLED event, and a multi-day all-day event.
