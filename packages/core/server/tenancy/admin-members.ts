import type { TenantRole } from '@rede-social/contracts';
import type {
  AdminMember,
  AdminMemberListQuery,
  AdminMemberPage,
  AdminMembershipState,
} from '@rede-social/contracts/moderation';
import { type SQL, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor } from '../paging';
import { likeEscape, normaliseQuery } from '../profiles/search';

const log = moduleLogger('admin-members');

/**
 * The Membros admin list and the single read behind the member sheet (ADMIN-02, D-340, UI-D-271/272).
 *
 * WHY THE ADMIN LANE (a deliberate deviation from RESEARCH, which proposed the tenant lane). The row
 * carries the member's E-MAIL, and `users` is self-select only in the tenant lane; an invited admin
 * also has no profile name yet, so the e-mail is the only thing that identifies them. The read runs in
 * `withAdminTx` (allowed under `packages/core/server/tenancy/**`, Biome's lane rule), and RLS is
 * therefore OFF: **the `m.tenant_id = ${ctx.tenantId}` predicate on every statement is the only
 * isolation** (T-08-19). `ctx.tenantId` is the membership of record from `requireAuth`, never input.
 * WHO may call these is the route's `requirePermission('members.manage', 'moderation.manage')` —
 * the e-mail never reaches anyone without one of the two (ADMIN-02 privacy prohibition, T-08-23).
 *
 * STATUS FOLDING. `blocked` is `m.status = 'blocked' or m.blocked_at is not null` — the same rule
 * `app.membership_for_user` applies, so a legacy row with only `blocked_at` set reads as blocked here
 * exactly as `requireAuth` refuses it. `invited` and `active` both require `blocked_at is null`, so the
 * three filters are disjoint and cover every live row.
 *
 * ORDERING (ADMIN-02 ordering, explicit). The accent- and case-insensitive display name, a membership
 * without a profile name sorting by its e-mail; then the lower-cased e-mail; then `m.id`. The order is
 * TOTAL, so two "Ana Souza" rows occupy two stable adjacent slots and a `limit=1` walk visits each
 * membership exactly once.
 *
 * E-MAIL CONFIRMATION (quick 261007-gzu). `email_unconfirmed` is the one fact read from GoTrue's
 * `auth.users`, which neither `api_user` nor the admin lane can SELECT. Its only reader is
 * `app.membership_email_unconfirmed(tenant, membership)`: SECURITY DEFINER, empty search_path,
 * executable by `service_role` alone, a BOOLEAN and nothing else. The tenant argument is the REQUEST's
 * `ctx.tenantId` (the membership of record), never the row's `m.tenant_id`: should a future edit drop
 * the `m.tenant_id` predicate, a foreign row would read false instead of leaking. No filter, no query
 * parameter, no change to ordering, cursor or counts: an unconfirmed member is listed like any other.
 *
 * THE CURSOR. The shared `{ v, n, id }` envelope from `../paging.ts` (one implementation in the repo).
 * `keysetComparison` is not used: it pairs a timestamp-or-name `n` with an `id`, and this order has
 * THREE keys. Here `n` is the JSON array `[sortName, sortEmail]` read back from the projection (never
 * re-folded in JavaScript), and the page predicate is a three-column row comparison in ascending
 * order. A tampered, truncated or foreign `n` decodes to "no cursor" — page 1 — never to an error.
 */

type AdminMemberRow = {
  membership_id: string;
  display_name: string | null;
  email: string;
  avatar_asset_id: string | null;
  role: TenantRole;
  status: AdminMembershipState;
  is_viewer: boolean;
  email_unconfirmed: boolean;
  sort_name: string;
  sort_email: string;
};

/** The SELECT list and FROM clause both reads share, so the list and the sheet can never disagree. */
const projection = (ctx: Pick<RequestContext, 'tenantId' | 'userId'>): SQL => sql`
  select m.id as membership_id,
         nullif(mp.display_name, '') as display_name,
         u.email,
         mp.avatar_asset_id,
         m.role,
         case
           when m.status = 'blocked' or m.blocked_at is not null then 'blocked'
           when m.status = 'invited' then 'invited'
           else 'active'
         end as status,
         (m.user_id = ${ctx.userId}::uuid) as is_viewer,
         app.membership_email_unconfirmed(${ctx.tenantId}::uuid, m.id) as email_unconfirmed,
         app.imm_unaccent(lower(coalesce(nullif(mp.display_name, ''), u.email))) as sort_name,
         lower(u.email) as sort_email
    from memberships m
    join users u on u.id = m.user_id
    left join member_profiles mp on mp.membership_id = m.id`;

const toMember = (row: AdminMemberRow): AdminMember => ({
  membershipId: row.membership_id,
  displayName: row.display_name,
  email: row.email,
  avatarAssetId: row.avatar_asset_id,
  role: row.role,
  status: row.status,
  isViewer: row.is_viewer,
  emailUnconfirmed: row.email_unconfirmed,
});

/** The status filter as one SQL fragment — the SAME folding the projection's `case` applies. */
function statusPredicate(status: AdminMemberListQuery['status']): SQL {
  switch (status) {
    case 'active':
      return sql`and m.status = 'active' and m.blocked_at is null`;
    case 'blocked':
      return sql`and (m.status = 'blocked' or m.blocked_at is not null)`;
    case 'invited':
      return sql`and m.status = 'invited' and m.blocked_at is null`;
    default:
      return sql``;
  }
}

/** `[sortName, sortEmail]` out of the envelope's `n`, or `null` (page 1) for anything else. */
function decodeKeys(raw: string | undefined): { name: string; email: string; id: string } | null {
  const cursor = decodeCursor(raw);
  if (!cursor) return null;
  let keys: unknown;
  try {
    keys = JSON.parse(cursor.n);
  } catch {
    return null;
  }
  if (
    !Array.isArray(keys) ||
    keys.length !== 2 ||
    typeof keys[0] !== 'string' ||
    typeof keys[1] !== 'string'
  ) {
    return null;
  }
  return { name: keys[0], email: keys[1], id: cursor.id };
}

/**
 * One membership of THIS tenant, in the caller's transaction. Shared by `getMemberForAdmin` and the
 * block/unblock writes in `./member-admin.ts`, which answer the row's state after their own update.
 * An unknown id, another tenant's id or a soft-deleted membership is the bare 404 (no details).
 */
export async function readMemberForAdmin(
  tx: Tx,
  ctx: Pick<RequestContext, 'tenantId' | 'userId'>,
  membershipId: string,
): Promise<AdminMember> {
  const rows = await tx.execute<AdminMemberRow>(sql`
    ${projection(ctx)}
     where m.id = ${membershipId}::uuid
       and m.tenant_id = ${ctx.tenantId}::uuid
       and m.deleted_at is null
     limit 1`);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toMember(row);
}

/** `GET /v1/admin/members/{membershipId}` — the sheet's data for one membership (UI-D-272). */
export async function getMemberForAdmin(
  ctx: RequestContext,
  membershipId: string,
): Promise<AdminMember> {
  return withAdminTx((tx) => readMemberForAdmin(tx, ctx, membershipId));
}

/**
 * `GET /v1/admin/members?q=&status=&cursor=&limit=` — one keyset page of EVERY membership of the
 * tenant (D-340): members, staff, blocked and invited, the viewer's own row included.
 *
 * `q` is normalised and escaped by the directory's own `normaliseQuery` / `likeEscape` (a `%` is a
 * literal percent sign, T-03-21 / T-08-25) and matched as a substring of the accent-folded display
 * name OR the lower-cased e-mail. An empty or spaces-only `q` is no filter. The log line carries the
 * SHAPE of the search, never its text.
 */
export async function listMembersForAdmin(
  ctx: RequestContext,
  query: AdminMemberListQuery,
): Promise<AdminMemberPage> {
  const limit = query.limit;
  const term = normaliseQuery(query.q);
  const needle = term === null ? null : likeEscape(term);
  const after = decodeKeys(query.cursor);

  const rows = await withAdminTx((tx) =>
    tx.execute<AdminMemberRow>(sql`
      ${projection(ctx)}
       where m.tenant_id = ${ctx.tenantId}::uuid
         and m.deleted_at is null
         ${statusPredicate(query.status)}
         and (
           ${needle}::text is null
           or app.imm_unaccent(lower(coalesce(mp.display_name, '')))
              like '%' || app.imm_unaccent(lower(${needle}::text)) || '%' escape '\\'
           or lower(u.email) like '%' || lower(${needle}::text) || '%' escape '\\'
         )
         and (
           ${after?.name ?? null}::text is null
           or (
             app.imm_unaccent(lower(coalesce(nullif(mp.display_name, ''), u.email))),
             lower(u.email),
             m.id
           ) > (${after?.name ?? null}::text, ${after?.email ?? null}::text, ${after?.id ?? null}::uuid)
         )
       order by app.imm_unaccent(lower(coalesce(nullif(mp.display_name, ''), u.email))),
                lower(u.email),
                m.id
       limit ${limit + 1}`),
  );

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({
          n: JSON.stringify([last.sort_name, last.sort_email]),
          id: last.membership_id,
        })
      : null;

  log.info(
    {
      event: 'admin.members.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      status: query.status,
      hasQuery: term !== null,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'admin member list read',
  );

  return { items: page.map(toMember), nextCursor };
}
