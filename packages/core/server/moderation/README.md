# Kernel moderation capability

Moderation (MODER-01..03, ADMIN-02) is a kernel capability, not a module package: it has no flag
and is always on for every tenant (SCHEMA-CONVENTIONS §(f).2). It owns the append-only
`public.moderation_log` table, the one writer every moderator action calls, the paged reader behind
the Moderação screen, and member administration (block, unblock, role change) with its guards. The
feed and stories modules call the writer from their own comment-removal transactions; the tenant
admin panel's `/v1/admin` routes, which live in the app tier, call the reader and member admin.

## Contracts

Published through the kernel's `./server/*` export; nothing else may be imported.

- `@rede-social/core/server/moderation/log`
  - `recordModerationAction(tx, ctx, entry): Promise<string>` appends ONE row inside the caller's
    transaction and returns its id. It resolves the actor's and the target's memberships in
    `ctx.tenantId` in the same transaction and throws when either is missing, so the caller rolls
    back and an un-anchored row cannot exist.
  - `ModerationEntry`: `comment_removed` (`targetUserId`, `subjectType`, `subjectId`,
    `excerptSource`), `member_blocked` and `member_unblocked` (`targetUserId`, `targetMembershipId`,
    `reason`), `role_changed` (`targetUserId`, `targetMembershipId`, `details: { from, to }`).
  - `moderationExcerpt(body)` cuts a removed comment's body to `MODERATION_EXCERPT_MAX` (280 UTF-16
    code units) on a grapheme boundary.
- `@rede-social/core/server/moderation/read`
  - `listModerationLog(ctx, query): Promise<ModerationLogPage>`: one keyset page of the tenant's
    log, newest first, optionally narrowed to one action.
- `@rede-social/core/server/tenancy/member-admin` (admin lane, row locks)
  - `blockMembership(ctx, membershipId, { reason })` and `unblockMembership(ctx, membershipId,
    { reason })`: write `status` and `blocked_at` together plus the log row in one transaction.
    Refusals: `self`, `last_admin`, `not_active`, `blocked` (`MEMBER_ADMIN_REFUSALS`, 409
    `CONFLICT`).
  - `setMembershipRole(ctx, membershipId, role)`: locks every active admin and the target, refuses
    removing the last admin, writes `role_changed` with `{ from, to }`; a same-role call writes
    nothing. It takes effect on the next request, because permissions are composed from the
    membership row on every request.
- `@rede-social/core/server/tenancy/admin-members`: `listMembersForAdmin(ctx, query)`,
  `getMemberForAdmin(ctx, membershipId)`.
- `@rede-social/contracts/moderation`: `MODERATION_ACTIONS`, `MODERATION_SUBJECT_TYPES`,
  `MODERATION_EXCERPT_MAX`, `MODERATION_REASON_MAX`, `KERNEL_PERMISSIONS`, `commentRemovalSchema`,
  `moderationLogQuerySchema`, `moderationLogEntrySchema`, `moderationLogPageSchema`,
  `adminMemberListQuerySchema`, `adminMemberSchema`, `adminMemberPageSchema`,
  `memberAccessBodySchema`, `memberRoleBodySchema`, `MEMBER_ADMIN_REFUSALS`, `MembershipBlocked`.

**Permissions** (kernel grants, `KERNEL_ROLE_PERMISSIONS`, all to `admin_tenant` by default):
`moderation.manage` (remove anyone's comment, block and unblock, read the log), `members.manage`
(list members, change roles) and `tenant.manage` (branding and display name). Routes guard on the
permission, never on the role, so granting one to `support_tenant` needs no code.

**Routes** (app tier, `apps/api/src/routes/admin`, mounted at `/v1/admin`; each sub-router carries
its own `requireAuth`, so `ctx.tenantId` is the only tenant a handler acts on):

| Route | Guard |
|---|---|
| `GET /v1/admin/moderation-log` | `moderation.manage` |
| `GET /v1/admin/members`, `GET /v1/admin/members/{membershipId}` | `members.manage` or `moderation.manage` |
| `POST /v1/admin/members/{membershipId}/block`, `.../unblock` | `moderation.manage` |
| `PUT /v1/admin/members/{membershipId}/role` | `members.manage` |
| `/v1/admin/branding/*`, `PATCH /v1/admin/tenant` | `tenant.manage` |

**Append-only guarantees** on `public.moderation_log`: `update`, `delete` and `truncate` are
revoked from `anon`, `authenticated`, `service_role` and `api_user`; row and statement triggers raise
`moderation_log is append-only` even for the table owner; the tenant lane has only a select policy
(`tenant_id = app.tenant_id()`) and an insert policy that pins `tenant_id` and `actor_user_id` to the
lane's claims; CHECKs bind the action vocabulary, the comment subject, the 500-character reason, the
280-character excerpt and the `role_changed` details. The log carries ids only to pino; the excerpt
and the reason are read only through permission-guarded routes.

## Events emitted

- `membership.blocked`: `tenantId`, `userId`, `membershipId`. Emitted by `blockMembership` after its
  admin-lane transaction committed, and only when the block changed something. Never the reason.
  The notifications module consumes it to drop the member's push devices and nudge the open app.

## Events consumed

None. The writer must never be called from a bus subscriber: the bus delivers after commit and never
rethrows, so a log written there could be lost while the action stands. Call
`recordModerationAction(tx, …)` inside the transaction that performs the action.

## Kernel dependencies

- `@rede-social/core/db/tenant-tx` (the comment-removal callers' lane and the reader)
- `@rede-social/core/db/admin-tx` (member admin and the admin-member reads)
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/profiles/search` (member search normalisation)

## Navigation

No manifest and no nav entry. The web's Configurações page shows the rows to holders of the
permissions: Moderação at `/configuracoes/moderacao` (the log, `moderation.manage`) and Membros at
`/configuracoes/membros` (the member list, block, unblock and role change).

## Jobs

None. Blocks and role changes act synchronously; the push-device cleanup after a block is the
notifications module's subscriber.

## Reuse

A module that removes content calls `recordModerationAction(tx, ctx, { action: 'comment_removed', … })`
with its own `tx`, after re-deciding the removal under a row lock, exactly as the feed's
`deleteComment` and the stories module's comment removal do. A host app gets the capability by
copying the kernel with its migrations, granting the permissions through `KERNEL_ROLE_PERMISSIONS`
and mounting its own `/v1/admin` routes over the functions above. The worked example of mounting a
module on the kernel contracts alone is `packages/reuse-fixture`.
