import type {
  AccessItem,
  AccessItemState,
  AccessListQuery,
  AccessPage,
  AccessResult,
} from '@rede-social/contracts/payments';
import { type SQL, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor } from '../paging';
import { grantManualAccess } from '../tenancy/access';

const log = moduleLogger('payments-access');

/**
 * The Acessos list and its four e-mail actions (09.1-10, D-489, D-504, PAY-22).
 *
 * WHY THE ADMIN LANE. `access_grants` has RLS enabled and no policy (plan 02): its readers are the
 * SECURITY DEFINER functions and the admin lane. Every statement therefore names `tenant_id = ${tenantId}`
 * itself, and `tenantId` is ONLY ever `ctx.tenantId` (the membership of record from `requireAuth`),
 * never a body or a path value. WHO may call these is the route's `requirePermission('payments.manage')`.
 *
 * ONE ROW PER E-MAIL. The list groups every `access_grants` row of the tenant by the (already normalised)
 * e-mail. The STATE of a row is `app.access_effective(tenant, email)` mapped to the screen's three words;
 * nothing here re-implements the precedence of D-489, so the screen, the gate and the hooks cannot
 * disagree. `source` is `manual` when the effective state is `blocked` or no gateway row exists, otherwise
 * the gateway's provider key; `validUntil` is the latest gateway end date.
 *
 * THE SEARCH is a contains match done with `position(q in email)` on a bound parameter: a `%` or `_` in
 * the box is a literal character, never a wildcard (T-09.1-52). The e-mail column is already lower-case
 * (table CHECK) and `q` is lower-cased in SQL.
 *
 * THE PAGE is a keyset over `(updated_at desc, email desc)`, a TOTAL order (the e-mail is unique per
 * group), so two rows with the same instant keep a stable slot. The cursor is the shared `{ v, n, id }`
 * envelope of `../paging.ts`: `n` is the JSON array `[updatedAt, email]` read back from the projection
 * (the instant at microsecond precision, never re-derived in JavaScript) and `id` is the nil uuid, because
 * this order's tiebreaker is the e-mail and not a row id. A tampered, truncated or foreign `n` decodes to
 * "no cursor" (page 1), never to an error.
 *
 * THE FOUR ACTIONS never edit each other's row (planning decision 3): `block` and `release` are two
 * independent manual rows, so "Desbloquear" is a delete of the block that restores EXACTLY the previous
 * state. A gateway row can be blocked but never removed by hand: `removeRelease` deletes the manual
 * `active` row only. Each action is idempotent and answers the updated row, or `{ access: null }` when no
 * row remains for the address. No log line carries an e-mail.
 */

const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const ISO_MILLISECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const MICROSECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

type AccessRow = {
  email: string;
  updated_at: string;
  valid_until: string | null;
  provider: string | null;
  eff: string;
  has_account: boolean;
};

const toItem = (row: AccessRow): AccessItem => {
  // `none` cannot occur for a group built from existing rows; if it ever did, "not active" is the safe word.
  const state: AccessItemState =
    row.eff === 'active' ? 'active' : row.eff === 'blocked' ? 'blocked' : 'subscription_pending';
  return {
    id: row.email,
    email: row.email,
    source: state === 'blocked' || row.provider === null ? 'manual' : row.provider,
    state,
    validUntil: row.valid_until,
    hasAccount: row.has_account,
    updatedAt: row.updated_at,
  };
};

/**
 * The grouped projection both the list and the single read share, so they can never disagree. `needle`
 * filters the list; `only` pins one (normalised) e-mail for a write's read-back. Both are optional.
 */
const projection = (
  tenantId: string,
  filters: { needle: string | null; only: string | null },
): SQL => sql`
  with g as (
    select a.email,
           max(a.updated_at) as updated_at,
           max(a.valid_until) filter (where a.source = 'gateway') as valid_until,
           (array_agg(a.provider order by a.updated_at desc, a.id desc)
              filter (where a.source = 'gateway'))[1] as provider
      from public.access_grants a
     where a.tenant_id = ${tenantId}::uuid
       and (${filters.needle}::text is null or position(lower(${filters.needle}::text) in a.email) > 0)
       and (${filters.only}::text is null or a.email = lower(btrim(${filters.only}::text)))
     group by a.email
  ), r as (
    select g.email,
           g.updated_at,
           g.valid_until,
           g.provider,
           app.access_effective(${tenantId}::uuid, g.email) as eff,
           exists (
             select 1
               from public.memberships m
               join public.users u on u.id = m.user_id
              where m.tenant_id = ${tenantId}::uuid
                and m.deleted_at is null
                and lower(btrim(u.email)) = g.email
           ) as has_account
      from g
  )`;

const selectList = sql`
  select r.email,
         to_char(r.updated_at at time zone 'utc', ${ISO_MICROSECONDS}) as updated_at,
         to_char(r.valid_until at time zone 'utc', ${ISO_MILLISECONDS}) as valid_until,
         r.provider,
         r.eff,
         r.has_account
    from r`;

/** The computed state a `status` filter stands for, in the vocabulary `app.access_effective` answers. */
function effectiveOf(status: NonNullable<AccessListQuery['status']>): string {
  return status === 'subscription_pending' ? 'inactive' : status;
}

/** `[updatedAt, email]` out of the envelope's `n`, or `null` (page 1) for anything else. */
function decodeKeys(raw: string | undefined): { at: string; email: string } | null {
  const cursor = decodeCursor(raw);
  if (!cursor || cursor.id !== NIL_UUID) return null;
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
    typeof keys[1] !== 'string' ||
    !MICROSECOND_INSTANT.test(keys[0]) ||
    keys[1].length === 0 ||
    keys[1].length > 254
  ) {
    return null;
  }
  return { at: keys[0], email: keys[1] };
}

/** `GET /v1/payments/accesses`: one keyset page, one item per e-mail. */
export async function listAccesses(
  ctx: RequestContext,
  query: AccessListQuery,
): Promise<AccessPage> {
  const limit = query.limit;
  const needle = query.q === undefined || query.q === '' ? null : query.q;
  const after = decodeKeys(query.cursor);
  const wanted = query.status ? effectiveOf(query.status) : null;

  const rows = await withAdminTx({ tenantId: ctx.tenantId }, (tx) =>
    tx.execute<AccessRow>(sql`
      ${projection(ctx.tenantId, { needle, only: null })}
      ${selectList}
       where (${wanted}::text is null or r.eff = ${wanted}::text)
         and (
           ${after?.at ?? null}::text is null
           or (r.updated_at, r.email) < (${after?.at ?? null}::timestamptz, ${after?.email ?? null}::text)
         )
       order by r.updated_at desc, r.email desc
       limit ${limit + 1}`),
  );

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ n: JSON.stringify([last.updated_at, last.email]), id: NIL_UUID })
      : null;

  log.info(
    {
      event: 'payments.access.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      status: query.status ?? null,
      hasQuery: needle !== null,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'payments access list read',
  );

  return { items: page.map(toItem), nextCursor, serverNow: new Date().toISOString() };
}

/** The item for one address in the caller's transaction, or `null` when no row remains for it. */
async function readItem(tx: Tx, tenantId: string, email: string): Promise<AccessItem | null> {
  const rows = await tx.execute<AccessRow>(sql`
    ${projection(tenantId, { needle: null, only: email })}
    ${selectList}
     limit 1`);
  const row = rows[0];
  return row ? toItem(row) : null;
}

type Action = 'release' | 'block' | 'unblock' | 'remove_release';

function logged(ctx: RequestContext, action: Action): void {
  log.info(
    {
      event: `payments.access.${action}`,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
    },
    'payments access changed',
  );
}

/**
 * "Liberar e-mail": a manual `active` row, before or after the account exists (D-492, PAY-22). Refused
 * with `409 { payments: 'blocked' }` while a manual block exists: the admin must unblock first. Idempotent.
 */
export async function releaseEmail(ctx: RequestContext, email: string): Promise<AccessResult> {
  const access = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    const blocked = await tx.execute<{ id: string }>(sql`
      select id from public.access_grants
       where tenant_id = ${ctx.tenantId}::uuid
         and email = lower(btrim(${email}))
         and source = 'manual' and status = 'blocked'
       limit 1`);
    if (blocked.length > 0) throw new ApiError(409, 'CONFLICT', { payments: 'blocked' });
    await grantManualAccess(tx, { tenantId: ctx.tenantId, email, createdBy: ctx.userId });
    return readItem(tx, ctx.tenantId, email);
  });
  logged(ctx, 'release');
  return { access };
}

/**
 * "Bloquear acesso": a manual `blocked` row beside whatever else the address holds. A block outranks every
 * other row (D-489) and never edits the release or a gateway row. Idempotent. Staff are exempt from the
 * gate, so blocking a staff address has no effect on the staff member.
 */
export async function blockEmail(ctx: RequestContext, email: string): Promise<AccessResult> {
  const access = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    await tx.execute(sql`
      insert into public.access_grants (tenant_id, email, source, status, created_by_user_id)
      values (${ctx.tenantId}::uuid, lower(btrim(${email})), 'manual', 'blocked', ${ctx.userId}::uuid)
      on conflict (tenant_id, email, status) where source = 'manual' do nothing`);
    return readItem(tx, ctx.tenantId, email);
  });
  logged(ctx, 'block');
  return { access };
}

/**
 * "Desbloquear acesso": deletes the manual `blocked` row only, so the previous state is restored exactly.
 * An address with no row at all is the bare 404; one with rows but no block answers its current row.
 */
export async function unblockEmail(ctx: RequestContext, email: string): Promise<AccessResult> {
  const access = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    const removed = await tx.execute<{ id: string }>(sql`
      delete from public.access_grants
       where tenant_id = ${ctx.tenantId}::uuid
         and email = lower(btrim(${email}))
         and source = 'manual' and status = 'blocked'
       returning id`);
    const item = await readItem(tx, ctx.tenantId, email);
    if (item === null && removed.length === 0) throw new ApiError(404, 'NOT_FOUND');
    return item;
  });
  logged(ctx, 'unblock');
  return { access };
}

/**
 * "Remover liberação": deletes the manual `active` row only. A gateway row cannot be removed by hand (the
 * gateway owns it), so an address with no manual release is the bare 404.
 */
export async function removeRelease(ctx: RequestContext, email: string): Promise<AccessResult> {
  const access = await withAdminTx({ tenantId: ctx.tenantId }, async (tx) => {
    const removed = await tx.execute<{ id: string }>(sql`
      delete from public.access_grants
       where tenant_id = ${ctx.tenantId}::uuid
         and email = lower(btrim(${email}))
         and source = 'manual' and status = 'active'
       returning id`);
    if (removed.length === 0) throw new ApiError(404, 'NOT_FOUND');
    return readItem(tx, ctx.tenantId, email);
  });
  logged(ctx, 'remove_release');
  return { access };
}
