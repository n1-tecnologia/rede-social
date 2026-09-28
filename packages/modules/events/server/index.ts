/**
 * `@rede-social/module-events/server` — everything the API tier may touch. The app imports THIS, never a
 * file path inside the package (the `exports` map has no `./server/*`).
 */
export { generateCheckinCode, normalizeCheckinCode } from './checkin-code';
export { eventsRoutes } from './routes';
export {
  checkInEvent,
  createEvent,
  enterEvent,
  getAttendanceSummary,
  getEvent,
  getEventForEdit,
  getNextEvent,
  guardIssue,
  listAttendance,
  listEvents,
  regenerateCheckinCode,
  rsvpEvent,
  setEventStatus,
  updateEvent,
} from './service';
