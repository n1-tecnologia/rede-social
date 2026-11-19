import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { SOCIAL_NOTIFICATION_KINDS, type SocialFollowed } from '../contracts/index';

/**
 * The social module's notification source (11-11, D-727): the followee's bell says "começou a te seguir". The app
 * registry registers this list on the kernel seam through the manifest; the notifications module never imports this
 * package and this package never imports it (MOD-02).
 *
 * `resolve` runs in the WORKER, inside the tenant lane of the payload's tenant (`notificationsSystemCtx`, the zero
 * system user), and returns intents: data, never a stored sentence.
 *
 * ONE ROW PER ORDERED PAIR. The dedupe key is `social.followed:{follower}:{followee}`, so a follow, an unfollow and a
 * follow again produce the same key and the unique `(tenant_id, user_id, dedupe_key)` row notifies once within the
 * 90-day prune horizon (Open Question 3: accepted, no extra table). The row is never retracted when the follow is undone.
 *
 * NEVER PUSHED, NEVER TO A BLOCKED PAIR. `channels: ['in_app']` and `push: null` (a like's shape, D-235). The pair is
 * asked at fan-out time through `app.social_pair_open`, a definer that answers the worker lane only: `social` is on
 * for the tenant, both users are live `member`s (staff never take part, D-482) and no block stands in either
 * direction. A pair blocked between the follow and the fan-out, a tenant that turned `social` off and a removed member
 * therefore produce no row.
 */

type FollowerRow = {
  /** The follower's live `member` membership id: the one fact the web builds their profile link from (UI-D-875). */
  membership_id: string;
  pair_open: boolean | null;
};

async function resolveFollowed(tx: Tx, payload: SocialFollowed): Promise<NotificationIntent[]> {
  // One statement: the follower's live `member` membership in the payload's tenant, and the open-pair answer. A
  // follower with no such membership selects no row, which is the same empty answer as a pair that is not open.
  const rows = await tx.execute<FollowerRow>(sql`
    select m.id as membership_id,
           app.social_pair_open(${payload.followerUserId}::uuid, ${payload.followeeUserId}::uuid)
             as pair_open
      from memberships m
     where m.tenant_id = ${payload.tenantId}::uuid
       and m.user_id = ${payload.followerUserId}::uuid
       and m.role = 'member'
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
     limit 1`);
  const row = rows[0];
  if (row?.pair_open !== true) return [];

  return [
    {
      kind: SOCIAL_NOTIFICATION_KINDS.followed,
      audience: { type: 'users', userIds: [payload.followeeUserId] },
      excludeUserIds: [payload.followerUserId],
      dedupeKey: `${SOCIAL_NOTIFICATION_KINDS.followed}:${payload.followerUserId}:${payload.followeeUserId}`,
      subject: { type: 'membership', id: row.membership_id },
      object: null,
      actorUserId: payload.followerUserId,
      // An id and nothing else: no name, no excerpt (the web renders the sentence and the link from it).
      facts: { membershipId: row.membership_id },
      channels: ['in_app'],
      push: null,
    },
  ];
}

export const socialNotificationSources = [
  {
    event: 'social.followed',
    resolve: (tx, payload) => resolveFollowed(tx, payload),
  } satisfies NotificationSource<'social.followed'>,
] as NotificationSource[];
