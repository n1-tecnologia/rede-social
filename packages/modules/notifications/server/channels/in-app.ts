import { REALTIME_EVENTS, topicSuffix } from '@rede-social/contracts/realtime';
import { sql } from 'drizzle-orm';
import type { NotificationChannel } from './types';

/**
 * The `in_app` channel (NOTIF-01): one `app.notifications_fanout` call per intent, then ONE signal.
 *
 * - The definer (`*_notifications_functions.sql`) inserts the rows in the caller's tenant only, under
 *   the live-membership predicate, and `returning user_id` hands back ONLY the newly inserted
 *   recipients (a retried job gets `[]` and signals nobody).
 * - A `members` audience publishes ONE signal on `tenant:<t>:all` (RESEARCH Pattern 4: never one per
 *   member, the Free plan's 100 msg/s); a `users` audience publishes once per new recipient on
 *   `tenant:<t>:user:<uid>`, up to `USER_SIGNAL_FANOUT_MAX` recipients. Above that (a reminder to a
 *   400-person event, 07 review B-WR-06) it publishes ONE signal on `all` instead: one burst of
 *   per-user messages in a transaction would exceed the plan's rate and get chat's signals throttled
 *   tenant-wide. A member with no new row just refetches a count, which is cheap.
 * - The signal payload is `{ kind }` and nothing else (ids-only; `realtime.send` adds the message's
 *   own `id`). Every reader refetches through the API.
 */
/** The most per-user signals one delivery publishes before it falls back to one `all` signal. */
export const USER_SIGNAL_FANOUT_MAX = 20;

export const inAppChannel: NotificationChannel = {
  key: 'in_app',
  async deliver(tx, { intent }) {
    const { audience } = intent;
    const userIds = audience.type === 'users' ? audience.userIds : [];
    const rows = await tx.execute<{ user_id: string }>(sql`
      select user_id
        from app.notifications_fanout(
          ${audience.type}::text,
          ${pgUuidArray(userIds)}::uuid[],
          ${pgUuidArray(intent.excludeUserIds)}::uuid[],
          ${intent.kind}::text,
          ${intent.dedupeKey}::text,
          ${intent.subject.type}::text,
          ${intent.subject.id}::uuid,
          ${intent.object?.type ?? null}::text,
          ${intent.object?.id ?? null}::uuid,
          ${intent.actorUserId}::uuid,
          ${JSON.stringify(intent.facts)}::jsonb
        )`);
    const delivered = rows.map((row) => row.user_id);

    if (delivered.length > 0) {
      const signal = JSON.stringify({ kind: intent.kind });
      if (audience.type === 'members' || delivered.length > USER_SIGNAL_FANOUT_MAX) {
        await tx.execute(
          sql`select app.realtime_signal(${topicSuffix.all()}, ${REALTIME_EVENTS.notificationsChanged}, ${signal}::jsonb)`,
        );
      } else {
        for (const userId of delivered) {
          await tx.execute(
            sql`select app.realtime_signal(${topicSuffix.user(userId)}, ${REALTIME_EVENTS.notificationsChanged}, ${signal}::jsonb)`,
          );
        }
      }
    }
    return { delivered, skipped: 0 };
  },
};

/**
 * A Postgres array literal of uuids. postgres.js binds a JS array as a parameter only through its own
 * typed helper, so the ids travel as ONE text parameter cast to `uuid[]` (the stories precedent).
 * Every element is a uuid the producer read from its own tables; anything else is dropped here, so a
 * malformed id can never abort the job at the cast (a retry would hit the same shape forever).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function pgUuidArray(ids: readonly string[]): string {
  return `{${ids.filter((id) => UUID.test(id)).join(',')}}`;
}
