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
 *
 * 09-07 (D-475) widens both lists by ONE value each, in one release with the two CHECKs, the writer's
 * `ModerationEntry` union and the web's exhaustive maps: `post_removed` / `feed_post`. A holder of
 * `moderation.manage` removes a MEMBER's post (MODER-04 is split: member posts here, member stories,
 * communities and "block author from a report" in Phase 11). Values are appended, never inserted, so
 * the order the filter chips read stays put.
 *
 * Phase 12 (D-595) appends the third value, `profile_form_exported`: a TENANT-LEVEL row. The exporting
 * admin is BOTH the actor and the target (the table's membership columns are NOT NULL), and the row
 * carries no subject, no excerpt, no reason and no details; it names no answer, e-mail or member.
 *
 * Phase 13 (D-616) adds the MINIMUM report and member-block slice the store policies require (Apple
 * 1.2, Google UGC): the report vocabularies below are the CHECK lists of `content_reports`, fixed with
 * the table the way the moderation log's were. Phase 11 appends `story_comment`, `community` and
 * `direct_message` to `REPORT_SUBJECT_TYPES` the way 09-07 appended `post_removed` to the actions;
 * values are appended, never inserted. Phase 13 covers MODER-05 (posts and comments, the admin queue
 * and its dismiss / remove / block-author actions) and CHAT-07 (the member block, unblock and the
 * blocker's content filter) only in part; the rest stays in Phase 11.
 */

/** Every `moderation_log.action` value — the `moderation_log_action_chk` list, verbatim. */
export const MODERATION_ACTIONS = [
  'comment_removed',
  'member_blocked',
  'member_unblocked',
  'role_changed',
  'post_removed',
  'profile_form_exported',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * Every `moderation_log.subject_type` value — a removal row names one of these: `comment_removed`
 * names a comment (`post_comment`, `story_comment`), `post_removed` names a post (`feed_post`).
 */
export const MODERATION_SUBJECT_TYPES = ['post_comment', 'story_comment', 'feed_post'] as const;
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
 * Phase 13 (D-616): what a member can report. A post (`feed_post`) or a comment on a post
 * (`post_comment`); the `content_reports_subject_type_chk` list, verbatim. Phase 11 appends.
 */
export const REPORT_SUBJECT_TYPES = ['feed_post', 'post_comment'] as const;
export type ReportSubjectType = (typeof REPORT_SUBJECT_TYPES)[number];

/** Why a member reports (AD-5); the `content_reports_reason_chk` list, verbatim. */
export const REPORT_REASONS = [
  'offensive',
  'harassment',
  'spam',
  'sexual_violent',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Where a report stands; the `content_reports_status_chk` list, verbatim. `open` is the only state a
 * report is filed in; the other three are the admin's three resolutions (`app.content_report_resolve`).
 */
export const REPORT_STATUSES = ['open', 'dismissed', 'content_removed', 'author_blocked'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The three resolutions an admin can give an open report (`REPORT_STATUSES` without `open`). */
export const REPORT_RESOLUTIONS = ['dismissed', 'content_removed', 'author_blocked'] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

/** The optional note of a report: at most 500 characters (`content_reports_note_len_chk`). */
export const REPORT_NOTE_MAX = 500;

/** The snapshot of the reported text: at most 280 code points (`content_reports_excerpt_len_chk`). */
export const REPORT_EXCERPT_MAX = 280;

/* ── Reports and member blocks: the API (Phase 13, plan 14, D-616, NATIVE-31, NATIVE-33) ─────────────── */

/** `GET /v1/admin/reports` and the blocked list: one screen of rows, the ceiling a crafted `limit` cannot pass. */
export const REPORT_PAGE_SIZE = 20;
export const REPORT_MAX_PAGE_SIZE = 50;
export const REPORT_MAX_CURSOR_LENGTH = 512;

/**
 * The admin queue's filter (UI-D-637), a CLOSED list that does not clamp: an unknown value is a 400 (the web maps
 * an unknown `?estado=` to "Abertas" before it asks). `abertas` is `status = 'open'`, `resolvidas` is every other
 * state, `todas` is no filter.
 */
export const REPORT_LIST_STATES = ['abertas', 'resolvidas', 'todas'] as const;
export type ReportListState = (typeof REPORT_LIST_STATES)[number];

/**
 * What the admin chooses on a report (UI-D-638), in the verbs of the sheet. Each maps to one `REPORT_STATUSES`
 * resolution (`dismiss` to `dismissed`, `remove_content` to `content_removed`, `block_author` to
 * `author_blocked`); the status vocabulary stays the table's, the verbs are the API's.
 */
export const REPORT_RESOLVE_ACTIONS = ['dismiss', 'remove_content', 'block_author'] as const;
export type ReportResolveAction = (typeof REPORT_RESOLVE_ACTIONS)[number];

/**
 * `POST /v1/reports` (NATIVE-31). `.strict()`: no tenant, reporter or author is ever named by the client.
 *
 * - `subjectType` is the CLOSED `REPORT_SUBJECT_TYPES` list; a story comment, a community or a message is a 400
 *   until Phase 11 appends it.
 * - `reason` is the closed `REPORT_REASONS` list; a missing or unknown one is a 400.
 * - `note` is trimmed and at most `REPORT_NOTE_MAX` characters (code points, the table CHECK counts the same); an
 *   empty or whitespace-only note is stored as `null`, so `note` leaves this schema as a string or `undefined`.
 */
export const reportCreateBodySchema = z
  .object({
    subjectType: z.enum(REPORT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    note: z
      .string()
      .trim()
      .refine((value) => [...value].length <= REPORT_NOTE_MAX, 'too_long')
      .optional()
      .transform((value) => (value === undefined || value === '' ? undefined : value)),
  })
  .strict();
export type ReportCreateBody = z.infer<typeof reportCreateBodySchema>;

/** The answer of `POST /v1/reports`: the new report's id and nothing about anyone (T-13-32). */
export const reportCreateAnswerSchema = z.object({ id: z.uuid() }).strict();
export type ReportCreateAnswer = z.infer<typeof reportCreateAnswerSchema>;

/** `GET /v1/admin/reports?estado=&cursor=&limit=`. `.strict()`: an unknown key fails loudly. */
export const reportListQuerySchema = z
  .object({
    estado: z.enum(REPORT_LIST_STATES).default('abertas'),
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > REPORT_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(REPORT_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), REPORT_MAX_PAGE_SIZE))
      .default(REPORT_PAGE_SIZE),
  })
  .strict();
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

/**
 * One report as the admin queue reads it (UI-D-637). ADMIN ONLY: it names the reporter, which no member-facing
 * answer ever does (T-13-32).
 *
 * - `excerpt` is the snapshot taken when the report was filed (at most `REPORT_EXCERPT_MAX` characters), so the row
 *   still reads when the content is gone; `contentAvailable` says whether the subject is still live, which is how
 *   the web chooses between the excerpt and "Conteúdo não está mais disponível".
 * - `reporter` and `author` names are read LIVE (`displayName: null` for a departed member, the web's "Membro
 *   removido"); `author.isMember` is the server's answer to "may the block-author row be offered" (the web never
 *   compares a role).
 * - `createdAt` and `resolvedAt` are UTC ISO strings with microseconds, formatted by Postgres (the cursor's `n`).
 */
export const reportItemSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    subjectType: z.enum(REPORT_SUBJECT_TYPES),
    subjectId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().nullable(),
    excerpt: z.string(),
    status: z.enum(REPORT_STATUSES),
    resolvedAt: z.string().nullable(),
    contentAvailable: z.boolean(),
    reporter: z
      .object({ displayName: z.string().nullable(), avatarAssetId: z.uuid().nullable() })
      .strict(),
    author: z
      .object({
        displayName: z.string().nullable(),
        avatarAssetId: z.uuid().nullable(),
        isMember: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ReportItem = z.infer<typeof reportItemSchema>;

/** One keyset page of the queue, newest first. `nextCursor` is non-null EXACTLY when another row exists. */
export const reportListAnswerSchema = z
  .object({ items: z.array(reportItemSchema), nextCursor: z.string().nullable() })
  .strict();
export type ReportListAnswer = z.infer<typeof reportListAnswerSchema>;

/**
 * `POST /v1/admin/reports/{id}/resolve`. `reason` is the optional INTERNAL reason of the author's block (D-331):
 * trimmed, at most `MODERATION_REASON_MAX`, written only to `moderation_log.reason`, and ignored by the two
 * resolutions that carry none (a removal's log row has no reason by design).
 */
export const reportResolveBodySchema = z
  .object({
    resolution: z.enum(REPORT_RESOLVE_ACTIONS),
    reason: z
      .string()
      .trim()
      .refine((value: string) => value.length <= MODERATION_REASON_MAX, 'too_long')
      .optional()
      .transform((value) => (value === undefined || value === '' ? undefined : value)),
  })
  .strict();
export type ReportResolveBody = z.infer<typeof reportResolveBodySchema>;

/** The answer of the resolve: the report's id and its new status. */
export const reportResolveAnswerSchema = z
  .object({ id: z.uuid(), status: z.enum(REPORT_RESOLUTIONS) })
  .strict();
export type ReportResolveAnswer = z.infer<typeof reportResolveAnswerSchema>;

/** `POST /v1/blocks` (NATIVE-33): the member to block, by user id. */
export const blockBodySchema = z.object({ userId: z.uuid() }).strict();
export type BlockBody = z.infer<typeof blockBodySchema>;

/**
 * One member the caller blocked (UI-D-635), with the name and avatar the "Membros bloqueados" page shows. Only the
 * CALLER's own blocks are ever listed; a block never reveals the blocker to the blocked (T-13-32).
 */
export const blockedMemberSchema = z
  .object({
    userId: z.uuid(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    blockedAt: z.string(),
  })
  .strict();
export type BlockedMember = z.infer<typeof blockedMemberSchema>;

/** `GET /v1/blocks`: keyset like every list. */
export const blockListQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > REPORT_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(REPORT_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), REPORT_MAX_PAGE_SIZE))
      .default(REPORT_PAGE_SIZE),
  })
  .strict();
export type BlockListQuery = z.infer<typeof blockListQuerySchema>;

export const blockListAnswerSchema = z
  .object({ items: z.array(blockedMemberSchema), nextCursor: z.string().nullable() })
  .strict();
export type BlockListAnswer = z.infer<typeof blockListAnswerSchema>;

/** The answer of the block and unblock writes: `changed` is false for the idempotent repeat. */
export const blockChangeAnswerSchema = z.object({ changed: z.boolean() }).strict();
export type BlockChangeAnswer = z.infer<typeof blockChangeAnswerSchema>;

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
 *
 * 09.1-11 (D-498): `subscription_pending` is the fifth filter, appended LAST so the four earlier values
 * keep their slots. It narrows to the `active`, not-blocked `member`-role rows whose subscription is
 * not active (the access gate's cut set); it is shown in the UI only while `payments` is on (UI-D-523),
 * and with the gate off or the module disabled it answers an empty page. It is a FILTER, never a
 * membership state: `ADMIN_MEMBERSHIP_STATES` is unchanged and a cut member's `status` stays `active`.
 */
export const ADMIN_MEMBER_STATUSES = [
  'all',
  'active',
  'blocked',
  'invited',
  'subscription_pending',
] as const;
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
 * - `subscriptionPending` (09.1-11, D-498) is the same kind of key: ADMIN ONLY, OPTIONAL and emitted
 *   ONLY as `true`, on an `active`, not-blocked `member`-role row whose subscription is not active (the
 *   access gate's cut set). Absent means "not cut", with the gate off, the module disabled, a granted
 *   member, staff, an invited or a blocked row (a block outranks a cut and shows alone, D-489). It is
 *   a projection of the access state, never a status: `status` stays `active`.
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
    subscriptionPending: z.boolean().optional(),
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
