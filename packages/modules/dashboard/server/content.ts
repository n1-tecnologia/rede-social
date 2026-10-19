import { cutOnWord } from '@rede-social/contracts/text';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  CONTENT_KINDS,
  type ContentItemAnswer,
  type ContentKindId,
  type ContentPayload,
  type ContentPayloadItem,
  contentPayloadSchema,
  OWNER_POST_EXCERPT_GRAPHEMES,
  type OwnerContentAnswer,
  type OwnerContentDetailAnswer,
  type OwnerContentDetailReady,
  type OwnerContentReady,
  type SnapshotMeta,
} from '../contracts/index';
import { floorBands, floorCount, sortFloored } from './floor';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/** The module flags Conteúdo reads, before the lane opens (the A-WR-03 order). */
export type ContentFlags = {
  feed: boolean;
  stories: boolean;
  communities: boolean;
  events: boolean;
  store: boolean;
};

/** The flags of `ctx`'s tenant; both `feed` and `stories` off is 404 `MODULE_DISABLED` (UI-D-473). */
export async function contentFlags(ctx: Ctx): Promise<ContentFlags> {
  const { keys } = await moduleFlags.flags(ctx);
  const flags = {
    feed: keys.has('feed'),
    stories: keys.has('stories'),
    communities: keys.has('communities'),
    events: keys.has('events'),
    store: keys.has('store'),
  };
  if (!flags.feed && !flags.stories) throw new ApiError(404, 'MODULE_DISABLED');
  return flags;
}

/** The newest build as Conteúdo reads it: its meta and its parsed `content` key, or nothing. */
export type ContentFrame = { snapshot: SnapshotMeta; content: ContentPayload };

/**
 * The tenant's newest snapshot read in the admin's lane (its admin-only policy applies), or `null`
 * when there is none yet or its windows / `content` key fail their contracts (an older payload
 * version): the caller answers `preparing`, never zeros (R-Pitfall 3).
 */
export async function readContentFrame(tx: Tx, tenantId: string): Promise<ContentFrame | null> {
  const row = await readLatestSnapshot(tx, tenantId);
  if (!row) return null;
  const snapshot = snapshotMetaOf(row);
  const parsed = contentPayloadSchema.safeParse(
    ((row.payload ?? {}) as Record<string, unknown>).content,
  );
  return snapshot && parsed.success ? { snapshot, content: parsed.data } : null;
}

/** Whether an item's kind is shown with these flags (UI-D-473). */
export function kindShown(kind: ContentKindId, flags: ContentFlags): boolean {
  return kind === 'story' ? flags.stories : flags.feed;
}

type LiveDb = {
  id: string;
  caption: string;
  cover_asset_id: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  images: number;
};

/** What the service joins live for one item (PR-1: never stored in the snapshot). */
export type LiveLabel = {
  excerpt: string;
  coverAssetId: string | null;
  media: { width: number; height: number } | null;
  durationSeconds: number | null;
  images: number;
};

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/**
 * The live labels of the given posts and stories of `tenantId` (explicit predicate beside RLS),
 * read in the admin's lane: the caption's excerpt cut at a word boundary, the cover (a post's first
 * image or video by position, a story's media), its size, a video's length and a gallery's image
 * count. An item deleted since the build has no label, so the caller drops it.
 */
export async function liveLabels(
  tx: Tx,
  tenantId: string,
  items: readonly Pick<ContentPayloadItem, 'id' | 'kind'>[],
): Promise<Map<string, LiveLabel>> {
  const postIds = items.filter((item) => item.kind !== 'story').map((item) => item.id);
  const storyIds = items.filter((item) => item.kind === 'story').map((item) => item.id);
  const rows: LiveDb[] = [];
  if (postIds.length > 0) {
    rows.push(
      ...(await tx.execute<LiveDb>(sql`
        select p.id::text as id, p.caption, cover.media_asset_id::text as cover_asset_id,
               ma.width, ma.height, ma.duration_seconds,
               (select count(*)::int from public.feed_post_media pm
                 where pm.tenant_id = p.tenant_id and pm.post_id = p.id and pm.kind = 'image') as images
          from public.feed_posts p
          left join lateral (
            select pm.media_asset_id from public.feed_post_media pm
             where pm.tenant_id = p.tenant_id and pm.post_id = p.id and pm.kind in ('image', 'video')
             order by pm.kind, pm.position, pm.id
             limit 1
          ) cover on true
          left join public.media_assets ma
            on ma.id = cover.media_asset_id and ma.tenant_id = p.tenant_id
         where p.id = any (${uuidArray(postIds)}::uuid[])
           and p.tenant_id = ${tenantId}::uuid
           and p.deleted_at is null`)),
    );
  }
  if (storyIds.length > 0) {
    rows.push(
      ...(await tx.execute<LiveDb>(sql`
        select s.id::text as id, s.caption, s.media_asset_id::text as cover_asset_id,
               ma.width, ma.height, ma.duration_seconds, 0 as images
          from public.stories s
          left join public.media_assets ma
            on ma.id = s.media_asset_id and ma.tenant_id = s.tenant_id
         where s.id = any (${uuidArray(storyIds)}::uuid[])
           and s.tenant_id = ${tenantId}::uuid
           and s.deleted_at is null`)),
    );
  }
  return new Map(
    rows.map((row) => [
      row.id,
      {
        excerpt: cutOnWord(row.caption ?? '', OWNER_POST_EXCERPT_GRAPHEMES),
        coverAssetId: row.cover_asset_id,
        media:
          row.width !== null && row.height !== null && row.width > 0 && row.height > 0
            ? { width: Number(row.width), height: Number(row.height) }
            : null,
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        images: Number(row.images ?? 0),
      },
    ]),
  );
}

const NOT_MEASURED = {
  postViews: { measured: false, reason: 'needs_post_views' },
  saves: { measured: false, reason: 'needs_saves' },
  shares: { measured: false, reason: 'needs_shares' },
} as const;

/**
 * One publication of the answer: the stored numbers plus the live labels and the not-measured
 * fields (D-455). No association or reach-by-band number is copied here: those belong to the
 * detail, floored (D-462). With `communities` off the community is dropped (UI-D-473).
 */
export function itemAnswer(
  item: ContentPayloadItem,
  label: LiveLabel,
  flags: ContentFlags,
): ContentItemAnswer {
  const base = {
    id: item.id,
    communityId: flags.communities ? item.communityId : null,
    createdAt: item.createdAt,
    excerpt: label.excerpt,
    coverAssetId: item.kind === 'text' || item.kind === 'link' ? null : label.coverAssetId,
    media: item.kind === 'text' || item.kind === 'link' ? null : label.media,
    durationSeconds: item.kind === 'video' ? label.durationSeconds : null,
    cards: item.kind === 'photo' || item.kind === 'carousel' ? label.images : null,
    likes: item.likes,
    comments: item.comments,
    shares: NOT_MEASURED.shares,
  };
  if (item.kind === 'story') {
    const views = { measured: true as const, value: item.views ?? 0 };
    return { ...base, kind: 'story', views, reach: views, saves: null };
  }
  return {
    ...base,
    kind: item.kind,
    commentMeta: item.commentMeta ?? {
      answered: 0,
      unanswered: 0,
      oldestUnansweredHours: null,
      firstReplyMedianMinutes: null,
    },
    views: NOT_MEASURED.postViews,
    reach: NOT_MEASURED.postViews,
    saves: NOT_MEASURED.saves,
  };
}

/**
 * The `byCommunity` rows with each community's name read live (PR-1); the tenant-wide feed keeps a
 * null name, a community deleted since the build is dropped.
 */
async function withCommunityNames(
  tx: Tx,
  tenantId: string,
  rows: ContentPayload['byCommunity'],
): Promise<NonNullable<OwnerContentReady['byCommunity']>> {
  const ids = rows.flatMap((row) => (row.communityId ? [row.communityId] : []));
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const found = await tx.execute<{ id: string; name: string }>(sql`
      select c.id::text as id, c.name from public.communities c
       where c.id = any (${uuidArray(ids)}::uuid[])
         and c.tenant_id = ${tenantId}::uuid
         and c.deleted_at is null`);
    for (const row of found) names.set(row.id, row.name);
  }
  type Row = NonNullable<OwnerContentReady['byCommunity']>[number];
  return rows.flatMap((row): Row[] => {
    if (row.communityId === null) return [{ ...row, name: null }];
    const name = names.get(row.communityId);
    return name === undefined ? [] : [{ ...row, name }];
  });
}

/**
 * `GET /v1/dashboard/owner/content` (08.7-06, D-455, D-458, D-462, UI-D-473, UI-D-484, UI-D-488,
 * INSIGHT-10): the Conteúdo area of the tenant's newest snapshot, read in the admin's own lane.
 *
 * - Flags FIRST (A-WR-03): `feed` and `stories` both off → 404 `MODULE_DISABLED`; with `feed` off
 *   the posts, their kinds and the post part (KPIs, bands, trend, heatmap, communities) are
 *   omitted; with `stories` off the stories are (UI-D-473); with `communities` off `byCommunity`
 *   and each item's community are dropped.
 * - No snapshot, or a `content` key missing or failing its contract → `{ state: 'preparing' }`.
 * - Captions, covers and media sizes are joined live (PR-1); an item deleted since the build is
 *   dropped from the list (its numbers stay in the build's sums until the next build).
 * - Unmeasured metrics are `{ measured: false, reason }` (D-455); no association or reach number
 *   is sent here (the detail floors them, D-462); story views are totals only (PR-5).
 */
export async function getOwnerContent(ctx: Ctx): Promise<OwnerContentAnswer> {
  const flags = await contentFlags(ctx);
  return withTenantTx(ctx, async (tx): Promise<OwnerContentAnswer> => {
    const frame = await readContentFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const { snapshot, content } = frame;

    const shown = content.items.filter((item) => kindShown(item.kind, flags));
    const labels = await liveLabels(tx, ctx.tenantId, shown);
    const items = shown.flatMap((item) => {
      const label = labels.get(item.id);
      return label ? [itemAnswer(item, label, flags)] : [];
    });
    const kinds = CONTENT_KINDS.filter((kind) => kindShown(kind, flags));

    const answer: OwnerContentReady = {
      state: 'ready',
      snapshot,
      kinds,
      items,
      byKind: kinds.map((kind) => {
        const ofKind = items.filter((item) => item.kind === kind);
        return {
          kind,
          items: ofKind.length,
          likes: ofKind.reduce((sum, item) => sum + item.likes, 0),
          comments: ofKind.reduce((sum, item) => sum + item.comments, 0),
        };
      }),
      kindMetrics: {
        ...(flags.feed
          ? {
              video: { measured: false, reason: 'needs_video_playback' },
              photo: { measured: false, reason: 'needs_saves' },
              carousel: { measured: false, reason: 'needs_gallery_swipes' },
              link: { measured: false, reason: 'needs_link_clicks' },
            }
          : {}),
        ...(flags.stories ? { story: { measured: false, reason: 'needs_story_taps' } } : {}),
      },
    };
    if (flags.feed) {
      answer.kpis = {
        ...content.kpis,
        rate: NOT_MEASURED.postViews,
        views: NOT_MEASURED.postViews,
        reach: NOT_MEASURED.postViews,
      };
      answer.interactorsByBand = content.interactorsByBand;
      answer.weeklyPerPost = content.weeklyPerPost;
      answer.heatmap = content.heatmap;
      if (flags.communities) {
        answer.byCommunity = await withCommunityNames(tx, ctx.tenantId, content.byCommunity);
      }
    }
    return answer;
  });
}

/**
 * Planning decision 5: an item id is the raw uuid of a LIVE post of this tenant, else of a live
 * story (uuids do not collide across tables), else nothing (explicit tenant predicate beside RLS).
 */
export async function liveItemKind(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<'post' | 'story' | null> {
  const rows = await tx.execute<{ kind: 'post' | 'story' }>(sql`
    select 'post' as kind from public.feed_posts p
     where p.id = ${itemId}::uuid and p.tenant_id = ${tenantId}::uuid and p.deleted_at is null
    union all
    select 'story' from public.stories s
     where s.id = ${itemId}::uuid and s.tenant_id = ${tenantId}::uuid and s.deleted_at is null`);
  return rows[0]?.kind ?? null;
}

/**
 * The one gate between an item id from the URL and anything read about it (T-08.7-12): a live post
 * or story of this tenant whose module is on, else the bare 404 `NOT_FOUND`. Checked BEFORE the
 * snapshot, so a foreign or unknown id is the same 404 in every state.
 */
export async function contentItemGate(
  tx: Tx,
  tenantId: string,
  itemId: string,
  flags: ContentFlags,
): Promise<'post' | 'story'> {
  const kind = await liveItemKind(tx, tenantId, itemId);
  if (kind === null || (kind === 'post' && !flags.feed) || (kind === 'story' && !flags.stories)) {
    throw new ApiError(404, 'NOT_FOUND');
  }
  return kind;
}

/** The newest build's stored item, or the bare 404 when the build does not hold it (not in its window). */
export function storedItem(content: ContentPayload, itemId: string): ContentPayloadItem {
  const item = content.items.find((row) => row.id === itemId);
  if (!item) throw new ApiError(404, 'NOT_FOUND');
  return item;
}

/**
 * `GET /v1/dashboard/owner/content/items/{itemId}` (08.7-06, D-462, D-464, EP-45..EP-49): one
 * publication with its 48-hour curve and its associations, every number from the newest build
 * (nothing computed on open), floored HERE between the parsed payload and the response:
 *
 * - The item gate first (a foreign, unknown, deleted or module-hidden id is the bare 404), then the
 *   snapshot (none → preparing), then the stored item (outside the build's window → 404).
 * - `reachByBand`: not measured for a post; a story's viewers by band through `floorBands` (merged
 *   so no group under 5 is recoverable, `[]` with no viewer).
 * - `reactivated` through `floorCount`; `rsvps` (events on) per event through `floorCount`, titles
 *   read live (an event deleted since is dropped), shown first by value desc (EP-47); `orders`
 *   (store on) replaced WHOLLY by `{ belowFloor: true }` for 1-4 orders (EP-48); `vitrine` (store
 *   on) through `floorCount`, null outside an exclusive community.
 * - `retention` (videos) and `navigation` (stories) are not measured.
 */
export async function getOwnerContentDetail(
  ctx: Ctx,
  itemId: string,
): Promise<OwnerContentDetailAnswer> {
  const flags = await contentFlags(ctx);
  return withTenantTx(ctx, async (tx): Promise<OwnerContentDetailAnswer> => {
    await contentItemGate(tx, ctx.tenantId, itemId, flags);
    const frame = await readContentFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const stored = storedItem(frame.content, itemId);
    const label = (await liveLabels(tx, ctx.tenantId, [stored])).get(itemId);
    if (!label) throw new ApiError(404, 'NOT_FOUND');
    const zeroBands = {
      new: 0,
      superfan: 0,
      engaged: 0,
      occasional: 0,
      at_risk: 0,
      inactive: 0,
    };

    const answer: OwnerContentDetailReady = {
      state: 'ready',
      snapshot: frame.snapshot,
      item: itemAnswer(stored, label, flags),
      velocity48h: stored.velocity48h,
      reachByBand:
        stored.kind === 'story'
          ? floorBands(stored.reachByBand ?? zeroBands)
          : { measured: false, reason: 'needs_post_views' },
      retention:
        stored.kind === 'video' ? { measured: false, reason: 'needs_video_playback' } : null,
      navigation: stored.kind === 'story' ? { measured: false, reason: 'needs_story_taps' } : null,
      reactivated: floorCount(stored.reactivated),
    };
    if (flags.events) answer.rsvps = await withEventTitles(tx, ctx.tenantId, stored.rsvps);
    if (flags.store) {
      const { count, cents } = stored.orders;
      answer.orders =
        floorCount(count).belowFloor === true
          ? { belowFloor: true }
          : { belowFloor: false, count, cents };
      answer.vitrine = stored.vitrine === null ? null : floorCount(stored.vitrine);
    }
    return answer;
  });
}

/** The associated RSVPs with each event's title read live, floored, shown first (EP-47). */
async function withEventTitles(
  tx: Tx,
  tenantId: string,
  rsvps: ContentPayloadItem['rsvps'],
): Promise<NonNullable<OwnerContentDetailReady['rsvps']>> {
  if (rsvps.length === 0) return [];
  const rows = await tx.execute<{ id: string; title: string }>(sql`
    select e.id::text as id, e.title from public.events e
     where e.id = any (${uuidArray(rsvps.map((row) => row.eventId))}::uuid[])
       and e.tenant_id = ${tenantId}::uuid
       and e.deleted_at is null`);
  const titles = new Map(rows.map((row) => [row.id, row.title]));
  const shown = rsvps.flatMap((row) => {
    const title = titles.get(row.eventId);
    return title === undefined
      ? []
      : [{ eventId: row.eventId, title, members: floorCount(row.members) }];
  });
  return sortFloored(shown, (row) => row.members);
}
