import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { NotificationIntent } from '@rede-social/core/server/notifications/source';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { inAppChannel, USER_SIGNAL_FANOUT_MAX } from '../server/channels/in-app';

/**
 * 07 review B-WR-06: a `users` audience signals each new recipient on their own topic only up to
 * `USER_SIGNAL_FANOUT_MAX`; a larger one (an event reminder to every attendee) publishes ONE signal on
 * the tenant's `all` topic, so one delivery never bursts past the Realtime plan's message rate.
 */

const dialect = new PgDialect();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function recordingTx(delivered: string[]) {
  const signals: string[] = [];
  let first = true;
  const tx = {
    execute: async (query: SQL) => {
      if (first) {
        first = false;
        return delivered.map((user_id) => ({ user_id }));
      }
      const { params } = dialect.sqlToQuery(query);
      signals.push(String(params[0]));
      return [];
    },
  } as unknown as Tx;
  return { tx, signals };
}

const intent = (userIds: string[]): NotificationIntent => ({
  kind: 'events.reminder_1h',
  audience: { type: 'users', userIds },
  excludeUserIds: [],
  dedupeKey: 'events.reminder_1h:e1',
  subject: { type: 'event', id: uuid(999) },
  object: null,
  actorUserId: null,
  facts: {},
  channels: ['in_app'],
  push: null,
});

describe('in_app signals (B-WR-06)', () => {
  it('signals each new recipient on their own topic up to the limit', async () => {
    const users = Array.from({ length: USER_SIGNAL_FANOUT_MAX }, (_, i) => uuid(i + 1));
    const { tx, signals } = recordingTx(users);
    await inAppChannel.deliver(tx, { tenantId: uuid(0), intent: intent(users), recipients: [] });
    expect(signals).toEqual(users.map((id) => `user:${id}`));
  });

  it('above the limit publishes ONE signal on all, never one per recipient', async () => {
    const users = Array.from({ length: USER_SIGNAL_FANOUT_MAX + 1 }, (_, i) => uuid(i + 1));
    const { tx, signals } = recordingTx(users);
    await inAppChannel.deliver(tx, { tenantId: uuid(0), intent: intent(users), recipients: [] });
    expect(signals).toEqual(['all']);
  });
});
