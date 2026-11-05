import type { BlockListAnswer, BlockListQuery } from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import { withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { moduleLogger } from '../logging';
import { decodeCursor, encodeCursor, keysetComparison } from '../paging';
import { mapReportError } from './reports';

const log = moduleLogger('member-blocks');

/**
 * Member blocks, the API half (Phase 13, plan 14, D-616; NATIVE-33; T-13-32). The rules are SQL (plan 08:
 * `app.member_block_create`, `app.member_block_delete`, the `member_blocks_select` policy that shows a lane only its
 * OWN blocks); this file calls them in the caller's tenant transaction and lists the caller's blocks.
 *
 * A BLOCK IS SILENT. It notifies nobody, emits no event, and the blocked member cannot read that it exists: the
 * select policy hides the row from them, from a third member and from the admin, so the only reader of a block is its
 * blocker. What a block does is a VIEWER predicate on the read paths (`app.is_blocked_by_viewer`, added to the feed
 * queries); it hides nothing from anyone else and changes no counter (AD-3). A block of a member is a block of the
 * PERSON IN THIS COMMUNITY only: the table is keyed by tenant, so the same two people in another community are
 * unaffected.
 */

const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function decodeInstantCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  if (!decoded || !CURSOR_INSTANT.test(decoded.n)) return null;
  return Number.isNaN(Date.parse(decoded.n)) ? null : decoded;
}

/**
 * `POST /v1/blocks`. `app.member_block_create` returns whether THIS call created the row, so a repeat answers
 * `changed: false` with the same 200. `BL001` (the target is not a live `member` of the caller's tenant: a staff
 * account, a person of another tenant, an unknown id, a blocked or removed member, oneself) is 400 `CANNOT_BLOCK`
 * with ONE body for every case, so the route is no oracle for who exists or who is staff.
 */
export async function blockMember(
  ctx: RequestContext,
  userId: string,
): Promise<{ changed: boolean }> {
  try {
    const rows = await withTenantTx(ctx, (tx) =>
      tx.execute<{ created: boolean }>(
        sql`select app.member_block_create(${userId}::uuid) as created`,
      ),
    );
    const changed = rows[0]?.created === true;
    // Ids only; never the target. The blocker is the per-request logger's user id.
    log.info(
      { event: 'block.created', tenantId: ctx.tenantId, requestId: ctx.requestId, changed },
      'member blocked',
    );
    return { changed };
  } catch (error) {
    throw mapReportError(error);
  }
}

/** `DELETE /v1/blocks/{userId}`: lifts the caller's OWN block; a repeat, or no block, is `changed: false`. */
export async function unblockMember(
  ctx: RequestContext,
  userId: string,
): Promise<{ changed: boolean }> {
  try {
    const rows = await withTenantTx(ctx, (tx) =>
      tx.execute<{ removed: boolean }>(
        sql`select app.member_block_delete(${userId}::uuid) as removed`,
      ),
    );
    const changed = rows[0]?.removed === true;
    log.info(
      { event: 'block.removed', tenantId: ctx.tenantId, requestId: ctx.requestId, changed },
      'member unblocked',
    );
    return { changed };
  } catch (error) {
    throw mapReportError(error);
  }
}

type BlockRow = {
  user_id: string;
  created_at: string;
  display_name: string | null;
  avatar_asset_id: string | null;
};

/**
 * `GET /v1/blocks` (UI-D-635): the caller's own blocks, newest first `(created_at desc, blocked user id desc)`, with
 * the name and avatar read LIVE (a departed member reads `displayName: null`). The select policy returns only the
 * caller's rows, and the explicit `blocker_user_id = ctx.userId` is what the primary key's prefix matches on. Over-
 * fetch by one: `nextCursor` is non-null EXACTLY when another row exists; a tampered cursor degrades to page 1.
 */
export async function listBlocks(
  ctx: RequestContext,
  query: BlockListQuery,
): Promise<BlockListAnswer> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const cmp = keysetComparison('desc');

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<BlockRow>(sql`
      select b.blocked_user_id as user_id,
             to_char(b.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             case when m.id is null then null else p.display_name end as display_name,
             case when m.id is null then null else p.avatar_asset_id end as avatar_asset_id
        from member_blocks b
        left join memberships m
               on m.tenant_id = b.tenant_id and m.user_id = b.blocked_user_id and m.deleted_at is null
        left join member_profiles p on p.membership_id = m.id
       where b.tenant_id = ${ctx.tenantId}::uuid
         and b.blocker_user_id = ${ctx.userId}::uuid
         and (
           ${afterAt}::timestamptz is null
           or (b.created_at, b.blocked_user_id) ${sql.raw(cmp.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by b.created_at ${sql.raw(cmp.order)}, b.blocked_user_id ${sql.raw(cmp.order)}
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.user_id }) : null;

  log.info(
    {
      event: 'block.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'blocks listed',
  );
  return {
    items: page.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarAssetId: row.avatar_asset_id,
      blockedAt: row.created_at,
    })),
    nextCursor,
  };
}
