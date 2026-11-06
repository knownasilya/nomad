import { z } from 'zod';

// A drive that is a calendar (its /index.json). Nomad's Calendar can follow one beside iCal feeds
// (ADR-0042 amendment): it reads each event file in `eventsPath` ('/events/' unless set). The rules
// the Calendar reads them by are shared/calendar.mjs (isCalendarManifest, driveEvent).
export const CalendarSchema = z.object({
  type: z.literal('walled.garden/calendar'),
  title: z.string().max(280),
  description: z.string().max(1000).optional(),
  // The color the calendar shows its events in, '#rrggbb'.
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  // The folder of event files, one walled.garden/calendar-event per .json file. Default '/events/'.
  eventsPath: z.string().max(200).optional(),
  icon: z.string().optional(),
  // Discovery vocabulary (ADR-0016), as on a Feed.
  indexable: z.boolean().optional(),
  topics: z.array(z.string().max(40)).max(5).optional(),
  keywords: z.array(z.string().max(40)).max(12).optional(),
});

export type Calendar = z.infer<typeof CalendarSchema>;

// A day 'YYYY-MM-DD', or a wall time 'YYYY-MM-DDTHH:mm' with no zone: "18:00" is 6pm for whoever reads it.
const WallTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);

// One event of a calendar drive: /events/<name>.json. The file's name is its id.
export const CalendarEventSchema = z.object({
  type: z.literal('walled.garden/calendar-event'),
  title: z.string().max(200),
  // A day for an all-day event, a day and time otherwise.
  start: WallTime,
  // The last day of an all-day event, or the time a timed one ends.
  end: WallTime.optional(),
  // Defaults to whether `start` is a day without a time.
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  repeat: z
    .object({
      freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
      interval: z.number().int().min(1).max(99).optional(),
      // The last day it can happen on.
      until: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      count: z.number().int().min(1).max(1000).optional(),
      // For a weekly repeat: the days it happens on, Sunday 0 to Saturday 6.
      byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    })
    .optional(),
  // Times of a repeat that don't happen (as `start` would be for them, or just the day).
  exclude: z.array(WallTime).max(100).optional(),
  // 'cancelled' leaves the event off the calendar.
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
