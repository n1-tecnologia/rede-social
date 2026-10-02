import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { notificationsModule } from '../module';
import { createMembershipBlockedHandler, type LaneRunner } from '../server/membership-blocked';
import { NOTIFICATIONS_SYSTEM_USER_ID } from '../server/system-context';

/**
 * 08-04 (MODER-02 "revoked immediately", T-08-24): the `membership.blocked` subscriber, with a stubbed
 * lane. Both steps run, each in its own lane call; a failing first step still attempts the second;
 * nothing ever throws to the bus; the log lines carry ids only.
 */

const dialect = new PgDialect();
const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const MEMBERSHIP = '00000000-0000-4000-8000-000000000003';
const payload = { tenantId: TENANT, userId: USER, membershipId: MEMBERSHIP };

type Call = { ctx: RequestContext; sql: string; params: unknown[] };

function recordingLane(failFirst = false): { run: LaneRunner; calls: Call[] } {
  const calls: Call[] = [];
  const run: LaneRunner = async (ctx, fn) => {
    const index = calls.length;
    const tx = {
      execute: async (query: SQL) => {
        const { sql, params } = dialect.sqlToQuery(query);
        calls.push({ ctx, sql, params });
        if (failFirst && index === 0) throw new Error('boom');
        return [{ removed: 2 }];
      },
    } as unknown as Tx;
    return fn(tx);
  };
  return { run, calls };
}

const quietLogger = () => ({ info: vi.fn(), error: vi.fn() });

describe('onMembershipBlocked', () => {
  it('is registered on the manifest for membership.blocked', () => {
    expect(notificationsModule.events?.map((subscription) => subscription.event)).toContain(
      'membership.blocked',
    );
  });

  it('deletes the member’s dead push devices, then nudges their user topic, in the event’s tenant', async () => {
    const { run, calls } = recordingLane();
    const logger = quietLogger();
    await createMembershipBlockedHandler(run, logger)(payload);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain('app.push_subscriptions_delete_dead');
    expect(calls[0]?.params).toEqual([USER]);
    expect(calls[1]?.sql).toContain('app.realtime_signal');
    expect(calls[1]?.params.slice(0, 2)).toEqual([`user:${USER}`, 'notifications.changed']);
    for (const call of calls) {
      expect(call.ctx.tenantId).toBe(TENANT);
      expect(call.ctx.userId).toBe(NOTIFICATIONS_SYSTEM_USER_ID);
    }
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notifications.membership_blocked', devicesRemoved: 2 }),
      expect.any(String),
    );
  });

  it('a failing cleanup is logged with ids only and the nudge is still attempted; nothing throws', async () => {
    const { run, calls } = recordingLane(true);
    const logger = quietLogger();
    await expect(createMembershipBlockedHandler(run, logger)(payload)).resolves.toBeUndefined();

    expect(calls.map((call) => call.sql.includes('realtime_signal'))).toEqual([false, true]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields] = logger.error.mock.calls[0] ?? [];
    expect(fields).toMatchObject({
      event: 'notifications.membership_blocked_failed',
      step: 'push_cleanup',
      tenantId: TENANT,
      membershipId: MEMBERSHIP,
    });
  });

  it('a failing nudge is logged and swallowed too', async () => {
    const run: LaneRunner = async (_ctx, fn) =>
      fn({
        execute: async (query: SQL) => {
          if (dialect.sqlToQuery(query).sql.includes('realtime_signal')) throw new Error('down');
          return [{ removed: 0 }];
        },
      } as unknown as Tx);
    const logger = quietLogger();
    await expect(createMembershipBlockedHandler(run, logger)(payload)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'realtime_nudge' }),
      expect.any(String),
    );
  });
});
