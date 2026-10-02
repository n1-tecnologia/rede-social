import { z } from 'zod';
import { TENANT_ROLES } from './modules';

/**
 * `@rede-social/contracts/moderation` — the moderation vocabulary (Phase 8, MODER-01..03, D-334..D-338).
 *
 * A SUBPATH, never re-exported from `src/index.ts`, for the `realtime` reason: the web's client
 * components import the removal enum, and the package index re-exports the server-only `legal`
 * module.
 *
 * MODERATION IS A KERNEL CAPABILITY (SCHEMA-CONVENTIONS §(f).2), not a toggleable module: it has no
 * flag, its log lives in the kernel (`packages/core/db/schema/moderation-log.ts`) and the owning
 * module of each removed thing writes the log row inside ITS OWN transaction through the kernel's
 * `recordModerationAction(tx, …)`. That is what makes "a removal without its log row" impossible.
 *
 * THE ACTION AND SUBJECT VOCABULARIES ARE FIXED WITH THE TABLE (D-337, reversibility costly). They are
 * the CHECK constraints of `moderation_log`, and once production holds audit rows the table cannot be
 * rewritten without dropping its own immutability trigger. `role_changed` is in from day one (08-05
 * writes it) and `story_comment` too (08-03 writes it).
 */

/** Every `moderation_log.action` value — the `moderation_log_action_chk` list, verbatim. */
export const MODERATION_ACTIONS = [
  'comment_removed',
  'member_blocked',
  'member_unblocked',
  'role_changed',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/** Every `moderation_log.subject_type` value — a `comment_removed` row names one of these. */
export const MODERATION_SUBJECT_TYPES = ['post_comment', 'story_comment'] as const;
export type ModerationSubjectType = (typeof MODERATION_SUBJECT_TYPES)[number];

/**
 * The snapshot cap of a removed comment's text (D-337, UI-D-278), in UTF-16 code units — the
 * `withinCodeUnits` rule the profiles contract uses. The DB CHECK counts CODE POINTS, which is never
 * larger than the code-unit count, so an excerpt the kernel accepts always passes the CHECK.
 */
export const MODERATION_EXCERPT_MAX = 280;

/** The optional internal reason of a block or unblock (D-331, UI-D-274): 1..500 characters. */
export const MODERATION_REASON_MAX = 500;

/**
 * The kernel's permission names (D-338). They are VALUES the web compares with
 * `bootstrap.permissions` and the API guards with `requirePermission(...)` — never a role check, so a
 * future grant to `support_tenant` needs no code change (FEED-08).
 */
export const KERNEL_PERMISSIONS = {
  tenantManage: 'tenant.manage',
  membersManage: 'members.manage',
  moderationManage: 'moderation.manage',
} as const;

/**
 * What a comment's removal control means for THIS viewer (UI-D-276, T-04-44). SERVER-DERIVED:
 * `'own'` when the viewer wrote it, `'moderation'` when someone else did and the viewer holds
 * `moderation.manage`, `null` otherwise. The web copies it through and never compares ids.
 */
export const commentRemovalSchema = z.enum(['own', 'moderation']).nullable();
export type CommentRemoval = z.infer<typeof commentRemovalSchema>;

/** One screen of log rows on a phone, and the ceiling a crafted `limit` cannot exceed. */
export const MODERATION_LOG_PAGE_SIZE = 20;
export const MODERATION_LOG_MAX_PAGE_SIZE = 50;

/** The longest cursor the log endpoint will look at (the notifications `NOTIF_MAX_CURSOR_LENGTH`). */
export const MODERATION_LOG_MAX_CURSOR_LENGTH = 512;

/**
 * `GET /v1/admin/moderation-log?action=&cursor=&limit=`. `.strict()`: an unknown key fails loudly.
 *
 * - `action` is a CLOSED enum that does not clamp: an unknown value is a 400, never a widened read
 *   (the web maps an unknown `?acao=` to "Tudo" before it asks).
 * - `limit` CLAMPS to `1..MODERATION_LOG_MAX_PAGE_SIZE` (a garbage value reads as the default).
 * - `cursor` over the transport bound degrades to page 1, like a tampered one does in the service.
 */
export const moderationLogQuerySchema = z
  .object({
    action: z.enum(MODERATION_ACTIONS).optional(),
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > MODERATION_LOG_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(MODERATION_LOG_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), MODERATION_LOG_MAX_PAGE_SIZE))
      .default(MODERATION_LOG_PAGE_SIZE),
  })
  .strict();
export type ModerationLogQuery = z.infer<typeof moderationLogQuerySchema>;

/**
 * One log row as the Moderação screen reads it (UI-D-278).
 *
 * - Names are read LIVE from the membership's profile: a departed actor or target (a soft-deleted
 *   membership, or one with no profile) answers `displayName: null` and the web renders the
 *   "Membro removido" label (UI-D-24).
 * - `actor.isViewer` is computed in SQL (`actor_user_id = caller`), so the web never compares ids to
 *   decide when to say "Você".
 * - `excerpt` is the snapshot taken INSIDE the removal transaction (D-337) — the evidence, shown
 *   whole. `reason` is the optional internal reason of a block or unblock (D-331).
 * - `createdAt` is a UTC ISO string with microseconds, formatted by Postgres (the keyset cursor's `n`).
 */
export const moderationLogEntrySchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    action: z.enum(MODERATION_ACTIONS),
    actor: z
      .object({
        membershipId: z.uuid(),
        displayName: z.string().nullable(),
        isViewer: z.boolean(),
      })
      .strict(),
    target: z
      .object({
        membershipId: z.uuid(),
        displayName: z.string().nullable(),
      })
      .strict(),
    subjectType: z.enum(MODERATION_SUBJECT_TYPES).nullable(),
    excerpt: z.string().nullable(),
    reason: z.string().nullable(),
    details: z
      .object({ from: z.enum(TENANT_ROLES), to: z.enum(TENANT_ROLES) })
      .strict()
      .nullable(),
  })
  .strict();
export type ModerationLogEntry = z.infer<typeof moderationLogEntrySchema>;

/** One keyset page of the log, newest first. `nextCursor` is non-null EXACTLY when another row exists. */
export const moderationLogPageSchema = z
  .object({
    items: z.array(moderationLogEntrySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ModerationLogPage = z.infer<typeof moderationLogPageSchema>;
