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
  UpdateCommunity,
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
    ${communityProjection}
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
      ${communityProjection}
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
      ${communityProjection}
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
