import { randomUUID } from 'node:crypto';
import type { TenantRole } from '@rede-social/contracts';
import { resolveBranding } from '@rede-social/contracts';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import { resolveCounters } from '@rede-social/core/server/modules/counters';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import {
  NOTIFICATIONS_QUEUES,
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_DELAYS_SECONDS,
  PUSH_SEND_JOB_KEEP,
  type PushSendJob,
  pushSendJobSchema,
} from '../../contracts/index';
import { notificationsSystemCtx } from '../system-context';
import { buildPushPayload, NEUTRAL_PUSH_ICON } from './payload';
import { type PushOutcome, pushTransport } from './transport';

const log = moduleLogger('module-notifications');

/** One live subscription as `app.push_subscriptions_for` returns it. */
type SubscriptionRow = {
  id: string;
  user_id: string;
  role: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** A text parameter cast to `uuid[]` (the in-app rule); the job schema already checked every id. */
const pgUuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/** The outcome the report definer records for a transport outcome. */
const REPORT: Record<PushOutcome, 'sent' | 'gone' | 'failed'> = {
  sent: 'sent',
  gone: 'gone',
  dropped: 'failed',
  retry: 'failed',
};

/**
 * `notifications.push-send` (07-06, NOTIF-03): delivers one intent's push to at most 100 users, in
 * the WORKER. Runs in three short steps, and never holds a transaction across the network:
 *
 * 1. **Read, in the tenant's system lane.** `app.notifications_withdrawn(dedupeKey, userIds)` first (07
 *    review B-WR-02): when the target was deleted after the fan-out and its rows were retracted, the
 *    push is withdrawn (`push.withdrawn`, nothing sent, nothing re-tried). Push-only chat kinds write no
 *    row and are never withdrawn (chat has no delete path in V1). Then
 *    `app.push_subscriptions_delete_dead(userIds)` (a user
 *    blocked after the fan-out loses their devices now, roadmap SC 4), then
 *    `app.push_subscriptions_for(userIds)` (live members only; narrowed to `subscriptionIds` on a
 *    re-try), and the tenant's display name and `icon-192` (`resolveBranding(branding).iconUrls?.i192`,
 *    else the neutral icon). A failure HERE throws: nothing was sent yet, so pg-boss may safely retry.
 * 2. **Badge and send.** Each distinct recipient's badge is `unreadNotifications + unreadConversations`
 *    from the kernel counters resolver, in a lane opened AS that recipient (the counters are owner-
 *    scoped). Each subscription then gets its own payload through `pushTransport().send`, with the
 *    hint's `TTL`, `Urgency` and `Topic`. A per-subscription failure never fails the job.
 * 3. **Report.** Each outcome goes through `app.push_subscription_report` (`sent` stamps, `gone`
 *    deletes, `dropped`/`retry` count a failure). The `retry` subscriptions, when `attempt <
 *    PUSH_MAX_ATTEMPTS`, become ONE new job carrying only their ids, `attempt + 1` and a 30 s / 2 min /
 *    8 min `startAfter`; after the third attempt they are dropped. This step logs and swallows its own
 *    failure instead of throwing: a pg-boss retry would send AGAIN to the subscriptions that already
 *    succeeded (07-06 planning decision 2).
 *
 * A malformed job is dropped with a shape-only warning (the fan-out precedent). Every log line is the
 * shape only, `{ event: 'push.sent', kind, sent, gone, dropped, retried }`: never an endpoint, a key or
 * a body (T-07-37).
 */
export async function runPushSend(raw: unknown): Promise<void> {
  const parsed = pushSendJobSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ event: 'push.bad_payload' }, 'push-send payload rejected');
    return;
  }
  const job = parsed.data;
  const { tenantId, kind, userIds, push, attempt } = job;
  const system = notificationsSystemCtx(tenantId);

  // 1. Read.
  const { withdrawn, subscriptions, tenantName, iconUrl } = await withTenantTx(
    system,
    async (tx) => {
      // 07 review B-WR-02: the body was rendered at fan-out time and may quote content deleted since
      // (a retry waits up to 8 minutes). A retracted row under this dedupe key withdraws the push.
      const retracted = await tx.execute<{ withdrawn: boolean }>(sql`
      select app.notifications_withdrawn(${job.dedupeKey}, ${pgUuidArray(userIds)}::uuid[]) as withdrawn`);
      if (retracted[0]?.withdrawn === true) {
        return { withdrawn: true, subscriptions: [], tenantName: '', iconUrl: NEUTRAL_PUSH_ICON };
      }
      await tx.execute(
        sql`select app.push_subscriptions_delete_dead(${pgUuidArray(userIds)}::uuid[])`,
      );
      const rows = await tx.execute<SubscriptionRow>(sql`
      select id::text as id, user_id::text as user_id, role, endpoint, p256dh, auth
        from app.push_subscriptions_for(${pgUuidArray(userIds)}::uuid[])`);
      const tenants = await tx.execute<{ display_name: string; branding: unknown }>(sql`
      select display_name, branding from public.tenants where id = ${tenantId}::uuid`);
      const tenant = tenants[0];
      let icon = NEUTRAL_PUSH_ICON;
      try {
        icon = resolveBranding(tenant?.branding ?? {}).iconUrls?.i192 ?? NEUTRAL_PUSH_ICON;
      } catch {
        // A malformed brand row is loud elsewhere; a push still goes out with the neutral icon.
      }
      const only = job.subscriptionIds ? new Set(job.subscriptionIds) : null;
      return {
        withdrawn: false,
        subscriptions: [...rows].filter((row) => only === null || only.has(row.id)),
        tenantName: tenant?.display_name ?? '',
        iconUrl: icon,
      };
    },
  );

  if (withdrawn) {
    log.info({ event: 'push.withdrawn', kind, users: userIds.length }, 'push withdrawn');
    return;
  }
  if (subscriptions.length === 0 || tenantName === '') {
    log.info(
      { event: 'push.sent', kind, sent: 0, gone: 0, dropped: 0, retried: 0 },
      'push delivered',
    );
    return;
  }

  // 2. Badge per recipient, then send per subscription.
  const badges = new Map<string, number>();
  for (const row of subscriptions) {
    if (badges.has(row.user_id)) continue;
    let badge = 0;
    try {
      const ctx = {
        userId: row.user_id,
        tenantId,
        role: row.role as TenantRole,
        requestId: 'job:push-badge',
        events: [],
      };
      // Its own lane, flags read first: never inside an open transaction (07 review A-WR-03).
      const counters = await resolveCounters(ctx);
      badge = counters.unreadNotifications + counters.unreadConversations;
    } catch {
      // A badge is a hint: a failed count sends 0 rather than no push.
    }
    badges.set(row.user_id, badge);
  }

  const transport = pushTransport();
  const outcomes: { id: string; outcome: PushOutcome }[] = [];
  for (const row of subscriptions) {
    let outcome: PushOutcome;
    try {
      const { json } = buildPushPayload({
        tenantName,
        iconUrl,
        hint: push,
        badge: badges.get(row.user_id) ?? 0,
      });
      outcome = await transport.send(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        json,
        { ttlSeconds: push.ttlSeconds, urgency: push.urgency, topic: push.topic },
      );
    } catch {
      outcome = 'retry';
    }
    outcomes.push({ id: row.id, outcome });
  }

  const count = (outcome: PushOutcome) => outcomes.filter((o) => o.outcome === outcome).length;
  const retryIds = outcomes.filter((o) => o.outcome === 'retry').map((o) => o.id);
  const retried = attempt < PUSH_MAX_ATTEMPTS ? retryIds.length : 0;
  if (count('dropped') > 0) {
    log.warn({ event: 'push.dropped', kind, dropped: count('dropped') }, 'push request refused');
  }

  // 3. Report, and re-enqueue the failed subscriptions only.
  try {
    await withTenantTx(system, async (tx) => {
      for (const { id, outcome } of outcomes) {
        await tx.execute(sql`select app.push_subscription_report(${id}::uuid, ${REPORT[outcome]})`);
      }
      if (retried > 0) {
        const next: PushSendJob = {
          ...job,
          userIds: [
            ...new Set(
              subscriptions.filter((row) => retryIds.includes(row.id)).map((row) => row.user_id),
            ),
          ],
          attempt: attempt + 1,
          subscriptionIds: retryIds,
        };
        await enqueueInTx(tx, NOTIFICATIONS_QUEUES.pushSend, next, {
          singletonKey: `push:${job.dedupeKey}:retry:${attempt + 1}:${randomUUID()}`,
          startAfter: PUSH_RETRY_DELAYS_SECONDS[attempt] ?? PUSH_RETRY_DELAYS_SECONDS[0],
          ...PUSH_SEND_JOB_KEEP,
        });
      }
    });
  } catch {
    log.error({ event: 'push.report_failed', kind }, 'push outcomes not recorded');
  }

  log.info(
    {
      event: 'push.sent',
      kind,
      sent: count('sent'),
      gone: count('gone'),
      dropped: count('dropped'),
      retried,
    },
    'push delivered',
  );
}

/** The worker's job definition (`notificationsModule.jobs`). */
export const pushSendJob: JobDefinition<PushSendJob> = {
  name: NOTIFICATIONS_QUEUES.pushSend,
  handler: (raw) => runPushSend(raw),
};
