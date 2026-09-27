/**
 * `@tria/module-events/server` — everything the API tier may touch. The app imports THIS, never a
 * file path inside the package (the `exports` map has no `./server/*`).
 */
export { generateCheckinCode, normalizeCheckinCode } from './checkin-code';
export { eventsRoutes } from './routes';
export { createEvent, getEvent, guardIssue, listEvents, rsvpEvent } from './service';
