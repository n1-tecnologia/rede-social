import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { type SQL, sql } from 'drizzle-orm';
import {
  COMMUNITY_PAGE_SIZE,
  type CommunityPage,
  type CommunityQuery,
  type CommunityStatus,
  type CommunitySummary,
  type CreateCommunity,
  type ReorderCommunities,
  type UpdateCommunity,
} from '../contracts/index';

const log = moduleLogger('module-communities');

/**
 * The communities service (COMM-01, COMM-02, COMM-03) — a PURE TENANT-LANE area.
 *
 * Every function is `withTenantTx(ctx, …)`: the tenant is never a parameter a caller supplies and
 * never a value this file compares. Layer 3 (`communities_tenant_isolation`) supplies it under the
 * explicit `tenant_id` predicate the statements also carry, which is what makes the cross-tenant 404
 * fall out of the SAME code path as an unknown id — there is nothing here that compares tenant ids,
 * so no later edit can turn that 404 into a 403 that confirms the row exists somewhere (D-23).
 *
 * The admin-lane transaction helper is Biome-confined to `packages/core/server/{tenancy,platform,
 * media}` and is not importable here at all.
 */

/**
 * One hydrated row of the list projection. Snake_case: it comes straight off `tx.execute`, which
 * returns the driver's own row objects — NOT Drizzle's column-mapped ones — so the timestamp arrives
 * as text and is formatted by the statement itself (see `ISO_MICROSECONDS`).
 */
type CommunityRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  cover_asset_id: string | null;
  cover_variant_widths: number[] | null;
  post_count: number;
  status: CommunityStatus;
  last_activity_at: string;
  /**
   * The ARCHIVED list's cursor key only (05.1, D-91): `updated_at` formatted to microseconds by the
   * statement, selected through `communityProjection`'s `extra` column. `toCommunity` never reads it,
   * so it can never reach the wire (`communitySummarySchema` is `.strict()` and unchanged).
   */
  cursor_at?: string;
  /**
   * The ACTIVE list's leading cursor key only (2026-10-03): the admin's `position`, selected through
   * the same `extra` column. Like `cursor_at` it is never read by `toCommunity`, so the position never
   * reaches the wire — the array order already IS the answer.
   */
  cursor_position?: number;
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres rather than by JavaScript — the
 * `listFeed` rule restated for this module's ordering column.
 *
 * This matters for correctness, not tidiness. The cursor's `n` is this exact string, and the page
 * predicate compares it back as `::timestamptz`. Round-tripping through a JS `Date` would truncate
 * `timestamptz`'s microseconds to milliseconds, moving the page boundary EARLIER than the row it
 * came from — which silently SKIPS any community whose activity landed in the same millisecond but a
 * later microsecond. Keeping the full precision in text makes `(last_activity_at, id)` a genuinely
 * total order end to end.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * A cursor's instant must be one this service could have issued BEFORE it reaches a `::timestamptz`
 * cast — the events/chat rule (T-06-04), restated here because modules cannot import each other.
 * `decodeCursor` only proves `n` is a string, and a tampered `n` would otherwise be a 500 instead of
 * the first page. The shape alone is not enough (`2026-02-30` or hour `99` match it and still fail
 * the cast), so the calendar fields must also survive a UTC round trip.
 *
 * It became load-bearing here on 2026-10-03: the two lists now carry DIFFERENT `n` shapes, and a
 * cursor carries no status (D-88), so an active cursor replayed on the archived branch must degrade
 * to page 1 rather than reach the cast as `3~2026-…`.
 */
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;

function isCursorInstant(value: string): boolean {
  const match = CURSOR_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000) return false;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second
  );
}

/** The ARCHIVED list's cursor: `decodeCursor`, then page 1 (null) unless `n` is a real instant. */
function decodeArchivedCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  return decoded && isCursorInstant(decoded.n) ? decoded : null;
}

/** Postgres `integer` bounds: a position outside them cannot have come from the column. */
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * The ACTIVE list's `n` (2026-10-03): `{position}~{last_activity_at}`. The repo has ONE cursor
 * envelope (`{ v, n, id }`, `core/server/paging`), and its docblock forbids a second one — so the
 * list's extra leading key rides INSIDE `n` rather than as a new field. `~` cannot occur in either
 * half (an integer, an ISO instant), so the split is unambiguous.
 *
 * A pre-2026-10-03 cursor (a bare instant) has no `~` and degrades to page 1, which is what any
 * stale cursor does (T-05-05). Nothing parses this outside this file: the web forwards the cursor
 * verbatim and never reads it.
 */
const ACTIVE_KEY = /^(-?\d{1,10})~(.+)$/;

const activeCursorKey = (position: number, lastActivityAt: string): string =>
  `${position}~${lastActivityAt}`;

/** Where an ACTIVE page resumes: after `(position, at, id)` in the list's mixed-direction order. */
type ActiveCursor = { position: number; at: string; id: string };

/**
 * TOTAL, like `decodeCursor`: anything that is not `{int4}~{instant}` over a valid envelope is page
 * 1 (null), and nothing from the string reaches SQL before it passed every check here.
 */
function decodeActiveCursor(raw: string | undefined): ActiveCursor | null {
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  const match = ACTIVE_KEY.exec(decoded.n);
  if (!match) return null;
  const position = Number(match[1]);
  const at = match[2] ?? '';
  if (!Number.isInteger(position) || position < INT4_MIN || position > INT4_MAX) return null;
  if (!isCursorInstant(at)) return null;
  return { position, at, id: decoded.id };
}

/**
 * THE projection, written once and shared by the list and the detail read so the two can never
 * disagree about what a community looks like.
 *
 * The cover's variant ladder comes back in the SAME statement as the community (Pitfall 3/11): a
 * page costs ONE statement, never one plus N, and `feed-query-budget.test.ts` asserts that with a
 * ceiling AND a floor. The `left join media_assets` carries NO tenant condition —
 * `media_assets_tenant_select` is what decides visibility in this lane, so writing one would be dead
 * weight a reader could mistake for the actual isolation. A soft-deleted cover simply drops out and
 * the card falls back to the `--brand-gradient` block, exactly as a null `cover_asset_id` does.
 *
 * `created_by_user_id` is deliberately ABSENT from the select list (D-67): the container has no
 * human byline, and a column that never leaves the database cannot leak into a payload by accident.
 *
 * `extra` (05.1) is how the ARCHIVED list adds the one column its cursor is built from without
 * duplicating this column list — the `storyProjection(viewerUserId, extra)` precedent. Every other
 * call site passes nothing and renders exactly the column list it always did. An extra column is a
 * CURSOR key, never a payload field: `toCommunity` does not read it.
 */
function communityProjection(extra: SQL | null = null) {
  return sql`
    select c.id,
           c.name,
           c.slug,
           c.description,
           c.cover_asset_id,
           a.variant_widths as cover_variant_widths,
           c.post_count,
           c.status,
           to_char(c.last_activity_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_activity_at
           ${extra ?? sql``}
      from communities c
      left join media_assets a on a.id = c.cover_asset_id`;
}

/** Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. */
const toCommunity = (row: CommunityRow): CommunitySummary => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  description: row.description,
  coverAssetId: row.cover_asset_id,
  // `[]` for a cover-less community AND for a cover whose asset the lane cannot see: both are the
  // gradient branch, and the card must not have to tell them apart.
  coverVariantWidths: row.cover_variant_widths ?? [],
  postCount: row.post_count,
  status: row.status,
  lastActivityAt: row.last_activity_at,
});

/**
 * THE active-list statement — one page of the tenant's ACTIVE communities in the list's order —
 * written once and shared by `listCommunities` and by `reorderCommunities`' answer, so the page a
 * reorder hands back can never be ordered differently from the page the next GET returns.
 *
 * **The order is `position asc, last_activity_at desc, id desc`** (2026-10-03), the exact column list
 * and directions of `communities_tenant_position_idx`, so the index DELIVERS the order and no Sort
 * node appears (pgTAP 110 cases 17-18). It is TOTAL: `(position, last_activity_at, id)` cannot tie,
 * so a page boundary can neither duplicate nor skip a row. Every row starts at position 0, so until
 * an admin reorders, the list is D-76's activity order exactly; a reorder writes 1..n, so a community
 * created afterwards (0) is listed FIRST, and inside one position — the never-reordered 0s, or a
 * reactivated community whose old position now coincides with another's — activity still decides.
 *
 * **The keyset runs in MIXED directions**, which is why it is spelled out rather than built from
 * `keysetComparison` (whose row comparison serves one direction): after `(p, at, id)` comes every row
 * with a LATER position, or the same position and an EARLIER `(last_activity_at, id)`. It is written
 * as `position >= p and (position > p or (at, id) < …)` — the same set — because the leading
 * `position >= p` is a range the index can SEEK to (probed: `Index Cond: … AND position >= p`), so a
 * later page starts at the cursor's position group instead of filtering every row before it. Inside
 * that one group the rows before the cursor are still filtered rather than seeked past, which costs
 * nothing at the size of a tenant's community list (the same trade the `… is null or …` guard already
 * makes for the generic plan).
 *
 * The cursor's leading key is the row's own `position`, read back through the projection's `extra`
 * column (`cursor_position`), and its instant is the projection's own `last_activity_at` text, so
 * neither is re-derived in JavaScript (the `ISO_MICROSECONDS` rule).
 *
 * A literal `c.status = 'active'`, never a bound parameter: it is provably implied by the index's
 * partial predicate whatever plan the server caches (pgTAP 110 cases 15, 17 and 18).
 */
async function activePage(
  tx: Tx,
  ctx: RequestContext,
  limit: number,
  after: ActiveCursor | null,
): Promise<CommunityRow[]> {
  const afterPosition = after?.position ?? null;
  const afterAt = after?.at ?? null;
  const afterId = after?.id ?? null;
  return tx.execute<CommunityRow>(sql`
      ${communityProjection(sql`, c.position as cursor_position`)}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and (
           ${afterPosition}::int is null
           or (
             c.position >= ${afterPosition}::int
             and (
               c.position > ${afterPosition}::int
               or (c.last_activity_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
             )
           )
         )
       order by c.position asc, c.last_activity_at desc, c.id desc
       limit ${limit + 1}`);
}

/**
 * The ARCHIVED statement (05.1, D-88/D-91, managers only — the route enforces D-89): `updated_at
 * desc, id desc`, most recently archived first, because there is no `archived_at` and none is added.
 * The accepted consequence, pinned by a test: an archived community EDITED afterwards moves to the
 * top. Its cursor `n` is `updated_at` formatted to microseconds by the statement (`cursor_at`) and
 * never reaches the payload. NO index serves this branch, by decision: the archived set of a tenant
 * is small and only managers read it, and the budget test pins it to ONE statement with the covers
 * hydrated. A later index is a purely additive migration. The admin's `position` plays no part here:
 * the order an admin chooses is the ACTIVE list's, and archiving does not ask for one.
 */
async function archivedPage(
  tx: Tx,
  ctx: RequestContext,
  limit: number,
  after: { n: string; id: string } | null,
): Promise<CommunityRow[]> {
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  return tx.execute<CommunityRow>(sql`
      ${communityProjection(
        sql`, to_char(c.updated_at at time zone 'utc', ${ISO_MICROSECONDS}) as cursor_at`,
      )}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'archived'
         and (
           ${afterAt}::timestamptz is null
           or (c.updated_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.updated_at desc, c.id desc
       limit ${limit + 1}`);
}

/** The active list's `n`, from the row the statement ordered: `{position}~{last_activity_at}`. */
const activeKey = (row: CommunityRow): string | undefined =>
  row.cursor_position === undefined || row.cursor_position === null
    ? undefined
    : activeCursorKey(row.cursor_position, row.last_activity_at);

/** The archived list's `n`: its own `updated_at`, formatted by the statement. */
const archivedKey = (row: CommunityRow): string | undefined => row.cursor_at;

/**
 * Over-fetched rows → one published page. `nextCursor` is non-null EXACTLY when another row exists
 * (the `limit + 1` rule), so the sentinel never fires a "load more" that comes back empty. Each list
 * passes its OWN key, read back from the statement that ordered by it.
 */
function pageOf(
  rows: CommunityRow[],
  limit: number,
  keyOf: (row: CommunityRow) => string | undefined,
): CommunityPage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const lastKey = last ? keyOf(last) : undefined;
  const nextCursor =
    rows.length > limit && last && lastKey ? encodeCursor({ n: lastKey, id: last.id }) : null;
  return { items: page.map(toCommunity), nextCursor };
}

/**
 * `GET /v1/communities?limit=&cursor=&status=` (COMM-02, COMM-03, D-76) — one keyset page of the
 * tenant's ACTIVE communities in the admin's order, most recent activity first inside it (or, with
 * `status=archived`, its archived ones — see the two statements above).
 *
 * **COMM-02 is a POLICY value, expressed as an absence.** Neither statement joins
 * `community_members`: every member of the tenant therefore receives the identical item-id set
 * regardless of role, which is what "all of them" means as a rule rather than as a coincidence. V2's
 * restricted communities add a predicate here and a policy there — not a migration. The admin's
 * order is the same kind of value: one `position` per community, so every member reads the same
 * order an admin chose.
 *
 * **Two branches, two COMPLETE literal statements (05.1, D-88/D-91).** `query.status` picks one in
 * TypeScript; it is never a bound SQL parameter, so each statement's predicate and ordering are fixed
 * text the planner (and pgTAP's EXPLAIN) can match to an index by name.
 *
 * Each branch is its own keyset with its own `n` shape — `{position}~{instant}` for the active list,
 * a bare instant for the archived one — and each decoder is TOTAL: a tampered, truncated, stale or
 * other-list cursor degrades to page 1 instead of raising, and nothing from the string reaches SQL
 * before it passed `cursorSchema` and the shape checks (T-05-05). A cursor carries no status, so a
 * cursor replayed on the other list is exactly such a stale cursor.
 */
export async function listCommunities(
  ctx: RequestContext,
  query: CommunityQuery,
): Promise<CommunityPage> {
  const limit = query.limit;
  const archived = query.status === 'archived';

  const rows = await withTenantTx(ctx, (tx) =>
    archived
      ? archivedPage(tx, ctx, limit, decodeArchivedCursor(query.cursor))
      : activePage(tx, ctx, limit, decodeActiveCursor(query.cursor)),
  );

  const { items, nextCursor } = pageOf(rows, limit, archived ? archivedKey : activeKey);

  // The SHAPE of the read — counts, ids and flags. A community NAME is member-facing content and
  // never reaches a log line, an error `details` payload or an OpenAPI example (T-05-06).
  log.info(
    {
      event: 'communities.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      // A closed enum value — the shape of the read, never its content.
      status: query.status,
      limit,
      returned: items.length,
      hasNext: nextCursor !== null,
    },
    'communities listed',
  );

  return { items, nextCursor };
}

/**
 * `GET /v1/communities/{communityId}` (COMM-03, T-05-01/T-05-02).
 *
 * ONE bare 404 with NO `details` payload for every miss — unknown id, another tenant's id,
 * soft-deleted. A details key here, even `{ community: 'not_found' }` vs `{ community: 'deleted' }`,
 * would be an existence oracle over an enumerable uuid space (D-23, the `getPost` posture).
 *
 * An ARCHIVED community is still readable (05-04 renders it with the "Arquivada" pill): archiving
 * gates the WRITES and removes the row from the list, it does not hide what was already published.
 */
export async function getCommunity(
  ctx: RequestContext,
  communityId: string,
): Promise<CommunitySummary> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<CommunityRow>(sql`
      ${communityProjection()}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.id = ${communityId}::uuid
         and c.deleted_at is null
       limit 1`);
    return rows[0];
  });

  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toCommunity(row);
}

/**
 * The per-tenant URL segment, derived from the display name: lowercased, accent-folded, every run of
 * non-alphanumerics collapsed to a single `-`, trimmed of leading/trailing separators and capped.
 *
 * `normalize('NFD')` + stripping the combining range is what turns "Avisos da Diretoria" into
 * `avisos-da-diretoria` and "Ação" into `acao` — an ASCII slug, so the URL survives copy/paste
 * through systems that mangle percent-encoding. A name made entirely of emoji or punctuation folds
 * to the empty string, which is why `slugCandidate` has a fallback: a community must always have a
 * slug, and `communities_tenant_slug_uq` then disambiguates the collisions that follow.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/** The base slug plus the nth disambiguating suffix. `n === 0` is the bare slug. */
function slugCandidate(base: string, attempt: number): string {
  const root = base.length > 0 ? base : 'comunidade';
  return attempt === 0 ? root : `${root}-${attempt + 1}`;
}

/** Postgres' unique-violation SQLSTATE, walked out of whatever the driver wrapped it in. */
function isSlugCollision(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23505' && candidate.constraint_name === 'communities_tenant_slug_uq') {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** How many suffixes to try before giving up. Ten same-named communities is already absurd. */
const SLUG_ATTEMPTS = 10;

/** What the cover lookup inside a community WRITE's transaction needs to decide. */
type CoverAssetRow = { kind: string; purpose: string; status: string };

/**
 * The cover reference, resolved INSIDE the writing transaction — shared verbatim by create and
 * update (05-09, T-05-40/T-05-41), exactly as `publishStory` resolves a story's asset.
 *
 * **Why this exists at all.** `cover_asset_id` used to go from the request body straight into SQL.
 * The single-column foreign key cannot stand in for this check: Postgres referential integrity runs
 * as the TABLE OWNER and therefore bypasses RLS, so another tenant's asset id PERSISTED — and the
 * 23503-vs-201 split (random uuid → 500; real foreign id → 201) was a working cross-tenant existence
 * oracle over an enumerable uuid space.
 *
 * **Two answers, and the difference between them is the whole point.**
 *  - NO ROW, for any reason — another tenant's, unknown, soft-deleted — is ONE bare 404 with no
 *    `details`, byte-identical to the answer an unknown COMMUNITY id gets. The read runs in the
 *    tenant lane, so `media_assets_tenant_select` is what makes a foreign id simply not come back;
 *    there is nothing here that compares tenant ids, so no later edit can turn this into a 403 that
 *    confirms the asset exists somewhere (D-23).
 *  - A row that IS present but unusable is `400 { community: 'cover_invalid' }`. The caller can see
 *    that one and fixing it is their job, so it is information they already had, not an oracle.
 *
 * **The accepted tuple is exactly `purpose = 'cover'`, `kind = 'image'`, `status = 'ready'`.** The
 * feed's D-53 concession — publish while a video transcodes and show the `processando` placeholder —
 * is a VIDEO concession and is deliberately NOT inherited: a cover is never a video, and a cover
 * whose bytes do not exist yet renders as exactly the `--brand-gradient` block the admin was trying
 * to replace.
 *
 * A null id returns immediately and performs NO lookup: "no cover" is a first-class value (D-69).
 *
 * Its boolean sibling is `coverIsUsable`, which answers the SAME tuple rule off the SAME lookup
 * without throwing — for the one caller that must not refuse a request over a cover the request
 * never asserted (see `updateCommunity`).
 */
async function resolveCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string | null,
): Promise<void> {
  if (coverAssetId === null) return;

  const asset = await loadCoverAsset(tx, ctx, coverAssetId);
  // Unknown, another tenant's, or soft-deleted — one indistinguishable answer, no details.
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (!isUsableCover(asset)) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'cover_invalid' });
  }
}

/**
 * THE cover lookup — one select statement, and every consumer is built on it.
 *
 * `resolveCoverAsset` and `coverIsUsable` answer different questions about the same row (throw vs.
 * boolean), but they must never answer them off different QUERIES: two copies of the
 * `(tenant_id, deleted_at is null)` predicate would eventually drift, and the weaker copy is the one
 * a write path would end up trusting. Same statement, same tuple rule, one place to change either.
 */
async function loadCoverAsset(
  tx: Tx,
  ctx: RequestContext,
  coverAssetId: string,
): Promise<CoverAssetRow | undefined> {
  const rows = await tx.execute<CoverAssetRow>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${coverAssetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
     limit 1`);
  return rows[0];
}

/** The accepted tuple, stated ONCE so the throwing and boolean answers cannot disagree. */
function isUsableCover(asset: CoverAssetRow): boolean {
  return asset.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready';
}

/**
 * Is the STORED cover reference still usable? The non-throwing half of `resolveCoverAsset`.
 *
 * The distinction this exists to serve: a request that ASSERTS a cover id is answerable — refuse it
 * and the admin can see what they sent and fix it. A request that asserts NOTHING about the cover is
 * not: refusing it reports "Comunidade nao encontrada" about a community that is open on the admin's
 * screen, and no later write to that row can ever succeed again. So a dangling stored reference is
 * self-healed (dropped to null) rather than enforced — see `updateCommunity`.
 */
async function coverIsUsable(tx: Tx, ctx: RequestContext, coverAssetId: string): Promise<boolean> {
  const asset = await loadCoverAsset(tx, ctx, coverAssetId);
  return asset !== undefined && isUsableCover(asset);
}

/**
 * `POST /v1/communities` (COMM-01).
 *
 * - `tenantId` and `createdByUserId` come from `ctx`, never from the body (T-04-02, T-07-01). The
 *   policy's `with check (tenant_id = app.tenant_id())` makes a forged stamp a `42501` rather than a
 *   cross-tenant write, so the rule is enforced twice on purpose.
 * - **Two communities may share a NAME.** A repeat create is a second container, not a conflict:
 *   there is no 409 anywhere on this path. `communities_tenant_slug_uq` serialises two concurrent
 *   creates that derive the same slug, and the loser RETRIES the next suffix rather than surfacing a
 *   500 — which is also why the retry loop is a loop and not a pre-flight `select` (a read-then-write
 *   with no lock is exactly the race the unique index exists to win).
 * - `post_count` and `last_activity_at` are NOT in the insert: both are trigger-owned and take their
 *   column defaults (`0` and `now()`), which is the right answer for a community with no posts.
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only QUEUES the event on
 *   `ctx.events`; the response middleware delivers it once the handler returned. A subscriber can
 *   therefore never observe a community that a rollback erased (MOD-03).
 */
export async function createCommunity(
  ctx: RequestContext,
  input: CreateCommunity,
): Promise<CommunitySummary> {
  // The service re-states the route's rule: `createCommunity` is also reachable from the seed and
  // from any handler that assembles its own input, none of which pass through the route validator.
  if (input.name.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'name_required' });
  }

  const base = slugify(input.name);
  let created: CommunityRow | undefined;

  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
    const slug = slugCandidate(base, attempt);
    try {
      created = await withTenantTx(ctx, (tx) => insertCommunity(tx, ctx, input, slug));
      break;
    } catch (error) {
      if (isSlugCollision(error)) continue;
      throw error;
    }
  }

  if (!created) throw new ApiError(500, 'INTERNAL');

  emit(ctx, 'community.created', {
    tenantId: ctx.tenantId,
    communityId: created.id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'communities.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId: created.id,
      // Lengths and flags, never the words themselves (T-05-06).
      nameLength: input.name.length,
      descriptionLength: input.description.length,
      hasCover: created.cover_asset_id !== null,
    },
    'community created',
  );

  return toCommunity(created);
}

/**
 * The insert and its read-back, in ONE transaction: the created community is returned in exactly the
 * shape the list returns, so the form can prepend it without a second request. Separated out so the
 * slug-collision retry above re-enters a FRESH transaction — retrying inside an aborted one would
 * fail on every statement.
 *
 * The cover is resolved HERE rather than before the retry loop, for the same reason: the lookup
 * belongs to whichever transaction performs the write, so the two cannot interleave with another
 * statement of this request (05-09).
 */
async function insertCommunity(
  tx: Tx,
  ctx: RequestContext,
  input: CreateCommunity,
  slug: string,
): Promise<CommunityRow> {
  // FIRST statement of the transaction: a refused cover writes nothing at all. `isSlugCollision`
  // matches a 23505 on the slug index alone, so this `ApiError` is re-thrown by the retry loop
  // untouched rather than swallowed as a collision.
  await resolveCoverAsset(tx, ctx, input.coverAssetId ?? null);

  const inserted = await tx.execute<{ id: string }>(sql`
    insert into communities (tenant_id, created_by_user_id, name, slug, description, cover_asset_id)
    values (${ctx.tenantId}::uuid,
            ${ctx.userId}::uuid,
            ${input.name},
            ${slug},
            ${input.description},
            ${input.coverAssetId ?? null}::uuid)
    returning id`);
  const id = inserted[0]?.id;
  if (!id) throw new ApiError(500, 'INTERNAL');

  const rows = await tx.execute<CommunityRow>(sql`
    ${communityProjection()}
     where c.id = ${id}::uuid
     limit 1`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return row;
}

/**
 * `PATCH /v1/communities/{communityId}` (COMM-01, UI-D-37) — edit, archive and reactivate.
 *
 * **ONE function, because archive is a STATUS WRITE and not a separate verb.** Splitting it into
 * `archiveCommunity` / `reactivateCommunity` would be three code paths writing one column, and the
 * three would eventually disagree about what an unchanged request answers.
 *
 * **What archive MEANS** (05-RESEARCH §Pattern 7, settled here): a WRITE gate and a LIST gate, never
 * a feed gate. An archived community keeps its existing posts in the merged feed exactly where
 * members already saw them (`listFeed` carries no archive predicate at all — the measured
 * alternative is a sequential scan plus a sort, and the denormalised one is a table-wide UPDATE plus
 * a fourth index plus a new class of drift); disappears from `GET /v1/communities` (one predicate,
 * already there); still OPENS by id, read-only; refuses new posts with the closed `archived` code
 * that 05-03 already raises; and is reversible with one PATCH back to `active`.
 *
 * **Every miss is the SAME bare 404** the read path answers — unknown id, another tenant's,
 * soft-deleted — because the update statement carries the identical predicate and RLS supplies the
 * tenant beneath it. There is nothing here that compares tenant ids, so no later edit can turn that
 * 404 into a 403 that confirms the row exists somewhere (D-23, T-05-20).
 *
 * **`post_count` and `last_activity_at` are not in the `set` list and must never be.** They are
 * trigger-owned; an edit is not activity, and a list ordered by "who edited most recently" would
 * answer a different question than D-76 asks. `updated_at` moves only when something actually
 * changed, which is what makes a no-op PATCH observably a no-op.
 *
 * **Two events, both id-shaped, both after commit.** `community.updated` on a CONTENT change and
 * `community.archived` on the TRANSITION into `archived`. A repeat archive changes no row, so it
 * announces nothing — the event counts transitions, not states.
 */
export async function updateCommunity(
  ctx: RequestContext,
  communityId: string,
  input: UpdateCommunity,
): Promise<CommunitySummary> {
  // The service re-states the route's rule: this function is also reachable from the seed and from
  // any handler that assembles its own input, none of which pass through the route validator.
  if (input.name !== undefined && input.name.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'name_required' });
  }

  const { row, contentChanged, archivedNow } = await withTenantTx(ctx, async (tx) => {
    // The row is read FIRST, inside the same transaction, because three of this function's answers
    // depend on what it was: the 404, whether anything actually changed, and whether this write is
    // the transition into `archived` rather than a repeat of it.
    const current = await tx.execute<CommunityRow>(sql`
      ${communityProjection()}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.id = ${communityId}::uuid
         and c.deleted_at is null
       limit 1`);
    const before = current[0];
    if (!before) throw new ApiError(404, 'NOT_FOUND');

    const name = input.name ?? before.name;
    const description = input.description ?? before.description;
    let coverAssetId =
      input.coverAssetId === undefined ? before.cover_asset_id : input.coverAssetId;
    const status = input.status ?? before.status;

    // **Validate the cover the REQUEST asserts; never the one the row merely stores.** The
    // difference is the whole of CR-01, and it is a difference in who can act on the refusal:
    //
    //  - The request SENT a `coverAssetId` (an explicit id, or an explicit `null`): it made a claim,
    //    so it owns the answer. `resolveCoverAsset` refuses exactly as before — a re-sent unusable
    //    id is still the bare 404, which is what stops a bad id a pre-fix release wrote from
    //    surviving by being re-sent unchanged. `null` returns before any lookup, so an explicit
    //    clear still costs nothing.
    //  - The request said NOTHING about the cover (rename, description edit, archive, reactivate)
    //    but the STORED reference no longer resolves — the community's own admin retired it through
    //    `DELETE /v1/media/{assetId}`, which is a state the product itself produces. Enforcing it
    //    here bricked the row: every later write 404'd forever and the BFF reported "Comunidade nao
    //    encontrada" about a community open on the admin's screen. A retired cover is "no cover", a
    //    first-class value (D-69), so the dangling reference is DROPPED rather than enforced.
    //
    // The self-heal is BOUNDED by `changedContent` below: nulling the reference makes this PATCH a
    // real write (one `updated_at` move, one `community.updated`), and the next identical PATCH
    // finds nothing dangling and is observably inert again — a one-time repair, not a write forever.
    if (input.coverAssetId !== undefined) {
      await resolveCoverAsset(tx, ctx, coverAssetId);
    } else if (coverAssetId !== null && !(await coverIsUsable(tx, ctx, coverAssetId))) {
      coverAssetId = null;
    }

    const changedContent =
      name !== before.name ||
      description !== before.description ||
      coverAssetId !== before.cover_asset_id;
    const changedStatus = status !== before.status;

    // Nothing moved: no statement, no `updated_at`, no event. A PATCH identical to the stored row
    // must be observably inert, not merely idempotent in its response body.
    if (!changedContent && !changedStatus) {
      return { row: before, contentChanged: false, archivedNow: false };
    }

    await tx.execute(sql`
      update communities
         set name = ${name},
             description = ${description},
             cover_asset_id = ${coverAssetId}::uuid,
             status = ${status},
             updated_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and id = ${communityId}::uuid
         and deleted_at is null`);

    const rows = await tx.execute<CommunityRow>(sql`
      ${communityProjection()}
       where c.id = ${communityId}::uuid
       limit 1`);
    const after = rows[0];
    if (!after) throw new ApiError(500, 'INTERNAL');

    return {
      row: after,
      contentChanged: changedContent,
      archivedNow: changedStatus && status === 'archived',
    };
  });

  if (contentChanged) {
    emit(ctx, 'community.updated', {
      tenantId: ctx.tenantId,
      communityId: row.id,
      actorUserId: ctx.userId,
    });
  }
  if (archivedNow) {
    emit(ctx, 'community.archived', {
      tenantId: ctx.tenantId,
      communityId: row.id,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'communities.updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId: row.id,
      // Flags and lengths, never the words themselves (T-05-06).
      contentChanged,
      archivedNow,
      status: row.status,
      hasCover: row.cover_asset_id !== null,
    },
    'community updated',
  );

  return toCommunity(row);
}

/**
 * `PUT /v1/communities/order` (2026-10-03) — the admin's order of the ACTIVE list, written as
 * `position = 1..n` in the order the request names. The `reorderHighlights` shape, retargeted.
 *
 * One `withTenantTx`, three steps:
 *  1. **Lock.** The tenant's ACTIVE, live rows are locked `for update`, in id order — one fixed
 *     order, so two reorders racing each other queue instead of deadlocking.
 *  2. **Compare.** The LOCKED id set must equal the request's: same size and identical members.
 *     Anything else — a community created, archived or removed since the admin's screen loaded, an
 *     unknown id, another tenant's id — is ONE `409 { community: 'order_stale' }` and nothing is
 *     written. Locking first is what makes the comparison mean something: an archive racing this
 *     reorder either commits before the lock (its row no longer matches `status = 'active'` when the
 *     lock re-reads it, so the set differs) or waits for it. A create is not blocked by row locks;
 *     one that commits after the comparison simply lands at position 0, which lists it first — the
 *     documented place for a new community, and no row of the admin's order moved.
 *  3. **Renumber.** ONE statement writes `position = 1..n` from `unnest(…) with ordinality`,
 *     touching only rows whose position really changes, and `updated_at` moves with them — and only
 *     with them: a repeat of the same order writes nothing and moves nothing (idempotent, observably
 *     inert, the no-op PATCH rule).
 *
 * The answer is page 1 of the active list in the new order, read by `activePage` — the SAME
 * statement `GET /v1/communities` runs — inside the same transaction, so what the admin sees after
 * saving is exactly what every member's next read returns.
 *
 * **What it never touches.** Archived rows: they are outside the lock, outside the comparison, and
 * the renumber carries the same `status = 'active'` predicate besides. A reactivated community keeps
 * the position it had, and where that now coincides with another row's, activity breaks the tie
 * until the next reorder. `post_count` and `last_activity_at` stay trigger-owned (fact 2 of the
 * schema docblock): an order is not activity.
 *
 * **No event.** Nothing subscribes to an order, and an event nobody reads is a payload shape frozen
 * for free (the `community.reactivated` precedent in the contracts). The log line below carries the
 * shape of the write; adding `community.reordered` later is one line in the contracts.
 *
 * Duplicates are refused by the contract before this runs (400: a list naming one community twice is
 * malformed, not stale), and re-stated here for any caller that does not pass through the route.
 * Ids are compared lower-cased, because two spellings of one uuid are one community.
 */
export async function reorderCommunities(
  ctx: RequestContext,
  input: ReorderCommunities,
): Promise<CommunityPage> {
  const requested = input.ids.map((id) => id.toLowerCase());
  if (new Set(requested).size !== requested.length) {
    throw new ApiError(400, 'VALIDATION_FAILED');
  }

  const { page, moved } = await withTenantTx(ctx, async (tx) => {
    const locked = await tx.execute<{ id: string }>(sql`
      select c.id
        from communities c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
       order by c.id
       for update`);
    const current = new Set(locked.map((row) => row.id));
    if (requested.length !== current.size || requested.some((id) => !current.has(id))) {
      throw new ApiError(409, 'CONFLICT', { community: 'order_stale' });
    }

    // The ids travel as ONE Postgres array literal: drizzle's `sql` would expand a JS array into a
    // comma-separated parameter list. Every element is a Zod-validated uuid AND a member of the set
    // just locked, so nothing caller-shaped reaches the literal.
    const renumbered = await tx.execute<{ id: string }>(sql`
      update communities c
         set position = o.ord::int,
             updated_at = now()
        from unnest(${`{${requested.join(',')}}`}::uuid[]) with ordinality as o(id, ord)
       where c.id = o.id
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and c.position <> o.ord
      returning c.id`);

    const rows = await activePage(tx, ctx, COMMUNITY_PAGE_SIZE, null);
    return { page: pageOf(rows, COMMUNITY_PAGE_SIZE, activeKey), moved: renumbered.length };
  });

  log.info(
    {
      event: 'communities.reordered',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      // Counts only: neither the ids' order nor a name belongs in a log line (T-05-06).
      count: requested.length,
      moved,
    },
    'communities reordered',
  );

  return page;
}
