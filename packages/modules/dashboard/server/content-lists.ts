import { cutOnWord } from '@rede-social/contracts/text';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { type SQL, sql } from 'drizzle-orm';
import {
  type EngagementBandId,
  OWNER_CONTENT_PAGE_SIZE,
  OWNER_UNANSWERED_AFTER_HOURS,
  OWNER_UNANSWERED_EXCERPT_GRAPHEMES,
  type OwnerContentCommentRow,
  type OwnerContentInteractionRow,
  type OwnerContentInteractionsAnswer,
  type OwnerContentLikeRow,
  type OwnerContentListQuery,
  type OwnerContentPeopleAnswer,
  type OwnerContentPeopleId,
  type OwnerContentPerson,
  type OwnerContentUnansweredAnswer,
  type OwnerContentUnansweredRow,
} from '../contracts/index';
import { contentFlags, contentItemGate, readContentFrame, storedItem } from './content';
import { ISO_US } from './member-lists';
import { pageInput, pageOf } from './paging';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/**
 * The live rows behind Conteúdo's numbers (08.7-06, D-461, D-462, P3, P4, INSIGHT-10): who liked
 * and who commented one publication, every interaction of the window, and the comments waiting for
 * the team. Read live in the admin's lane, bounded by the newest snapshot (planning decision 4 —
 * `untilAt`, never `now()`), with the build's predicates, so a list agrees with its number: members
 * only (role `member`, active, never blocked or deleted, UI-D-484), likes on the item itself, LIVE
 * comments. The unanswered list is the one live exception: a to-do list, its 24-hour cut uses the
 * read time. Each row names a member by their live name and today's band; a comment's text travels
 * ONLY on the unanswered list (P4). Never who viewed a story (PR-5): no view list exists.
 *
 * Paging: the plan 04 helper (`limit` 1..50, 20 by default; a malformed cursor reads page 1).
 */

/** Columns of the person (`ms`, `mp`, `r` joined by `memberOf`). */
const personColumns = sql`
  ms.id::text as membership_id,
  coalesce(mp.display_name, '') as display_name,
  mp.avatar_asset_id::text as avatar_asset_id,
  r.band as band`;

/** Joins the counted member of `userColumn` in `tenantId`, with profile and today's band. */
function memberOf(tenantId: string, userColumn: SQL): SQL {
  return sql`
    join public.memberships ms
      on ms.tenant_id = ${tenantId}::uuid
     and ms.user_id = ${userColumn}
     and ms.role = 'member'
     and ms.status = 'active'
     and ms.blocked_at is null
     and ms.deleted_at is null
    left join public.member_profiles mp
      on mp.tenant_id = ms.tenant_id and mp.membership_id = ms.id
    left join public.dashboard_member_snapshots r
      on r.tenant_id = ms.tenant_id and r.membership_id = ms.id`;
}

/** A root comment is answered by a live reply of a CURRENT `admin_tenant` / `support_tenant`. */
function staffReplied(tenantId: string, commentId: SQL, before: SQL | null): SQL {
  return sql`exists (
    select 1 from public.feed_comments x
      join public.memberships st
        on st.tenant_id = ${tenantId}::uuid
       and st.user_id = x.author_user_id
       and st.role in ('admin_tenant', 'support_tenant')
       and st.status = 'active'
       and st.blocked_at is null
       and st.deleted_at is null
     where x.tenant_id = ${tenantId}::uuid
       and x.parent_id = ${commentId}
       and x.deleted_at is null
       ${before ? sql`and x.created_at < ${before}` : sql``})`;
}

type PersonDb = {
  membership_id: string;
  display_name: string;
  avatar_asset_id: string | null;
  band: EngagementBandId | null;
};

const personOf = (row: PersonDb): OwnerContentPerson => ({
  membershipId: row.membership_id,
  displayName: row.display_name,
  avatarAssetId: row.avatar_asset_id,
  band: row.band,
});

/** `(at, id) < (n, id)` when a cursor is present, else true: the `at desc, id desc` keyset. */
const before = (at: SQL, id: SQL, after: { n: string; id: string } | null) =>
  after ? sql`(${at}, ${id}) < (${after.n}::timestamptz, ${after.id}::uuid)` : sql`true`;

/** `(at, id) > (n, id)` when a cursor is present, else true: the `at asc, id asc` keyset. */
const afterRow = (at: SQL, id: SQL, after: { n: string; id: string } | null) =>
  after ? sql`(${at}, ${id}) > (${after.n}::timestamptz, ${after.id}::uuid)` : sql`true`;

/**
 * A comments page sorts unanswered roots FIRST, then by `at desc`, on one keyset: an unanswered
 * row's sort instant is its own `at` plus this many years, so the cursor stays one ISO instant.
 */
const UNANSWERED_FIRST_YEARS = 1000;

/**
 * `GET /v1/dashboard/owner/content/items/{itemId}/people/{who}`: the members who liked (`at desc,
 * id desc`) or commented (unanswered roots first, then `at desc, id desc`) one publication, before
 * the snapshot's `untilAt`. A comments row says who and when and whether the team answered it,
 * never the text. `total` is the item's own number in the build. The item gate runs first (the
 * bare 404 of a foreign or unknown id in every state), then the snapshot (none → preparing).
 */
export async function listOwnerContentPeople(
  ctx: Ctx,
  itemId: string,
  who: OwnerContentPeopleId,
  input: OwnerContentListQuery,
): Promise<OwnerContentPeopleAnswer> {
  const flags = await contentFlags(ctx);
  const { limit, after } = pageInput(input, OWNER_CONTENT_PAGE_SIZE, 'instant');
  return withTenantTx(ctx, async (tx): Promise<OwnerContentPeopleAnswer> => {
    const kind = await contentItemGate(tx, ctx.tenantId, itemId, flags);
    const frame = await readContentFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const item = storedItem(frame.content, itemId);
    const untilAt = sql`${frame.snapshot.windows.untilAt}::timestamptz`;
    const base = { state: 'ready' as const, snapshot: frame.snapshot };

    if (who === 'likes') {
      const target = kind === 'post' ? sql`l.post_id` : sql`l.story_id`;
      const rows = await tx.execute<PersonDb & { id: string; at: string }>(sql`
        select l.id::text as id, to_char(l.created_at at time zone 'UTC', ${ISO_US}) as at,
               ${personColumns}
          from public.feed_likes l
          ${memberOf(ctx.tenantId, sql`l.user_id`)}
         where l.tenant_id = ${ctx.tenantId}::uuid
           and ${target} = ${itemId}::uuid
           and l.created_at < ${untilAt}
           and ${before(sql`l.created_at`, sql`l.id`, after)}
         order by l.created_at desc, l.id desc
         limit ${limit + 1}`);
      const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
      return {
        ...base,
        who,
        total: item.likes,
        rows: page.rows.map(
          (row): OwnerContentLikeRow => ({ id: row.id, at: row.at, member: personOf(row) }),
        ),
        nextCursor: page.nextCursor,
      };
    }

    const target = kind === 'post' ? sql`c.post_id` : sql`c.story_id`;
    const answeredExpr =
      kind === 'post'
        ? sql`case when c.parent_id is null
                   then ${staffReplied(ctx.tenantId, sql`c.id`, untilAt)} end`
        : sql`null::boolean`;
    const rows = await tx.execute<
      PersonDb & { id: string; at: string; sort_at: string; answered: boolean | null }
    >(sql`
      with c as (
        select c.id, c.created_at, ${answeredExpr} as answered, ${personColumns}
          from public.feed_comments c
          ${memberOf(ctx.tenantId, sql`c.author_user_id`)}
         where c.tenant_id = ${ctx.tenantId}::uuid
           and ${target} = ${itemId}::uuid
           and c.deleted_at is null
           and c.created_at < ${untilAt}
      ),
      s as (
        select c.*,
               case when c.answered is false
                    then c.created_at + make_interval(years => ${UNANSWERED_FIRST_YEARS})
                    else c.created_at end as sort_at
          from c
      )
      select s.id::text as id, to_char(s.created_at at time zone 'UTC', ${ISO_US}) as at,
             to_char(s.sort_at at time zone 'UTC', ${ISO_US}) as sort_at, s.answered,
             s.membership_id, s.display_name, s.avatar_asset_id, s.band
        from s
       where ${before(sql`s.sort_at`, sql`s.id`, after)}
       order by s.sort_at desc, s.id desc
       limit ${limit + 1}`);
    const page = pageOf(rows, limit, (row) => ({ n: row.sort_at, id: row.id }));
    return {
      ...base,
      who,
      total: item.comments,
      rows: page.rows.map(
        (row): OwnerContentCommentRow => ({
          id: row.id,
          at: row.at,
          member: personOf(row),
          answered: row.answered,
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
}

/** Posts-only lists need `feed` (404 `MODULE_DISABLED` without it, like a hidden scope, D-460). */
async function feedFlags(ctx: Ctx) {
  const flags = await contentFlags(ctx);
  if (!flags.feed) throw new ApiError(404, 'MODULE_DISABLED');
  return flags;
}

/**
 * `GET /v1/dashboard/owner/content/interactions`: every member like and live comment on a live post
 * published in the snapshot's 30 days, before its `untilAt`, most recent first (`at desc, id desc`),
 * with the post it was on — the rows behind `kpis.interactions.current`, its `total`.
 */
export async function listOwnerContentInteractions(
  ctx: Ctx,
  input: OwnerContentListQuery,
): Promise<OwnerContentInteractionsAnswer> {
  await feedFlags(ctx);
  const { limit, after } = pageInput(input, OWNER_CONTENT_PAGE_SIZE, 'instant');
  return withTenantTx(ctx, async (tx): Promise<OwnerContentInteractionsAnswer> => {
    const frame = await readContentFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const { from30At, untilAt } = frame.snapshot.windows;
    const rows = await tx.execute<
      PersonDb & { kind: 'like' | 'comment'; id: string; at: string; item_id: string }
    >(sql`
      with w as (
        select p.id from public.feed_posts p
         where p.tenant_id = ${ctx.tenantId}::uuid
           and p.deleted_at is null
           and p.created_at >= ${from30At}::timestamptz
           and p.created_at < ${untilAt}::timestamptz
      ),
      x as (
        select 'like'::text as kind, l.id, l.created_at as at, l.post_id as item_id, l.user_id
          from public.feed_likes l
          join w on w.id = l.post_id
         where l.tenant_id = ${ctx.tenantId}::uuid
           and l.created_at < ${untilAt}::timestamptz
        union all
        select 'comment', c.id, c.created_at, c.post_id, c.author_user_id
          from public.feed_comments c
          join w on w.id = c.post_id
         where c.tenant_id = ${ctx.tenantId}::uuid
           and c.deleted_at is null
           and c.created_at < ${untilAt}::timestamptz
      )
      select x.kind, x.id::text as id, to_char(x.at at time zone 'UTC', ${ISO_US}) as at,
             x.item_id::text as item_id, ${personColumns}
        from x
        ${memberOf(ctx.tenantId, sql`x.user_id`)}
       where ${before(sql`x.at`, sql`x.id`, after)}
       order by x.at desc, x.id desc
       limit ${limit + 1}`);
    const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
    return {
      state: 'ready',
      snapshot: frame.snapshot,
      total: frame.content.kpis.interactions.current,
      rows: page.rows.map(
        (row): OwnerContentInteractionRow => ({
          kind: row.kind,
          id: row.id,
          at: row.at,
          itemId: row.item_id,
          member: personOf(row),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
}

/**
 * `GET /v1/dashboard/owner/content/unanswered` (planning decision 4, P4, EP-27): the live ROOT
 * member comments on live posts with no live reply by current staff (at any time: answering takes
 * a comment off the to-do list at once), written in the snapshot's 30 days AND more than 24 hours
 * before the read, oldest first (`at asc, id asc`), each WITH its text cut to 200 characters on a
 * word boundary and the post "Responder" opens. Story comments are never here (UI-D-489 b).
 */
export async function listOwnerContentUnanswered(
  ctx: Ctx,
  input: OwnerContentListQuery,
): Promise<OwnerContentUnansweredAnswer> {
  await feedFlags(ctx);
  const { limit, after } = pageInput(input, OWNER_CONTENT_PAGE_SIZE, 'instant');
  return withTenantTx(ctx, async (tx): Promise<OwnerContentUnansweredAnswer> => {
    const frame = await readContentFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const { from30At, untilAt } = frame.snapshot.windows;
    const waiting = sql`
        from public.feed_comments c
        join public.feed_posts p
          on p.id = c.post_id and p.tenant_id = c.tenant_id and p.deleted_at is null
        ${memberOf(ctx.tenantId, sql`c.author_user_id`)}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.post_id is not null
         and c.parent_id is null
         and c.deleted_at is null
         and c.created_at >= ${from30At}::timestamptz
         and c.created_at < ${untilAt}::timestamptz
         and c.created_at < now() - make_interval(hours => ${OWNER_UNANSWERED_AFTER_HOURS})
         and not ${staffReplied(ctx.tenantId, sql`c.id`, null)}`;
    const rows = await tx.execute<
      PersonDb & { id: string; post_id: string; at: string; body: string }
    >(sql`
      select c.id::text as id, c.post_id::text as post_id,
             to_char(c.created_at at time zone 'UTC', ${ISO_US}) as at, c.body, ${personColumns}
        ${waiting}
         and ${afterRow(sql`c.created_at`, sql`c.id`, after)}
       order by c.created_at asc, c.id asc
       limit ${limit + 1}`);
    const [counted] = await tx.execute<{ n: number }>(sql`select count(*)::int as n ${waiting}`);
    const page = pageOf(rows, limit, (row) => ({ n: row.at, id: row.id }));
    return {
      state: 'ready',
      snapshot: frame.snapshot,
      total: Number(counted?.n ?? 0),
      rows: page.rows.map(
        (row): OwnerContentUnansweredRow => ({
          id: row.id,
          postId: row.post_id,
          at: row.at,
          text: cutOnWord(row.body, OWNER_UNANSWERED_EXCERPT_GRAPHEMES),
          member: personOf(row),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
}
