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
