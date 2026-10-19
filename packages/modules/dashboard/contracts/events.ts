import { z } from 'zod';

/**
 * The owner's "Eventos" contract (08.7-08). INERT RED STUB: every schema accepts nothing, so the
 * contract tests fail on their assertions until the real schemas land in the GREEN commit.
 */

/** An event's format, as `events_format_chk` allows it. */
export const EVENT_FORMATS = ['in_person', 'online'] as const;

/** Próximos eventos lists at most this many events, soonest first. */
export const OWNER_UPCOMING_EVENTS_LIMIT = 0;

export const eventsPayloadSchema = z.never();
export type EventsPayload = z.infer<typeof eventsPayloadSchema>;

export const ownerEventsAnswerSchema = z.never();
export type OwnerEventsAnswer = z.infer<typeof ownerEventsAnswerSchema>;
