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

/* ── Member admin: the Membros list and block / unblock (08-04, MODER-02, ADMIN-02, D-330..D-333, D-340) ── */

/**
 * The Membros filter (UI-D-271, D-340). `all` is the default and lists EVERY membership of the tenant
 * — members, staff, blocked and invited — because Membros is the only screen where a blocked member
 * can be found and unblocked. The web maps an unknown `?status=` to `all` before it asks.
 */
export const ADMIN_MEMBER_STATUSES = ['all', 'active', 'blocked', 'invited'] as const;
export type AdminMemberStatusFilter = (typeof ADMIN_MEMBER_STATUSES)[number];

/** The three states a listed membership can be in (the `memberships_status_chk` list). */
export const ADMIN_MEMBERSHIP_STATES = ['active', 'blocked', 'invited'] as const;
export type AdminMembershipState = (typeof ADMIN_MEMBERSHIP_STATES)[number];

/** One screen of rows on a phone, and the ceiling a crafted `limit` cannot exceed. */
export const ADMIN_MEMBERS_PAGE_SIZE = 20;
export const ADMIN_MEMBERS_MAX_PAGE_SIZE = 50;

/**
 * The search term's cap: the member directory's own `MEMBERS_MAX_QUERY_LENGTH` (80), restated as a
 * value so this module does not pull the profiles contract into every moderation import. The two
 * are pinned equal by `tests/moderation.test.ts`.
 */
export const ADMIN_MEMBERS_MAX_QUERY_LENGTH = 80;

/** The longest cursor the list will look at; the envelope carries two folded strings and a uuid. */
export const ADMIN_MEMBERS_MAX_CURSOR_LENGTH = 1024;

/**
 * `GET /v1/admin/members?q=&status=&cursor=&limit=`. `.strict()`: an unknown key fails loudly.
 *
 * - `q` is trimmed and capped at `ADMIN_MEMBERS_MAX_QUERY_LENGTH` (a longer one is a 400; the page
 *   trims before it asks). An empty or spaces-only `q` means no filter (the kernel's
 *   `normaliseQuery`). It matches the display name OR the e-mail, accent- and case-insensitively, and
 *   `%`, `_` and `\` are literal.
 * - `status` is a CLOSED enum defaulting to `all`; an unknown value is a 400, never a widened read.
 * - `limit` CLAMPS to `1..ADMIN_MEMBERS_MAX_PAGE_SIZE` (garbage reads as the default).
 * - `cursor` is OPAQUE; one over the transport bound degrades to page 1, like a tampered one.
 */
export const adminMemberListQuerySchema = z
  .object({
    q: z.string().trim().max(ADMIN_MEMBERS_MAX_QUERY_LENGTH).optional(),
    status: z.enum(ADMIN_MEMBER_STATUSES).default('all'),
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > ADMIN_MEMBERS_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(ADMIN_MEMBERS_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), ADMIN_MEMBERS_MAX_PAGE_SIZE))
      .default(ADMIN_MEMBERS_PAGE_SIZE),
  })
  .strict();
export type AdminMemberListQuery = z.infer<typeof adminMemberListQuerySchema>;

/**
 * One membership as the admin sees it (UI-D-272). ADMIN ONLY: it carries the e-mail, so it is served
 * exclusively behind `members.manage` or `moderation.manage` — the public directory and profile stay
 * name-only (ADMIN-02 privacy prohibition, T-08-23).
 *
 * - `displayName` is null when the membership has no profile name yet (an invited admin): the web
 *   shows the e-mail as the name line.
 * - `status` folds the legacy `blocked_at`-only row into `blocked`, so every reader agrees.
 * - `isViewer` is computed in SQL, so the web never compares ids to draw the static "Você" row.
 * - `emailUnconfirmed` is ADMIN ONLY like the e-mail: true exactly when the identity's e-mail is
 *   unconfirmed (a sign-up still waiting for its mail, or a pending GoTrue invite). It is a boolean
 *   and nothing else leaves the database. OPTIONAL in the schema: absent means an API that predates
 *   the field, which the web reads as confirmed. The schema stays strict and the web parses every API
 *   answer strictly, so an old web refuses an unknown key from a new API; the release order is
 *   therefore migrations, then web, then API (the Phase 8 precedent in docs/DEPLOY.md).
 */
export const adminMemberSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string().nullable(),
    email: z.string(),
    avatarAssetId: z.uuid().nullable(),
    role: z.enum(TENANT_ROLES),
    status: z.enum(ADMIN_MEMBERSHIP_STATES),
    isViewer: z.boolean(),
    emailUnconfirmed: z.boolean().optional(),
  })
  .strict();
export type AdminMember = z.infer<typeof adminMemberSchema>;

/** One keyset page of the Membros list. `nextCursor` is non-null EXACTLY when another row exists. */
export const adminMemberPageSchema = z
  .object({
    items: z.array(adminMemberSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type AdminMemberPage = z.infer<typeof adminMemberPageSchema>;

/** The `withinCodeUnits` rule of the profiles contract: `.length` counts UTF-16 code units. */
const withinCodeUnits = (max: number) => (value: string) => value.length <= max;

/**
 * Body of `POST /v1/admin/members/{membershipId}/block` and `…/unblock` (D-331, UI-D-274).
 *
 * `reason` is OPTIONAL and INTERNAL: trimmed, at most `MODERATION_REASON_MAX` UTF-16 code units, and
 * an empty or whitespace-only value is normalised to `undefined` (stored as null). It is written ONLY
 * to `moderation_log.reason`; no member-facing response, screen, e-mail or push ever carries it.
 */
export const memberAccessBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .refine(withinCodeUnits(MODERATION_REASON_MAX), 'too_long')
      .optional()
      .transform((value) => (value === undefined || value === '' ? undefined : value)),
  })
  .strict();
export type MemberAccessBody = z.infer<typeof memberAccessBodySchema>;

/**
 * Body of `PUT /v1/admin/members/{membershipId}/role` (ADMIN-02, D-332, UI-D-273). `role` is the
 * CLOSED `TENANT_ROLES` vocabulary (`member`, `support_tenant`, `admin_tenant`); anything else, and
 * any other key, is a 400 — the client never names a tenant, a target user or a permission. Choosing
 * the role the membership already holds is a no-op 200 with no log row.
 */
export const memberRoleBodySchema = z.object({ role: z.enum(TENANT_ROLES) }).strict();
export type MemberRoleBody = z.infer<typeof memberRoleBodySchema>;

/**
 * The D-332 refusals of a member action, as `409 CONFLICT { member: <value> }`:
 *
 * - `self`: the actor aimed at their own membership (no self-block, no self-role-change);
 * - `last_admin`: the action would leave the tenant without an active `admin_tenant`;
 * - `not_active`: the membership is still `invited` (A7: actions wait for the accept);
 * - `blocked`: a role change aimed at a blocked membership (08-05).
 */
export const MEMBER_ADMIN_REFUSALS = ['self', 'last_admin', 'not_active', 'blocked'] as const;
export type MemberAdminRefusal = (typeof MEMBER_ADMIN_REFUSALS)[number];

/**
 * `membership.blocked` — emitted by the kernel AFTER the block commits (MODER-02 "revoked
 * immediately"). Ids only: the reason never rides an event. The notifications module subscribes to
 * clean the member's push devices eagerly and to nudge their open app (`membership-blocked.ts`).
 *
 * Declared against `@rede-social/contracts` by name — the same merge every module contract writes. A
 * relative `declare module './events'` type-checks inside this package but, seen from the API,
 * did not merge with the module contracts' entries (every module's `emit` stopped type-checking), so
 * the package name is the spelling that works across the workspace.
 */
export type MembershipBlocked = { tenantId: string; userId: string; membershipId: string };

declare module '@rede-social/contracts' {
  interface EventMap {
    'membership.blocked': MembershipBlocked;
  }
}
