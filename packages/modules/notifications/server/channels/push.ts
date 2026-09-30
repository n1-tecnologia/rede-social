import type { Tx } from '@rede-social/core/db/tenant-tx';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATIONS_QUEUES,
  notificationPushHintSchema,
  PUSH_SEND_CHUNK,
  type PushSendJob,
} from '../../contracts/index';
import type { NotificationChannel } from './types';

const log = moduleLogger('module-notifications');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One text parameter cast to `uuid[]` (the in-app adapter's rule), malformed ids dropped. */
function pgUuidArray(ids: readonly string[]): string {
  return `{${ids.filter((id) => UUID.test(id)).join(',')}}`;
}

/**
 * The `push` channel (07-06, NOTIF-03/NOTIF-04): the second adapter on the same registry as `in_app`,
 * run AFTER it (`CANONICAL_ORDER`). It never sends inside the fan-out transaction: it enqueues
 * `notifications.push-send` jobs, in the SAME transaction, so a rolled-back fan-out takes its pushes
 * with it and a retried one enqueues nothing new.
 *
 * Who is pushed:
 * - an intent that requested `in_app` pushes exactly `batch.recipients`, the users `in_app` NEWLY wrote
 *   a row for, so a retried fan-out (0 new rows) never re-pushes (T-07-39);
 * - a push-only intent (07-08's chat kinds) resolves its own `users` audience minus the exclusions; the
 *   live-membership filter is the definer's (`app.push_subscriptions_for`);
 * - an intent with `push: null` (likes, D-235) or without `push` in its channels pushes nobody.
 *
 * Before choosing, the audience's dead subscriptions are swept (`app.push_subscriptions_delete_dead`,
 * roadmap SC 4): the whole tenant for a `members` broadcast (`null`), the listed users otherwise. The
 * fan-out's live predicate has already dropped a blocked member from `recipients`, so a sweep over the
 * recipients alone could never reach their devices.
 * Recipients WITHOUT a live subscription are dropped here, so a fan-out whose recipients have no device
 * enqueues no job at all (NOTIF-03 empty). The rest are chunked by `PUSH_SEND_CHUNK` users, one job per
 * chunk, each keyed `push:<dedupeKey>:<chunk>` (the `short` policy needs a key per job).
 *
 * The rendered body travels in the job (it is at most ~100 characters and never stored in a row).
 * Logs carry the shape only: kind, counts.
 */
export const pushChannel: NotificationChannel = {
  key: 'push',
  async deliver(tx: Tx, { tenantId, intent, recipients }) {
    if (intent.push === null || !intent.channels.includes('push')) {
      return { delivered: [], skipped: 0 };
    }
    const hint = notificationPushHintSchema.safeParse(intent.push);
    if (!hint.success) {
      log.warn(
        { event: 'notifications.push.bad_hint', kind: intent.kind, tenantId },
        'push hint rejected',
      );
      return { delivered: [], skipped: 0 };
    }

    let candidates: string[];
    if (intent.channels.includes('in_app')) {
      candidates = recipients;
    } else if (intent.audience.type === 'users') {
      const excluded = new Set(intent.excludeUserIds);
      candidates = intent.audience.userIds.filter((id) => !excluded.has(id));
    } else {
      // A push-only `members` broadcast has no recipient list to push; no kind declares one.
      candidates = [];
    }

    // SC 4: drop the devices of anyone in the audience who is no longer live, BEFORE choosing.
    const sweep = intent.audience.type === 'members' ? null : pgUuidArray(intent.audience.userIds);
    await tx.execute(sql`select app.push_subscriptions_delete_dead(${sweep}::uuid[])`);
    const unique = [...new Set(candidates.filter((id) => UUID.test(id)))];
    if (unique.length === 0) return { delivered: [], skipped: 0 };

    const rows = await tx.execute<{ user_id: string }>(sql`
      select distinct user_id::text as user_id
        from app.push_subscriptions_for(${pgUuidArray(unique)}::uuid[])`);
    const withDevice = new Set(rows.map((row) => row.user_id));
    const targets = unique.filter((id) => withDevice.has(id));

    for (let index = 0; index * PUSH_SEND_CHUNK < targets.length; index += 1) {
      const userIds = targets.slice(index * PUSH_SEND_CHUNK, (index + 1) * PUSH_SEND_CHUNK);
      const job: PushSendJob = {
        tenantId,
        kind: intent.kind,
        dedupeKey: intent.dedupeKey,
        userIds,
        push: hint.data,
        attempt: 0,
      };
      await enqueueInTx(tx, NOTIFICATIONS_QUEUES.pushSend, job, {
        singletonKey: `push:${intent.dedupeKey}:${index}`,
      });
    }
    return { delivered: targets, skipped: unique.length - targets.length };
  },
};
