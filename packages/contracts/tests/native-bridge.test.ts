import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APNS_TOKEN_PATTERN,
  BRIDGE_MAX_BYTES,
  BRIDGE_VERSION,
  bridgeNativeEventSchema,
  bridgeWebMessageSchema,
  FCM_TOKEN_PATTERN,
  FEED_SNAPSHOT_MAX_POSTS,
  feedSnapshotSchema,
  PUSH_PATH,
  parseBridgeMessage,
} from '../src/native';

/**
 * 13-03 task 2 (D-600, NATIVE-05, T-13-05): both sides of the bridge, the feed snapshot, the token
 * shapes and the safe message parser. A malformed message can only be dropped, never thrown.
 */

const base = { v: 1 } as const;
const url = 'https://comunidade.cliente.com.br/inicio';
const post = {
  id: '11111111-1111-4111-8111-111111111111',
  authorName: 'Ana',
  authorAvatarUrl: 'https://cdn.example.com/a.png',
  text: 'Olá',
  media: { kind: 'image', thumbUrl: 'https://cdn.example.com/t.png' },
  likeCount: 3,
  commentCount: 1,
  createdAt: '2026-11-05T12:00:00.000Z',
};
const snapshot = { savedAt: '2026-11-05T12:00:00.000Z', posts: [post] };
const apnsToken = 'a'.repeat(64);
const fcmToken = `${'A'.repeat(60)}:${'b'.repeat(60)}`;
const device = {
  kind: 'fcm',
  token: fcmToken,
  platform: 'android',
  environment: 'production',
  appVersion: '1.0.0',
};

const minimal: Array<[string, Record<string, unknown>]> = [
  ['ready', {}],
  ['push.enable', {}],
  ['push.disable', {}],
  ['push.state.request', {}],
  ['badge.set', { count: 0 }],
  ['share', { url }],
  ['lock.set', { enabled: true }],
  ['lock.state.request', {}],
  ['snapshot.feed', snapshot],
  ['logout.done', {}],
  ['settings.open', {}],
  ['theme.changed', { theme: 'dark' }],
];

afterEach(() => vi.restoreAllMocks());

describe('constants', () => {
  it('pins the version and the byte cap', () => {
    expect(BRIDGE_VERSION).toBe(1);
    expect(BRIDGE_MAX_BYTES).toBe(65536);
    expect(FEED_SNAPSHOT_MAX_POSTS).toBe(20);
  });
});

describe('bridgeWebMessageSchema — each type validates its minimal body', () => {
  it.each(minimal)('%s', (type, body) => {
    expect(bridgeWebMessageSchema.safeParse({ ...base, type, ...body }).success).toBe(true);
  });

  it.each(minimal)('%s refuses an extra key, a wrong v and a missing type', (type, body) => {
    expect(bridgeWebMessageSchema.safeParse({ ...base, type, ...body, extra: 1 }).success).toBe(
      false,
    );
    expect(bridgeWebMessageSchema.safeParse({ v: 2, type, ...body }).success).toBe(false);
    expect(bridgeWebMessageSchema.safeParse({ v: 1, ...body }).success).toBe(false);
  });

  it('refuses a message whose type is not in the vocabulary', () => {
    expect(bridgeWebMessageSchema.safeParse({ ...base, type: 'push.state' }).success).toBe(false);
  });
});

describe('field bounds', () => {
  it('badge.set refuses a negative, a fraction and a count above 99999', () => {
    const ok = (count: number) =>
      bridgeWebMessageSchema.safeParse({ ...base, type: 'badge.set', count }).success;
    expect(ok(99999)).toBe(true);
    expect(ok(-1)).toBe(false);
    expect(ok(1.5)).toBe(false);
    expect(ok(100000)).toBe(false);
  });

  it('share refuses a non-https url and one over 2048 characters, and takes an optional title', () => {
    const ok = (body: Record<string, unknown>) =>
      bridgeWebMessageSchema.safeParse({ ...base, type: 'share', ...body }).success;
    expect(ok({ url, title: 'Título' })).toBe(true);
    expect(ok({ url: '' })).toBe(false);
    expect(ok({ url: 'http://comunidade.cliente.com.br/' })).toBe(false);
    expect(ok({ url: 'javascript:alert(1)' })).toBe(false);
    expect(ok({ url: `https://a.example.com/${'x'.repeat(2048)}` })).toBe(false);
    expect(ok({ url, title: 'x'.repeat(201) })).toBe(false);
  });

  it('theme.changed takes only light or dark', () => {
    const ok = (theme: string) =>
      bridgeWebMessageSchema.safeParse({ ...base, type: 'theme.changed', theme }).success;
    expect(ok('light')).toBe(true);
    expect(ok('dark')).toBe(true);
    expect(ok('system')).toBe(false);
  });
});

describe('feedSnapshotSchema', () => {
  const posts = (n: number) => Array.from({ length: n }, () => post);

  it('accepts 0 and exactly 20 posts and refuses 21', () => {
    expect(feedSnapshotSchema.safeParse({ ...snapshot, posts: [] }).success).toBe(true);
    expect(feedSnapshotSchema.safeParse({ ...snapshot, posts: posts(20) }).success).toBe(true);
    expect(feedSnapshotSchema.safeParse({ ...snapshot, posts: posts(21) }).success).toBe(false);
  });

  it('refuses over-long and unsafe post fields', () => {
    const bad = (patch: Record<string, unknown>) =>
      feedSnapshotSchema.safeParse({ ...snapshot, posts: [{ ...post, ...patch }] }).success;
    expect(bad({ authorName: 'x'.repeat(121) })).toBe(false);
    expect(bad({ authorName: 'x'.repeat(120) })).toBe(true);
    expect(bad({ text: 'x'.repeat(2001) })).toBe(false);
    expect(bad({ authorAvatarUrl: 'http://cdn.example.com/a.png' })).toBe(false);
    expect(bad({ authorAvatarUrl: null })).toBe(true);
    expect(bad({ media: { kind: 'image' } })).toBe(false);
    expect(bad({ media: { kind: 'audio', thumbUrl: 'https://cdn.example.com/t.png' } })).toBe(
      false,
    );
    expect(bad({ media: null })).toBe(true);
    expect(bad({ email: 'a@b.co' })).toBe(false);
    expect(bad({ likeCount: -1 })).toBe(false);
  });

  it('needs an ISO instant for savedAt and keeps the order of the posts', () => {
    expect(feedSnapshotSchema.safeParse({ ...snapshot, savedAt: 'ontem' }).success).toBe(false);
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const parsed = feedSnapshotSchema.parse({
      ...snapshot,
      posts: ids.map((id) => ({ ...post, id })),
    });
    expect(parsed.posts.map((p) => p.id)).toEqual(ids);
  });
});

describe('parseBridgeMessage', () => {
  it('returns the message for a valid JSON string', () => {
    const result = parseBridgeMessage(JSON.stringify({ ...base, type: 'badge.set', count: 4 }));
    expect(result).toEqual({ ok: true, message: { ...base, type: 'badge.set', count: 4 } });
  });

  it('is not sensitive to key order', () => {
    const result = parseBridgeMessage('{"count":4,"type":"badge.set","v":1}');
    expect(result.ok).toBe(true);
  });

  it('an empty snapshot is valid and an empty share title reads as absent', () => {
    expect(
      parseBridgeMessage(
        JSON.stringify({ ...base, type: 'snapshot.feed', savedAt: snapshot.savedAt, posts: [] }),
      ).ok,
    ).toBe(true);
    const shared = parseBridgeMessage(JSON.stringify({ ...base, type: 'share', url, title: '' }));
    expect(shared.ok).toBe(true);
    if (shared.ok && shared.message.type === 'share') expect(shared.message.title).toBeUndefined();
  });

  it('refuses the empty cases without throwing', () => {
    for (const raw of ['', '{}', '{"v":1}', null, undefined]) {
      expect(parseBridgeMessage(raw).ok).toBe(false);
    }
    expect(parseBridgeMessage(null)).toEqual({ ok: false, reason: 'not_string' });
    expect(parseBridgeMessage('')).toEqual({ ok: false, reason: 'bad_json' });
  });

  it('refuses a non-string input', () => {
    for (const raw of [42, {}, [], true, Buffer.from('{}')]) {
      expect(parseBridgeMessage(raw)).toEqual({ ok: false, reason: 'not_string' });
    }
  });

  it('caps in UTF-8 bytes BEFORE parsing, so 25,000 three-byte characters are refused', () => {
    const spy = vi.spyOn(JSON, 'parse');
    const raw = JSON.stringify({ v: 1, type: 'share', url, title: '€'.repeat(25_000) });
    expect(raw.length).toBeLessThan(BRIDGE_MAX_BYTES);
    expect(parseBridgeMessage(raw)).toEqual({ ok: false, reason: 'too_large' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a leading BOM and invalid JSON', () => {
    expect(parseBridgeMessage(`﻿${JSON.stringify({ ...base, type: 'ready' })}`).ok).toBe(false);
    expect(parseBridgeMessage('{"v":1,').ok).toBe(false);
    expect(parseBridgeMessage('{"v":1,')).toEqual({ ok: false, reason: 'bad_json' });
  });

  it('answers unknown_type for a type this version does not know, and bad_shape for a known one', () => {
    expect(parseBridgeMessage('{"v":1,"type":"teleport"}')).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
    expect(parseBridgeMessage('{"v":2,"type":"teleport","x":1}')).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
    expect(parseBridgeMessage('{"v":1,"type":"badge.set","count":-1}')).toEqual({
      ok: false,
      reason: 'bad_shape',
    });
    expect(parseBridgeMessage('[1,2]')).toEqual({ ok: false, reason: 'bad_shape' });
    expect(parseBridgeMessage('"ready"')).toEqual({ ok: false, reason: 'bad_shape' });
  });

  it('never echoes the input in the reason', () => {
    const secret = 'super-secret-token-value';
    const result = parseBridgeMessage(`{"v":1,"type":"badge.set","count":"${secret}"}`);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('parses native events with the second schema', () => {
    const result = parseBridgeMessage(
      JSON.stringify({ ...base, type: 'resume' }),
      bridgeNativeEventSchema,
    );
    expect(result.ok).toBe(true);
    expect(
      parseBridgeMessage(JSON.stringify({ ...base, type: 'ready' }), bridgeNativeEventSchema),
    ).toEqual({
      ok: false,
      reason: 'unknown_type',
    });
  });
});

describe('bridgeNativeEventSchema', () => {
  it('validates each native-to-web event', () => {
    const events: Array<Record<string, unknown>> = [
      { type: 'push.state', permission: 'granted', registered: true, device },
      { type: 'push.state', permission: 'undetermined', registered: false, device: null },
      { type: 'push.result', ok: true, permission: 'granted', device },
      { type: 'lock.state', enabled: true, available: true },
      { type: 'lock.result', ok: true, enabled: false },
      { type: 'resume' },
    ];
    for (const event of events) {
      expect(bridgeNativeEventSchema.safeParse({ ...base, ...event }).success).toBe(true);
    }
  });

  it('refuses an unknown permission and an extra key', () => {
    for (const permission of ['provisional', '', 'GRANTED']) {
      expect(
        bridgeNativeEventSchema.safeParse({
          ...base,
          type: 'push.state',
          permission,
          registered: false,
          device: null,
        }).success,
      ).toBe(false);
    }
    expect(bridgeNativeEventSchema.safeParse({ ...base, type: 'resume', extra: 1 }).success).toBe(
      false,
    );
  });

  it("refuses a device whose token does not match its kind's pattern", () => {
    const state = (d: Record<string, unknown>) =>
      bridgeNativeEventSchema.safeParse({
        ...base,
        type: 'push.state',
        permission: 'granted',
        registered: true,
        device: d,
      }).success;
    expect(state({ ...device, kind: 'apns', token: apnsToken, platform: 'ios' })).toBe(true);
    expect(state({ ...device, kind: 'apns', token: fcmToken })).toBe(false);
    expect(state({ ...device, kind: 'fcm', token: apnsToken })).toBe(false);
    expect(state({ ...device, appVersion: '1.0' })).toBe(false);
    expect(state({ ...device, email: 'a@b.co' })).toBe(false);
  });

  it('carries no message type that could hold a credential', () => {
    const text = JSON.stringify(
      [...bridgeWebMessageSchema.options, ...bridgeNativeEventSchema.options].map((o) =>
        Object.keys(o.shape),
      ),
    );
    expect(text).not.toMatch(/token|password|email|secret/i);
  });
});

describe('token and path shapes', () => {
  it('APNS_TOKEN_PATTERN takes 32..200 hex characters', () => {
    expect(APNS_TOKEN_PATTERN.test('a'.repeat(32))).toBe(true);
    expect(APNS_TOKEN_PATTERN.test('A1'.repeat(100))).toBe(true);
    expect(APNS_TOKEN_PATTERN.test('a'.repeat(31))).toBe(false);
    expect(APNS_TOKEN_PATTERN.test('a'.repeat(201))).toBe(false);
    expect(APNS_TOKEN_PATTERN.test(`${'a'.repeat(40)}g`)).toBe(false);
  });

  it('FCM_TOKEN_PATTERN takes 100..4096 characters of the allowed class', () => {
    expect(FCM_TOKEN_PATTERN.test('a'.repeat(100))).toBe(true);
    expect(FCM_TOKEN_PATTERN.test('a'.repeat(4096))).toBe(true);
    expect(FCM_TOKEN_PATTERN.test('a'.repeat(99))).toBe(false);
    expect(FCM_TOKEN_PATTERN.test('a'.repeat(4097))).toBe(false);
    expect(FCM_TOKEN_PATTERN.test(`${'a'.repeat(100)} `)).toBe(false);
  });

  it('PUSH_PATH accepts an app path and refuses anything that could leave the origin', () => {
    expect(PUSH_PATH.test('/inicio')).toBe(true);
    expect(PUSH_PATH.test('/')).toBe(true);
    for (const bad of ['//evil.com', '/\\evil', 'inicio', '/a b', 'https://evil.com']) {
      expect(PUSH_PATH.test(bad)).toBe(false);
    }
  });
});
