import type { Tx } from '@rede-social/core/db/tenant-tx';
import type { NotificationIntent } from '@rede-social/core/server/notifications/source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NOTIF-04's seam (RESEARCH Pattern 7), pinned without a database: the registry's lookups, the
 * canonical `in_app` then `push` order, in-app's `delivered` becoming the next channel's recipients,
 * and an unregistered requested key logged as `notifications.channel_unavailable` without failing.
 */

const warn = vi.fn();
vi.mock('@rede-social/core/server/logging', () => ({
  moduleLogger: () => ({ warn, info: vi.fn(), error: vi.fn() }),
}));

const { channel, deliverIntent, registerChannel, registeredChannels, resetChannelsForTest } =
  await import('../server/channels/registry');

const tx = {} as Tx;
const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';

const intent = (channels: NotificationIntent['channels']): NotificationIntent => ({
  kind: 'feed.post',
  audience: { type: 'members' },
  excludeUserIds: [],
  dedupeKey: 'feed.post:p1',
  subject: { type: 'post', id: 'p1' },
  object: null,
  actorUserId: null,
  facts: {},
  channels,
  push: null,
});

beforeEach(() => {
  resetChannelsForTest();
  warn.mockReset();
});
afterEach(() => resetChannelsForTest());

describe('channel registry', () => {
  it('channel(key) throws for an unregistered key', () => {
    expect(() => channel('push')).toThrow('channel push not registered');
  });

  it('registeredChannels keeps only registered keys, in canonical in_app, push order', () => {
    const inApp = { key: 'in_app' as const, deliver: vi.fn() };
    const push = { key: 'push' as const, deliver: vi.fn() };
    registerChannel(push);
    registerChannel(inApp);
    expect(registeredChannels(['push', 'in_app']).map((c) => c.key)).toEqual(['in_app', 'push']);
    expect(registeredChannels(['push']).map((c) => c.key)).toEqual(['push']);
    resetChannelsForTest();
    registerChannel(inApp);
    expect(registeredChannels(['in_app', 'push']).map((c) => c.key)).toEqual(['in_app']);
  });

  it("hands in_app's delivered list to the next channel as its recipients", async () => {
    const pushDeliver = vi.fn(async () => ({ delivered: [], skipped: 0 }));
    registerChannel({
      key: 'in_app',
      deliver: vi.fn(async () => ({ delivered: ['u1', 'u2'], skipped: 0 })),
    });
    registerChannel({ key: 'push', deliver: pushDeliver });
    const result = await deliverIntent(tx, T, intent(['in_app', 'push']));
    expect(result.delivered.in_app).toEqual(['u1', 'u2']);
    expect(pushDeliver).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ recipients: ['u1', 'u2'] }),
    );
  });

  it('a push-only intent reaches push with empty recipients', async () => {
    const pushDeliver = vi.fn(async () => ({ delivered: [], skipped: 0 }));
    registerChannel({ key: 'push', deliver: pushDeliver });
    await deliverIntent(tx, T, intent(['push']));
    expect(pushDeliver).toHaveBeenCalledWith(tx, expect.objectContaining({ recipients: [] }));
  });

  it('an intent listing an unregistered push is delivered in-app and logs channel_unavailable', async () => {
    const inAppDeliver = vi.fn(async () => ({ delivered: ['u1'], skipped: 0 }));
    registerChannel({ key: 'in_app', deliver: inAppDeliver });
    const result = await deliverIntent(tx, T, intent(['in_app', 'push']));
    expect(inAppDeliver).toHaveBeenCalledTimes(1);
    expect(result.delivered).toEqual({ in_app: ['u1'] });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'notifications.channel_unavailable',
        key: 'push',
        kind: 'feed.post',
      }),
      expect.any(String),
    );
  });
});

/**
 * 07-06 assumption-delta decision (`promote`): the delivery channel is a registry noun, not a special
 * path. This goes red the moment a plan adds a delivery path outside `registerChannel`.
 */
describe('assumption-delta invariant: every delivery goes through the registry', () => {
  it('importing the server entry registers an adapter for EVERY channel key, in canonical order', async () => {
    vi.resetModules();
    await import('../server/index');
    const fresh = await import('../server/channels/registry');
    expect(fresh.CHANNEL_KEYS).toEqual(['in_app', 'push']);
    for (const key of fresh.CHANNEL_KEYS) {
      expect(fresh.channel(key).key).toBe(key);
    }
    expect(fresh.registeredChannels([...fresh.CHANNEL_KEYS]).map((c) => c.key)).toEqual([
      'in_app',
      'push',
    ]);
  });

  it('for every key, an intent that lists it is delivered through that adapter and no other', async () => {
    const { CHANNEL_KEYS } = await import('../server/channels/registry');
    for (const key of CHANNEL_KEYS) {
      resetChannelsForTest();
      const spies = Object.fromEntries(
        CHANNEL_KEYS.map((k) => [k, vi.fn(async () => ({ delivered: [], skipped: 0 }))]),
      );
      for (const k of CHANNEL_KEYS) registerChannel({ key: k, deliver: spies[k] as never });
      await deliverIntent(tx, T, intent([key]));
      for (const k of CHANNEL_KEYS) {
        expect(spies[k], `${key} -> ${k}`).toHaveBeenCalledTimes(k === key ? 1 : 0);
      }
    }
  });

  it('every unregistered key throws from channel() and is skipped (logged) by deliverIntent', async () => {
    const { CHANNEL_KEYS } = await import('../server/channels/registry');
    for (const key of CHANNEL_KEYS) {
      resetChannelsForTest();
      warn.mockReset();
      expect(() => channel(key)).toThrow(`channel ${key} not registered`);
      await expect(deliverIntent(tx, T, intent([key]))).resolves.toEqual({ delivered: {} });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'notifications.channel_unavailable', key }),
        expect.any(String),
      );
    }
  });

  it("push receives ONLY in_app's newly delivered recipients, never the whole audience", async () => {
    const pushDeliver = vi.fn(async () => ({ delivered: [], skipped: 0 }));
    registerChannel({
      key: 'in_app',
      deliver: vi.fn(async () => ({ delivered: ['u2'], skipped: 0 })),
    });
    registerChannel({ key: 'push', deliver: pushDeliver });
    await deliverIntent(tx, T, {
      ...intent(['in_app', 'push']),
      audience: { type: 'users', userIds: ['u1', 'u2', 'u3'] },
    });
    expect(pushDeliver).toHaveBeenCalledTimes(1);
    expect(pushDeliver).toHaveBeenCalledWith(tx, expect.objectContaining({ recipients: ['u2'] }));
  });
});
