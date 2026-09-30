import { z } from 'zod';

/**
 * The notifications module's published contract surface (`@rede-social/module-notifications/contracts`).
 * The API validates its query with these schemas and the web parses its page payload with them, so
 * there is one definition of what a notification row is (MOD-01).
 *
 * Facts a reader must not "fix":
 *
 * 1. **A row carries FACTS, never a sentence** (CONTEXT). `facts` is what a producer's source stored
 *    (an excerpt of at most 80 graphemes, a community name, a preview asset id); the web registry
 *    renders the pt-BR sentence from `kind` + facts. The actor's name is read LIVE at list time.
 * 2. **Novas and Anteriores are two keysets** (D-231, planning decision 9). `section=unread` is
 *    `read_at is null`, `section=read` is `read_at is not null`, each ordered `created_at desc, id
 *    desc` in its own literal statement, so a cursor never spans the boundary.
 * 3. **`section` is a closed enum that does NOT clamp; `limit` clamps** (the events `period`/`limit`
 *    split): `READ` and `all` are 400, never a widened read, while a `limit` from a shared link
 *    degrades to `1..NOTIF_MAX_PAGE_SIZE`.
 */

/** One screen of rows on a phone, and a ceiling a crafted `limit` cannot exceed. */
export const NOTIF_PAGE_SIZE = 20;
export const NOTIF_MAX_PAGE_SIZE = 50;

/** The longest cursor this endpoint will look at (the `EVENT_MAX_CURSOR_LENGTH` rule). */
export const NOTIF_MAX_CURSOR_LENGTH = 512;

/** D-231: rows older than this are pruned (07-04) and the list's footer says so. */
export const NOTIF_RETENTION_DAYS = 90;

/** D-231: the two sections, each its own keyset. */
export const NOTIF_SECTIONS = ['unread', 'read'] as const;
export type NotificationSection = (typeof NOTIF_SECTIONS)[number];

/** pg-boss queue names this module owns. */
export const NOTIFICATIONS_QUEUES = {
  fanout: 'notifications.fanout',
  /** 07-06: one Web Push delivery batch (at most `PUSH_SEND_CHUNK` users). Runs in the worker. */
  pushSend: 'notifications.push-send',
} as const;

/**
 * `GET /v1/notifications?section=&cursor=&limit=`. `.strict()`: an unknown key fails loudly. An
 * over-long cursor is refused here (400) only when it exceeds the transport bound; an undecodable one
 * of legal length degrades to page 1 in the service.
 */
export const notificationQuerySchema = z
  .object({
    section: z.enum(NOTIF_SECTIONS).default('unread'),
    cursor: z
      .string()
      .optional()
      // A cursor over the bound degrades to page 1 rather than failing (NOTIF-02 boundary).
      .transform((value) =>
        value !== undefined && value.length > NOTIF_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(NOTIF_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), NOTIF_MAX_PAGE_SIZE))
      .default(NOTIF_PAGE_SIZE),
  })
  .strict();
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

/** A fact value: data a sentence is rendered from. Never markup, never a sentence. */
export const notificationFactSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * The actor as the list projects it, read LIVE through `actor_user_id` in the same tenant. `removed`
 * is true when the actor's membership is gone or soft-deleted; the name and avatar are then null
 * together (the UI-D-24 rule) and the web renders "Membro removido". A row with no actor at all
 * (reminders) has `actor: null`.
 */
export const notificationActorSchema = z
  .object({
    removed: z.boolean(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
  })
  .strict();
export type NotificationActor = z.infer<typeof notificationActorSchema>;

/**
 * One notification row. `.strict()`. Instants are UTC ISO strings with microsecond precision,
 * formatted by Postgres (the `ISO_MICROSECONDS` rule: the keyset cursor is built from `createdAt`).
 * `removed` is the retraction flag 07-04 may set in the facts; a removed target renders the removed
 * sentence and no preview.
 */
export const notificationRowSchema = z
  .object({
    id: z.uuid(),
    kind: z.string(),
    subject: z.object({ type: z.string(), id: z.uuid() }).strict(),
    object: z.object({ type: z.string(), id: z.uuid() }).strict().nullable(),
    actor: notificationActorSchema.nullable(),
    facts: z.record(z.string(), notificationFactSchema),
    /**
     * The 44px trailing thumbnail (UI-D-251): the asset named by `facts.previewAssetId`, with its
     * variant ladder, or null when there is none, the asset was retired, or it has no ladder yet.
     */
    preview: z
      .object({ assetId: z.uuid(), variantWidths: z.array(z.number().int()) })
      .strict()
      .nullable(),
    removed: z.boolean(),
    createdAt: z.string(),
    seenAt: z.string().nullable(),
    readAt: z.string().nullable(),
  })
  .strict();
export type NotificationRow = z.infer<typeof notificationRowSchema>;

/** One keyset page of one section. `nextCursor` is non-null EXACTLY when another row exists. */
export const notificationPageSchema = z
  .object({
    items: z.array(notificationRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type NotificationPage = z.infer<typeof notificationPageSchema>;

/**
 * The `notifications.fanout` job payload the sink enqueues. `payload` is the domain event's own
 * payload (ids only), `sinkAt` is stamped ONCE per bus delivery and reused by a retried job.
 */
export const notificationsFanoutJobSchema = z
  .object({
    event: z.string().min(1),
    tenantId: z.uuid(),
    payload: z.record(z.string(), z.unknown()),
    sinkAt: z.iso.datetime(),
  })
  .strict();
export type NotificationsFanoutJob = z.infer<typeof notificationsFanoutJobSchema>;

/* ── Web Push (07-06, NOTIF-03) ─────────────────────────────────────────────────────────────────── */

/**
 * The service worker's payload version. Every deployed service worker parses `{ v: 1, … }`; a v2 is
 * ADDITIVE (a new `v`, never a changed meaning), because installed workers update on their own time.
 */
export const PUSH_PAYLOAD_VERSION = 1;

/**
 * The serialised payload's ceiling in UTF-8 bytes. The encrypted record limit is 4,096 bytes (RFC
 * 8291); 3,072 leaves room for the aes128gcm header and padding. A payload that would exceed it has its
 * BODY shortened again, never its URL or tag (`buildPushPayload`).
 */
export const PUSH_PAYLOAD_MAX_BYTES = 3072;

/** At most this many users per `notifications.push-send` job (RESEARCH Pattern 7). */
export const PUSH_SEND_CHUNK = 100;

/** A failed (429/5xx/network) subscription is re-tried at most this many times, then dropped. */
export const PUSH_MAX_ATTEMPTS = 3;

/** The re-try delays in seconds for attempts 1, 2 and 3 (30 s, 2 min, 8 min). */
export const PUSH_RETRY_DELAYS_SECONDS = [30, 120, 480] as const;

/**
 * The push-service hosts a subscription endpoint may point at (T-07-33, SSRF): FCM (Chrome, Edge on
 * Android), Mozilla autopush (Firefox), Apple (Safari, iOS home-screen apps) and WNS (Edge on Windows).
 * A host must END with one of these suffixes (the leading dot is load-bearing). [ASSUMED] set, confirmed
 * by the real-device plan; widening it is a one-line change, and an unlisted legitimate host is a
 * VISIBLE 400 `endpoint_invalid`, never a silent loss.
 */
export const PUSH_SERVICE_HOST_SUFFIXES = [
  '.googleapis.com',
  '.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
] as const;

/** The fake transport's endpoint host, accepted ONLY while `PUSH_TRANSPORT=fake`. */
export const FAKE_PUSH_HOST = 'push.fake.test';

/** The longest endpoint URL this API stores. Real push-service endpoints are well under 1 KB. */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

/** base64url without padding (what `PushSubscription.toJSON()` produces), optional padding tolerated. */
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The decoded byte length of a base64url string, or -1 when it is not base64url at all. */
function base64UrlBytes(value: string): number {
  if (!BASE64URL.test(value)) return -1;
  const unpadded = value.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return -1;
  return Math.floor((unpadded.length * 3) / 4);
}

/**
 * The first byte of an uncompressed P-256 point (SEC1 `0x04`): `p256dh` is exactly 65 bytes starting
 * with it (RFC 8291). Checked on the decoded bytes, without a Node Buffer (this file is client-safe).
 */
function isUncompressedPoint(value: string): boolean {
  const first = value.replace(/-/g, '+').replace(/_/g, '/').slice(0, 4);
  try {
    return atob(first).charCodeAt(0) === 0x04;
  } catch {
    return false;
  }
}

/**
 * `POST /v1/notifications/push-subscriptions` (what the browser's `PushSubscription.toJSON()` gives,
 * plus an optional user agent). `.strict()`: an unknown key fails loudly. The keys must decode to 65
 * (`p256dh`, an uncompressed P-256 point) and 16 (`auth`) bytes; the endpoint's host rule needs the
 * transport, so the API applies it (`isAllowedPushEndpoint`). A refusal is `400 VALIDATION_FAILED`
 * with `details.push = 'endpoint_invalid' | 'keys_invalid'`.
 */
export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z.url().max(PUSH_ENDPOINT_MAX_LENGTH),
    keys: z
      .object({
        p256dh: z
          .string()
          .refine(
            (value) => base64UrlBytes(value) === 65 && isUncompressedPoint(value),
            'p256dh must be a 65-byte uncompressed P-256 point, base64url',
          ),
        auth: z
          .string()
          .refine((value) => base64UrlBytes(value) === 16, 'auth must be 16 bytes, base64url'),
      })
      .strict(),
    userAgent: z.string().max(512).optional(),
  })
  .strict();
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

/** `DELETE /v1/notifications/push-subscriptions`: which of the caller's own devices to forget. */
export const pushSubscriptionDeleteSchema = z
  .object({ endpoint: z.string().min(1).max(PUSH_ENDPOINT_MAX_LENGTH) })
  .strict();
export type PushSubscriptionDelete = z.infer<typeof pushSubscriptionDeleteSchema>;

/** A Web Push `Topic` (RFC 8030): at most 32 characters of the URL-safe base64 alphabet. */
export const PUSH_TOPIC = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * A same-origin path: one leading `/`, never `//` or `/\\` (both of which a browser resolves to ANOTHER
 * origin), and no backslash or whitespace anywhere.
 */
export const PUSH_PATH = /^\/(?![/\\])[^\\\s]*$/;

/** A notification `tag`: a slug, longer than a Topic allows (reminders carry `events-reminder-<hex32>`). */
export const PUSH_TAG = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The push hint a producer's intent carries (`NotificationPushHint` in the kernel seam), as the push
 * adapter and the send job validate it. `url` is a same-origin PATH (`/…`, never `//…`), resolved by the
 * service worker against its own origin, the tenant's domain.
 */
export const notificationPushHintSchema = z
  .object({
    title: z.enum(['tenant', 'team']),
    body: z.string().max(1000),
    url: z.string().max(512).regex(PUSH_PATH),
    tag: z.string().regex(PUSH_TAG),
    topic: z.string().regex(PUSH_TOPIC),
    ttlSeconds: z.number().int().min(1).max(2_419_200),
    urgency: z.enum(['normal', 'high']),
    renotify: z.boolean(),
  })
  .strict();

/**
 * The `notifications.push-send` job payload the push adapter enqueues (and the job re-enqueues for its
 * failed subscriptions only). `subscriptionIds` is set on a re-try and narrows the send to exactly those
 * rows, so a subscription that already succeeded is never sent twice (T-07-39).
 */
export const pushSendJobSchema = z
  .object({
    tenantId: z.uuid(),
    kind: z.string().min(1).max(100),
    dedupeKey: z.string().min(1).max(300),
    userIds: z.array(z.uuid()).min(1).max(PUSH_SEND_CHUNK),
    push: notificationPushHintSchema,
    attempt: z.number().int().min(0).max(PUSH_MAX_ATTEMPTS),
    subscriptionIds: z.array(z.uuid()).min(1).optional(),
  })
  .strict();
export type PushSendJob = z.infer<typeof pushSendJobSchema>;

/**
 * The payload the service worker receives (UI-D-266), one per recipient. `title` is the tenant's
 * display name (or "Equipe {tenant}"), `icon` the tenant's `icon-192` (the neutral set when absent),
 * `url` a same-origin path, `tag` the device-collapse slug, `badge` the recipient's unseen + chat count
 * at send time (D-239). No image `badge` asset exists in V1.
 */
export const pushPayloadSchema = z
  .object({
    v: z.literal(PUSH_PAYLOAD_VERSION),
    title: z.string().min(1),
    body: z.string(),
    icon: z.string().min(1),
    url: z.string().regex(PUSH_PATH),
    tag: z.string().regex(PUSH_TAG),
    renotify: z.boolean(),
    badge: z.number().int().min(0),
  })
  .strict();
export type PushPayload = z.infer<typeof pushPayloadSchema>;
