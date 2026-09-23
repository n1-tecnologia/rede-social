import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  CommunityPage,
  CommunityQuery,
  CommunityStatus,
  CommunitySummary,
  CreateCommunity,
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
 */
const communityProjection = sql`
    select c.id,
           c.name,
           c.slug,
           c.description,
           c.cover_asset_id,
           a.variant_widths as cover_variant_widths,
           c.post_count,
           c.status,
           to_char(c.last_activity_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_activity_at
      from communities c
      left join media_assets a on a.id = c.cover_asset_id`;

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
 * `GET /v1/communities?limit=&cursor=` (COMM-02, COMM-03, D-76) — one keyset page of the tenant's
 * ACTIVE communities, most recent activity first.
 *
 * **COMM-02 is a POLICY value, expressed as an absence.** This statement never joins
 * `community_members`: every member of the tenant therefore receives the identical item-id set
 * regardless of role, which is what "all of them" means as a rule rather than as a coincidence. V2's
 * restricted communities add a predicate here and a policy there — not a migration.
 *
 * Ordering is `last_activity_at desc, id desc`, which is the ordered pair
 * `communities_tenant_activity_idx` is built on and is TOTAL: two communities whose activity lands in
 * the same microsecond occupy two stable adjacent slots that a page boundary can neither duplicate
 * nor skip. The cursor's `n` is the row's own `last_activity_at`, read back from the projection
 * rather than re-derived in JavaScript, so it can never disagree with the index.
 *
 * `decodeCursor` is TOTAL (see its docblock): a tampered, truncated or stale envelope degrades to
 * page 1 instead of raising, and nothing from the string reaches SQL before `cursorSchema` accepted
 * it (T-05-05).
 */
export async function listCommunities(
  ctx: RequestContext,
  query: CommunityQuery,
): Promise<CommunityPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<CommunityRow>(sql`
      ${communityProjection}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and c.status = 'active'
         and (
           ${afterAt}::timestamptz is null
           or (c.last_activity_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.last_activity_at desc, c.id desc
       limit ${limit + 1}`),
  );

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists, so the sentinel
  // never fires a "load more" that comes back empty.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.last_activity_at, id: last.id }) : null;

  // The SHAPE of the read — counts, ids and flags. A community NAME is member-facing content and
  // never reaches a log line, an error `details` payload or an OpenAPI example (T-05-06).
  log.info(
    {
      event: 'communities.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'communities listed',
  );

  return { items: page.map(toCommunity), nextCursor };
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
      ${communityProjection}
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
 */
async function insertCommunity(
  tx: Tx,
  ctx: RequestContext,
  input: CreateCommunity,
  slug: string,
): Promise<CommunityRow> {
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
    ${communityProjection}
     where c.id = ${id}::uuid
     limit 1`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return row;
}
