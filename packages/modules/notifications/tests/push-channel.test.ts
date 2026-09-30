import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { NotificationIntent } from '@rede-social/core/server/notifications/source';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The push adapter (07-06) without a database: which recipients become `notifications.push-send`
 * jobs, how they are chunked and keyed, and what never enqueues (likes, empty fan-outs, recipients
 * without a device). The SQL it runs is the definers' business (pgTAP 153, `push.test.ts`); here the
 * transaction answers by call order: the dead-subscription sweep, then `app.push_subscriptions_for`.
 */

const enqueueInTx = vi.fn(async () => 'job-id');
vi.mock('@rede-social/core/server/jobs/boss', () => ({ enqueueInTx }));
const warn = vi.fn();
vi.mock('@rede-social/core/server/logging', () => ({
  moduleLogger: () => ({ warn, info: vi.fn(), error: vi.fn() }),
}));

const { pushChannel } = await import('../server/channels/push');

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const hint: NonNullable<NotificationIntent['push']> = {
  title: 'tenant',
  body: 'Novo post: Olá',
  url: '/post/p1',
  tag: 'feed-post',
  topic: 'feed-post',
  ttlSeconds: 86_400,
  urgency: 'normal',
  renotify: false,
};

const intent = (over: Partial<NotificationIntent> = {}): NotificationIntent => ({
  kind: 'feed.post',
  audience: { type: 'members' },
  excludeUserIds: [],
  dedupeKey: 'feed.post:p1',
  subject: { type: 'post', id: 'p1' },
  object: null,
  actorUserId: null,
  facts: {},
  channels: ['in_app', 'push'],
  push: hint,
  ...over,
});

/** A transaction whose SECOND execute (the device lookup) answers `withDevice` as rows. */
function txWithDevices(withDevice: string[]) {
  const execute = vi.fn(async () => [] as unknown[]);
  execute.mockResolvedValueOnce([]);
  execute.mockResolvedValueOnce(withDevice.map((user_id) => ({ user_id })));
  return { tx: { execute } as unknown as Tx, execute };
}

beforeEach(() => {
  enqueueInTx.mockClear();
  warn.mockReset();
});

describe('pushChannel', () => {
  it('D-235: an intent with push: null (likes) enqueues nothing and touches no table', async () => {
    const { tx, execute } = txWithDevices([uuid(1)]);
    const result = await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent({ kind: 'feed.comment_liked', channels: ['in_app'], push: null }),
      recipients: [uuid(1)],
    });
    expect(result).toEqual({ delivered: [], skipped: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(enqueueInTx).not.toHaveBeenCalled();
  });

  it('a hint without push in its channels enqueues nothing', async () => {
    const { tx } = txWithDevices([uuid(1)]);
    await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent({ channels: ['in_app'] }),
      recipients: [uuid(1)],
    });
    expect(enqueueInTx).not.toHaveBeenCalled();
  });

  it('a retried fan-out (in_app delivered nobody) enqueues nothing', async () => {
    const { tx } = txWithDevices([uuid(1)]);
    const result = await pushChannel.deliver(tx, { tenantId: T, intent: intent(), recipients: [] });
    expect(result.delivered).toEqual([]);
    expect(enqueueInTx).not.toHaveBeenCalled();
  });

  it('NOTIF-03 empty: recipients without a device enqueue no job', async () => {
    const { tx } = txWithDevices([]);
    const result = await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent(),
      recipients: [uuid(1), uuid(2)],
    });
    expect(result).toEqual({ delivered: [], skipped: 2 });
    expect(enqueueInTx).not.toHaveBeenCalled();
  });

  it('only recipients with a device are enqueued, keyed push:<dedupeKey>:0, with attempt 0', async () => {
    const { tx } = txWithDevices([uuid(2)]);
    const result = await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent(),
      recipients: [uuid(1), uuid(2)],
    });
    expect(result).toEqual({ delivered: [uuid(2)], skipped: 1 });
    expect(enqueueInTx).toHaveBeenCalledTimes(1);
    expect(enqueueInTx).toHaveBeenCalledWith(
      tx,
      'notifications.push-send',
      {
        tenantId: T,
        kind: 'feed.post',
        dedupeKey: 'feed.post:p1',
        userIds: [uuid(2)],
        push: hint,
        attempt: 0,
      },
      { singletonKey: 'push:feed.post:p1:0' },
    );
  });

  it('chunks 250 recipients into jobs of at most 100 users, one key per chunk', async () => {
    const all = Array.from({ length: 250 }, (_, i) => uuid(i + 1));
    const { tx } = txWithDevices(all);
    await pushChannel.deliver(tx, { tenantId: T, intent: intent(), recipients: all });
    const calls = enqueueInTx.mock.calls as unknown as [
      Tx,
      string,
      { userIds: string[] },
      { singletonKey: string },
    ][];
    expect(calls.map((call) => call[2].userIds.length)).toEqual([100, 100, 50]);
    expect(calls.map((call) => call[3].singletonKey)).toEqual([
      'push:feed.post:p1:0',
      'push:feed.post:p1:1',
      'push:feed.post:p1:2',
    ]);
    expect(new Set(calls.flatMap((call) => call[2].userIds)).size).toBe(250);
  });

  it('a push-only users intent resolves its own audience minus the exclusions', async () => {
    const { tx, execute } = txWithDevices([uuid(1), uuid(3)]);
    await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent({
        channels: ['push'],
        audience: { type: 'users', userIds: [uuid(1), uuid(2), uuid(3)] },
        excludeUserIds: [uuid(2)],
      }),
      recipients: [],
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(enqueueInTx).toHaveBeenCalledTimes(1);
    expect(
      (enqueueInTx.mock.calls[0] as unknown as [Tx, string, { userIds: string[] }])[2].userIds,
    ).toEqual([uuid(1), uuid(3)]);
  });

  it('a hint whose Topic is not a valid Web Push Topic is logged and never enqueued', async () => {
    const { tx } = txWithDevices([uuid(1)]);
    await pushChannel.deliver(tx, {
      tenantId: T,
      intent: intent({
        push: { ...hint, topic: 'events-reminder-0123456789abcdef0123456789abcdef' },
      }),
      recipients: [uuid(1)],
    });
    expect(enqueueInTx).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'notifications.push.bad_hint' }),
      expect.any(String),
    );
  });
});
