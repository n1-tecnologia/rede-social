import type { NotificationSource } from '@rede-social/core/server/notifications/source';

/** INERT STUB (08.6-05 Task 3 RED): the reminder source lands in the GREEN commit. */
export function liveReminderTagAndTopic(_liveId: string): { tag: string; topic: string } {
  return { tag: '', topic: '' };
}

export const COURSES_REMINDER_TTL_MIN_SECONDS = 60;

export const coursesNotificationSources = [
  {
    event: 'course.live_reminder_due',
    resolve: async () => [],
  } satisfies NotificationSource<'course.live_reminder_due'>,
] as NotificationSource[];
