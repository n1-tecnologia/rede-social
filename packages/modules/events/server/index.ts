/**
 * `@rede-social/module-events/server` — everything the API tier may touch. The app imports THIS, never a
 * file path inside the package (the `exports` map has no `./server/*`).
 */
export { generateCheckinCode, normalizeCheckinCode } from './checkin-code';
export { eventsPushCopy, eventTime, eventWhen } from './notification-copy';
export { eventsNotificationSources, reminderKind, reminderTagAndTopic } from './notifications';
export {
  armEventReminders,
  eventReminderJob,
  planEventReminders,
  type ReminderArm,
  reminderFireAtMs,
  reminderSingletonKey,
  reminderSkipReason,
  runEventReminder,
} from './reminders';
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
export { EVENTS_SYSTEM_USER_ID, eventsSystemCtx } from './system-context';
