import type { Tx } from '@rede-social/core/db/tenant-tx';
import { describe, expect, it } from 'vitest';
import { SOCIAL_NOTIFICATION_KINDS } from '../contracts/index';
import { socialNotificationSources } from '../server/notifications';

/**
 * 11-11 (D-727, D-726): the `social.followed` source, pinned with a fake `tx` that answers the one statement the
 * resolver runs. The SQL itself (the open-pair definer, the tenant pin) is proved end to end by
 * `apps/api/tests/integration/direct-notifications.test.ts`.
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const FOLLOWER = '11111111-1111-4111-8111-111111111111';
const FOLLOWEE = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP = '33333333-3333-4333-8333-333333333333';

type Row = { membership_id: string; pair_open: boolean | null };

function fakeTx(rows: Row[], seen: string[] = []): Tx {
  return {
    execute: async (query: unknown) => {
      seen.push(JSON.stringify(query));
      return rows;
    },
  } as unknown as Tx;
}

const source = socialNotificationSources[0];
if (!source) throw new Error('social declares no notification source');

const payload = { tenantId: T, followerUserId: FOLLOWER, followeeUserId: FOLLOWEE };
const meta = { sinkAt: '2026-11-19T12:00:00.000Z' };

describe('socialNotificationSources (D-727)', () => {
  it('declares exactly one source, for social.followed', () => {
    expect(socialNotificationSources).toHaveLength(1);
    expect(source.event).toBe('social.followed');
    expect(SOCIAL_NOTIFICATION_KINDS.followed).toBe('social.followed');
  });

  it('builds the intent: the followee only, the follower excluded, one key per ordered pair, the bell only, no push', async () => {
    const intents = await source.resolve(
      fakeTx([{ membership_id: MEMBERSHIP, pair_open: true }]),
      payload,
      meta,
    );
    expect(intents).toEqual([
      {
        kind: 'social.followed',
        audience: { type: 'users', userIds: [FOLLOWEE] },
        excludeUserIds: [FOLLOWER],
        dedupeKey: `social.followed:${FOLLOWER}:${FOLLOWEE}`,
        subject: { type: 'membership', id: MEMBERSHIP },
        object: null,
        actorUserId: FOLLOWER,
        facts: { membershipId: MEMBERSHIP },
        channels: ['in_app'],
        push: null,
      },
    ]);
  });

  it('facts hold the follower membership id and nothing else (no name, no excerpt)', async () => {
    const [intent] = await source.resolve(
      fakeTx([{ membership_id: MEMBERSHIP, pair_open: true }]),
      payload,
      meta,
    );
    expect(Object.keys(intent?.facts ?? {})).toEqual(['membershipId']);
  });

  it('the key is the same for a follow, an unfollow and a follow again (the unique row notifies once per pair)', async () => {
    const run = async () =>
      (
        await source.resolve(
          fakeTx([{ membership_id: MEMBERSHIP, pair_open: true }]),
          payload,
          meta,
        )
      )[0]?.dedupeKey;
    expect(await run()).toBe(await run());
  });

  it('drops the intent when the pair is not open (blocked, social off, a staff or removed member)', async () => {
    for (const open of [false, null]) {
      expect(
        await source.resolve(
          fakeTx([{ membership_id: MEMBERSHIP, pair_open: open }]),
          payload,
          meta,
        ),
      ).toEqual([]);
    }
  });

  it('drops the intent when the follower has no live member membership', async () => {
    expect(await source.resolve(fakeTx([]), payload, meta)).toEqual([]);
  });

  it('runs ONE statement, tenant-pinned by the payload', async () => {
    const seen: string[] = [];
    await source.resolve(fakeTx([], seen), payload, meta);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(T);
  });
});
