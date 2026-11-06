# A family calendar

**Status: Accepted.** 2026-11-06.

A household wants one calendar: the bins on Tuesday, the dentist, half term, the school play. Each
person adds to it from their own phone or computer, everyone sees the same thing, and the school's
and the swimming club's own calendars show beside it without anyone copying them in. The AI should
be able to read it, so a Job can tell the family "tomorrow: early pickup".

## Decision

1. **Events are Vault records, kept like Notes.** An event is the user's own (it shows in every
   Space, `/.vault/calendar/events/<id>.json`) or one Space's (`/.vault/spaces/<root>/calendar/…`).
   When a Space is shared (ADR-0029), its events move into its Space Library (`/calendar/events/`),
   so every member sees them and every editor changes them; a viewer only sees them. Desktop goes
   through `spaceLibrary.records(space, kind)` and the phone through `placeOf` (`recordsOf` in
   `mobile/backend/lib/vault-apps.mjs`), the kinds `events`, `feeds` and `feedCache`. An event made in
   a shared Space keeps who added it (`by`, the member's name).

2. **Times are wall time, not instants.** `start` is `YYYY-MM-DD` for an all-day event and
   `YYYY-MM-DDTHH:mm` otherwise, with no zone: "18:00" is 6pm wherever and whenever the household
   reads it, and a weekly event stays at 6pm across a clock change. Repeats (`daily`, `weekly` on some
   days, `monthly`, `yearly`, with an interval, an end day or a count) are expanded by
   `shared/calendar.mjs` `occurrences`, on the same rules on both platforms.

3. **iCal feeds are followed, and their copy is shared.** A feed is a record (`feeds`) with a link
   (`webcal://` becomes `https://`). Its events are kept as one more record beside it (`feedCache`),
   so the phone and the other members read that copy instead of each fetching it. A Device that can
   write the copy fetches it when it is more than six hours old: desktop in bg (`net.fetch`, no
   cookies, never this computer's own network, 20 s, 5 MB), the phone's UI with React Native's fetch,
   handing the text to the backend (`calendar/feedFetched`). A failed fetch keeps the last good events
   and shows the error. The reader (`parseIcs`) takes VEVENTs with dates, UTC and TZID times, RRULE
   (FREQ, INTERVAL, UNTIL, COUNT, BYDAY) and EXDATE, and skips cancelled events and alarms. Feed
   events are read-only.

4. **The AI reads it and never changes it.** `listCalendarEvents({ from, days })` is a personal
   capability behind the `calendarRead` permission, and a Job may read it (`JOB_GRANTS`, `JOB_CAPS`).
   It returns the agenda as lines (`agendaText`). It is a private read (`PRIVATE_READS`). Changing the
   calendar is the user's, on the calendar page; the AI links it (`nomad://calendar/?day=`), which
   `parseItemLink` rebuilds from the day.

5. **UI.** Desktop is `nomad://calendar` (`app/userland/calendar/`, over the internal `nomad.vault`
   `listCalendar` / `saveCalendarEvent` / … methods, `app/bg/web-apis/bg/calendar.ts`): a month, the
   selected day's agenda, the feeds, and an event dialog. The phone is `mobile/components/Calendar.tsx`
   (`RPC_APPS` `calendar`): a month to pick a day, that day, the next two weeks, the feeds, and an
   editor sheet.

## Consequences

- No public API: a site can't read the user's calendar. A later `nomad.calendar` would need its own
  permission and the API sync.
- There is no reminder at an event's time yet; a Job that reads the calendar is the way to be told.
- Times have no zone, so a family split across zones sees the same wall time. That is the common case
  for a household, and the rare other one is for a later amendment.

## Amendment: calendar drives (2026-11-06)

A club, a team or a family member can publish a calendar as a drive, and the calendar follows it
beside iCal feeds.

1. **The schema.** A drive is a calendar when its `/index.json` is
   `{ "type": "walled.garden/calendar", "title", "description"?, "color"?, "eventsPath"? }`
   (`app/lib/schemas/walled.garden/calendar.ts`). Each event is one file in `eventsPath` (`/events/`
   unless it says otherwise), `/events/<name>.json`:
   `{ "type": "walled.garden/calendar-event", "title", "start", "end"?, "allDay"?, "location"?,
   "notes"?, "repeat"?, "exclude"?, "status"? }`, in the same wall-time format and repeat rules as an
   event record (§2). The file's name is the event's uid; `status: "cancelled"` leaves it out. What
   the calendar takes from a drive is `shared/calendar.mjs` (`isCalendarManifest`,
   `calendarEventsPath`, `eventFiles`, `driveEvent`, `driveEvents`).

2. **Followed like a feed.** A drive is a feed record with `kind: 'drive'` and the drive's root
   (`hyper://<key>/`) as `url` (`sourceOf` tells the two apart from what the user pastes). Its events
   are kept in the same copy (`feedCache`), so a Space viewer and the other members read the copy.
   Following one reads it first: a drive that isn't a calendar is refused, and its title and color
   become the feed's name and color. The copy is read again after `DRIVE_TTL_MS` (five minutes; a
   drive changes as its writers add to it and costs nothing to read), on desktop in bg over
   `nomad.fs` (`readCalendarDrive` in `calendar.ts`), on the phone in its backend over the drive
   manager (`calendar/fetchDrive`). Its events are read-only here; they are changed in the drive.

3. **Finding them.** The Follow box takes an iCal link or a hyper:// address. Desktop also lists the
   calendar drives in the page's Space that the calendar doesn't follow (`listCalendarDrives`), and
   site-info shows **Follow in Calendar** on a calendar drive (`ident.calendar`), which opens
   `nomad://calendar/?follow=<drive>` with the address in the box; the user still clicks Follow. The
   phone's Follow sheet lists the calendar drives among the Space's drives (`calendar/drives`).
