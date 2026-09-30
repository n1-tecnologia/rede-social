import { createECDH, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';

/**
 * The real transport pinned without a network (07-06 Task 3):
 *
 * - `webpush.generateRequestDetails` (the REAL one) yields exactly the headers every push hint needs:
 *   `TTL`, `Urgency`, `Topic`, `Content-Encoding: aes128gcm` and a `vapid t=…, k=…` Authorization whose
 *   JWT `aud` is the endpoint's origin (RESEARCH Pattern 10).
 * - `webPushTransport` maps the push service's status matrix, with `sendNotification` mocked at the
 *   module boundary (every other `web-push` export stays real).
 * - The fake transport honours `/status/<code>` and records every send.
 */

const { sendNotification, env } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  env: {
    PUSH_TRANSPORT: 'fake' as 'fake' | 'webpush',
    VAPID_PUBLIC_KEY: 'test-public-key',
    VAPID_PRIVATE_KEY: 'test-private-key',
    VAPID_SUBJECT: 'mailto:ops@rede-social.test',
  },
}));

vi.mock('web-push', async (importOriginal) => {
  const mod = (await importOriginal()) as { default?: typeof webpush } & typeof webpush;
  const real = mod.default ?? mod;
  return { ...real, default: { ...real, sendNotification } };
});
vi.mock('@rede-social/core/server/env', () => ({ env }));

const {
  fakePushOutbox,
  fakePushTransport,
  outcomeForStatus,
  PUSH_SEND_TIMEOUT_MS,
  pushTransport,
  resetFakePushOutbox,
  webPushTransport,
} = await import('../server/push/transport');

/** A browser-shaped subscription: a real uncompressed P-256 point and 16 random auth bytes. */
function subscription(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

/** The JWT claims inside a `vapid t=<jwt>, k=<key>` Authorization header. */
function vapidClaims(authorization: string): { aud: string; exp: number; sub: string } {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
  if (!match?.[1]) throw new Error(`not a vapid header: ${authorization}`);
  const [, payload] = match[1].split('.');
  return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
}

const HINTS = [
  {
    name: 'broadcast (feed-post)',
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    opts: { TTL: 86_400, urgency: 'normal' as const, topic: 'feed-post' },
  },
  {
    name: 'reminder (32-hex topic, high)',
    endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
    opts: { TTL: 3_600, urgency: 'high' as const, topic: '0123456789abcdef0123456789abcdef' },
  },
  {
    name: 'chat (conversation topic, high, 3 days)',
    endpoint: 'https://web.push.apple.com/QGz1-xyz',
    opts: { TTL: 259_200, urgency: 'high' as const, topic: 'fedcba9876543210fedcba9876543210' },
  },
];

describe('generateRequestDetails: deterministic Web Push headers per hint', () => {
  const vapid = webpush.generateVAPIDKeys();
  const vapidDetails = {
    subject: 'mailto:ops@rede-social.test',
    publicKey: vapid.publicKey,
    privateKey: vapid.privateKey,
  };

  for (const hint of HINTS) {
    it(hint.name, () => {
      const details = webpush.generateRequestDetails(
        subscription(hint.endpoint),
        JSON.stringify({ v: 1, title: 'Rede Demo', body: 'Novo post: x' }),
        { ...hint.opts, vapidDetails },
      );
      expect(details.method).toBe('POST');
      expect(details.endpoint).toBe(hint.endpoint);
      const headers = details.headers as Record<string, string | number>;
      expect(headers.TTL).toBe(hint.opts.TTL);
      expect(headers.Urgency).toBe(hint.opts.urgency);
      expect(headers.Topic).toBe(hint.opts.topic);
      expect(headers['Content-Encoding']).toBe('aes128gcm');
      const authorization = String(headers.Authorization);
      expect(authorization.startsWith('vapid t=')).toBe(true);
      expect(authorization.endsWith(`, k=${vapid.publicKey}`)).toBe(true);
      const claims = vapidClaims(authorization);
      expect(claims.aud).toBe(new URL(hint.endpoint).origin);
      expect(claims.sub).toBe('mailto:ops@rede-social.test');
    });
  }

  it('refuses a Topic over 32 characters (why reminders use the bare 32-hex id)', () => {
    expect(() =>
      webpush.generateRequestDetails(subscription(HINTS[0]?.endpoint ?? ''), 'x', {
        TTL: 60,
        topic: 'events-reminder-0123456789abcdef0123456789abcdef',
        vapidDetails,
      }),
    ).toThrow();
  });
});

describe('webPushTransport: the status matrix', () => {
  const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p', auth: 'a' };
  const opts = { ttlSeconds: 86_400, urgency: 'normal' as const, topic: 'feed-post' };
  const reject = (status: number) =>
    sendNotification.mockRejectedValueOnce(
      new webpush.WebPushError('push service refused', status, {}, '', target.endpoint),
    );

  beforeEach(() => sendNotification.mockReset());

  it('passes TTL, urgency, topic, the 10 s timeout and the env VAPID pair to sendNotification', async () => {
    sendNotification.mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} });
    await webPushTransport.send(target, '{"v":1}', opts);
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      '{"v":1}',
      {
        TTL: 86_400,
        urgency: 'normal',
        topic: 'feed-post',
        timeout: PUSH_SEND_TIMEOUT_MS,
        vapidDetails: {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
      },
    );
    expect(PUSH_SEND_TIMEOUT_MS).toBe(10_000);
  });

  it.each([201, 202])('%i is sent', async (status) => {
    sendNotification.mockResolvedValueOnce({ statusCode: status, body: '', headers: {} });
    await expect(webPushTransport.send(target, '{}', opts)).resolves.toBe('sent');
  });

  it.each([404, 410])(
    '%i is gone (the endpoint expired: the job deletes the row)',
    async (status) => {
      reject(status);
      await expect(webPushTransport.send(target, '{}', opts)).resolves.toBe('gone');
    },
  );

  it.each([400, 413])('%i is dropped (never re-tried)', async (status) => {
    reject(status);
    await expect(webPushTransport.send(target, '{}', opts)).resolves.toBe('dropped');
  });

  it.each([429, 500, 503])('%i is re-tried', async (status) => {
    reject(status);
    await expect(webPushTransport.send(target, '{}', opts)).resolves.toBe('retry');
  });

  it('a network error (no status) is re-tried', async () => {
    sendNotification.mockRejectedValueOnce(new Error('connect ECONNRESET'));
    await expect(webPushTransport.send(target, '{}', opts)).resolves.toBe('retry');
  });

  it('outcomeForStatus is the one table both transports share', () => {
    expect([201, 202, 404, 410, 400, 413, 429, 500, 503].map(outcomeForStatus)).toEqual([
      'sent',
      'sent',
      'gone',
      'gone',
      'dropped',
      'dropped',
      'retry',
      'retry',
      'retry',
    ]);
    expect(outcomeForStatus(undefined)).toBe('retry');
  });
});

describe('fakePushTransport and the selector', () => {
  beforeEach(() => resetFakePushOutbox());

  it('honours /status/<code> and answers 201 otherwise, recording every send', async () => {
    const opts = { ttlSeconds: 60, urgency: 'high' as const, topic: 'feed-post' };
    const send = (endpoint: string) =>
      fakePushTransport.send({ endpoint, p256dh: 'p', auth: 'a' }, '{"v":1}', opts);
    await expect(send('https://push.fake.test/sub/1')).resolves.toBe('sent');
    await expect(send('https://push.fake.test/status/410/2')).resolves.toBe('gone');
    await expect(send('https://push.fake.test/status/413/3')).resolves.toBe('dropped');
    await expect(send('https://push.fake.test/status/503')).resolves.toBe('retry');
    expect(fakePushOutbox().map((entry) => entry.status)).toEqual([201, 410, 413, 503]);
    expect(fakePushOutbox()[0]).toEqual({
      endpoint: 'https://push.fake.test/sub/1',
      payload: '{"v":1}',
      opts,
      status: 201,
    });
    resetFakePushOutbox();
    expect(fakePushOutbox()).toEqual([]);
  });

  it('PUSH_TRANSPORT picks the transport', () => {
    env.PUSH_TRANSPORT = 'fake';
    expect(pushTransport()).toBe(fakePushTransport);
    env.PUSH_TRANSPORT = 'webpush';
    expect(pushTransport()).toBe(webPushTransport);
    env.PUSH_TRANSPORT = 'fake';
  });
});
