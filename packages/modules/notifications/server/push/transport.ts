import { env } from '@rede-social/core/server/env';
import webpush from 'web-push';

/**
 * The Web Push transport seam (07-06, the `VIDEO_PROVIDER=fake` precedent). `PUSH_TRANSPORT` picks:
 *
 * - `fake` (the default, and pinned for every automated run by `apps/api/vitest.config.ts`): records
 *   each send in an in-memory outbox and answers the status a `/status/<code>` endpoint path segment
 *   asks for (201 otherwise). Nothing leaves the process.
 * - `webpush`: `web-push@3.6.7` signs a VAPID JWT with the kernel env's key pair, encrypts the payload
 *   (aes128gcm) and POSTs it to the subscription's push service with a 10 s timeout.
 *
 * Both map a status the SAME way (`outcomeForStatus`): 201/202 `sent`; 404/410 `gone` (the endpoint
 * expired: the job deletes the row); 400/413 `dropped` (a malformed or oversize request: never re-tried,
 * logged by shape); anything else, 429/5xx or a network failure, `retry`.
 */

/** What one send did, from the job's point of view. */
export type PushOutcome = 'sent' | 'gone' | 'dropped' | 'retry';

/** A stored subscription, as `app.push_subscriptions_for` returns it. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The per-message Web Push options: `TTL`, `Urgency` and `Topic` headers. */
export interface PushSendOptions {
  ttlSeconds: number;
  urgency: 'normal' | 'high';
  topic: string;
}

export interface PushTransport {
  send(target: PushTarget, payload: string, opts: PushSendOptions): Promise<PushOutcome>;
}

/**
 * The status → outcome table both transports share. Push services answer 201 (Created); any 2xx is
 * accepted, since `web-push` itself resolves only on 2xx.
 */
export function outcomeForStatus(status: number | undefined): PushOutcome {
  if (status !== undefined && status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 400 || status === 413) return 'dropped';
  return 'retry';
}

/* ── fake ─────────────────────────────────────────────────────────────────────────────────────── */

/** One recorded fake send. `payload` is the serialised JSON string the worker would encrypt. */
export interface FakePushSend {
  endpoint: string;
  payload: string;
  opts: PushSendOptions;
  status: number;
}

const outbox: FakePushSend[] = [];

/** The status a fake endpoint asks for: `https://push.fake.test/status/410/…` answers 410. */
function fakeStatus(endpoint: string): number {
  try {
    const match = /\/status\/(\d{3})(?:\/|$)/.exec(new URL(endpoint).pathname);
    return match ? Number(match[1]) : 201;
  } catch {
    return 201;
  }
}

export const fakePushTransport: PushTransport = {
  async send(target, payload, opts) {
    const status = fakeStatus(target.endpoint);
    outbox.push({ endpoint: target.endpoint, payload, opts: { ...opts }, status });
    return outcomeForStatus(status);
  },
};

/** Tests only: every fake send since the last reset, oldest first (a copy). */
export function fakePushOutbox(): FakePushSend[] {
  return [...outbox];
}

/** Tests only: forget every recorded fake send. */
export function resetFakePushOutbox(): void {
  outbox.length = 0;
}

/* ── web-push ─────────────────────────────────────────────────────────────────────────────────── */

/** A send's network timeout: a slow push service must not hold the worker. */
export const PUSH_SEND_TIMEOUT_MS = 10_000;

export const webPushTransport: PushTransport = {
  async send(target, payload, opts) {
    const { VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = env;
    if (!VAPID_SUBJECT || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      // `assertProductionEnv` refuses to boot like this; reaching here is a wiring bug.
      throw new Error('PUSH_TRANSPORT=webpush without the VAPID key pair');
    }
    try {
      const result = await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          TTL: opts.ttlSeconds,
          urgency: opts.urgency,
          topic: opts.topic,
          timeout: PUSH_SEND_TIMEOUT_MS,
          vapidDetails: {
            subject: VAPID_SUBJECT,
            publicKey: VAPID_PUBLIC_KEY,
            privateKey: VAPID_PRIVATE_KEY,
          },
        },
      );
      return outcomeForStatus(result.statusCode);
    } catch (error) {
      // `WebPushError` carries the push service's status; a network failure or timeout has none.
      const status =
        error !== null && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode: unknown }).statusCode)
          : undefined;
      return outcomeForStatus(Number.isFinite(status) ? status : undefined);
    }
  },
};

/** The transport `PUSH_TRANSPORT` selects. */
export function pushTransport(): PushTransport {
  return env.PUSH_TRANSPORT === 'webpush' ? webPushTransport : fakePushTransport;
}
