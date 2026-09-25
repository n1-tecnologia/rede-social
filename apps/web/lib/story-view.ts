import { avatarUrlFor } from '@tria/contracts/profiles';
import type { CommentView } from '@tria/module-feed/ui';
import {
  type HighlightSummary,
  STORY_MAX_PAGE_SIZE,
  type StoryComment,
  type StorySummary,
} from '@tria/module-stories/contracts';
import type { StoryStripCircle } from '@tria/module-stories/ui';
import { relativeFrom } from '@/lib/relative-time';

/**
 * The `<time>` element's machine-readable title — the same format `feed-view.tsx` uses for a
 * comment, restated here rather than imported, because importing it would drag the feed view-model
 * (and, through it, the media player and the env validation) into every story surface. That import
 * chain is exactly what deviation 1 of 05-06 had to unpick.
 */
const absoluteStoryTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * The viewer's view-model (05-06), composed on the SERVER — the `feed-view.ts` rule restated for
 * stories.
 *
 * **Nothing here is a function.** Every value that crosses into `StoryViewerHost` is a plain string
 * or number, because the boundary only carries serialisable props (a server action is the one
 * exception, and the two like actions are exactly that). The strings that need a NUMBER in them —
 * the position announcement and the two plural counts — cross as TEMPLATES and are interpolated in
 * the client shell, which is the only place that knows the index.
 *
 * **Every relative time is formatted here, from the page's single `now`** (UI-D-14). The viewer has
 * no clock in its render tree, so there is no hydration mismatch and no per-second re-render.
 */

/** One story, exactly as the viewer needs it — ids and already-formatted strings, never a URL. */
export type StoryViewerItemView = {
  id: string;
  mediaKind: 'image' | 'video';
  /** The asset ID; `MediaImage` and the playback broker derive their own paths from it (T-05-39). */
  mediaAssetId: string;
  mediaVariantWidths: readonly number[];
  caption: string;
  timeLabel: string;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
};

/**
 * Every string the viewer and its overlay use. The three that carry a number are ICU-ish templates
 * (`{current}`, `{total}`, `{count}`) resolved client-side — see the note above.
 */
export type StoryViewerLabelsView = {
  dialog: string;
  close: string;
  mute: string;
  unmute: string;
  previous: string;
  next: string;
  play: string;
  mediaError: string;
  retry: string;
  like: string;
  unlike: string;
  comment: string;
  /** `{group}: story {current} de {total}` — the ONE live-region template (UI-D-65). */
  positionGroup: string;
  /** Screen-reader line while a highlight group's items load (UI-D-65 loading). */
  loadingGroup: string;
  /** A highlight group that could not be read (UI-D-65 error), above the shared retry. */
  groupError: string;
  likesOne: string;
  likesOther: string;
  commentsOne: string;
  commentsOther: string;
  genericError: string;
};

export function storyViewerItem(story: StorySummary, now: number): StoryViewerItemView {
  return {
    id: story.id,
    mediaKind: story.mediaKind,
    mediaAssetId: story.mediaAssetId,
    mediaVariantWidths: story.mediaVariantWidths,
    caption: story.caption,
    timeLabel: relativeFrom(story.publishedAt, now),
    likeCount: story.likeCount,
    commentCount: story.commentCount,
    viewerLiked: story.viewerLiked,
  };
}

/**
 * The whole label block, read once from the `stories.viewer` catalog namespace (plus the one
 * highlight sentence the grouped viewer shows when a group cannot load).
 *
 * **The five templated strings are read with `.raw`, and that is not optional.** `next-intl`
 * FORMATS on read: asking for `viewer.positionGroup` through `t()` without a `{group}` raises
 * `FORMATTING_ERROR` and takes the whole home slot down with it. `.raw` returns the pattern
 * untouched, which is exactly what has to cross to the client — the same reason the feed's plural
 * pairs are read that way.
 */
type StoryLabelReader = ((key: string) => string) & { raw: (key: string) => unknown };

export function storyViewerLabels(tf: StoryLabelReader): StoryViewerLabelsView {
  return {
    dialog: tf('viewer.dialog'),
    close: tf('viewer.close'),
    mute: tf('viewer.mute'),
    unmute: tf('viewer.unmute'),
    previous: tf('viewer.previous'),
    next: tf('viewer.next'),
    play: tf('viewer.play'),
    mediaError: tf('viewer.errors.media'),
    retry: tf('viewer.errors.retry'),
    like: tf('viewer.like'),
    unlike: tf('viewer.unlike'),
    comment: tf('viewer.comment'),
    positionGroup: String(tf.raw('viewer.positionGroup')),
    loadingGroup: tf('viewer.loadingGroup'),
    groupError: tf('highlights.errors.load'),
    likesOne: String(tf.raw('viewer.likes.one')),
    likesOther: String(tf.raw('viewer.likes.other')),
    commentsOne: String(tf.raw('viewer.comments.one')),
    commentsOther: String(tf.raw('viewer.comments.other')),
    genericError: tf('viewer.errors.generic'),
  };
}

/**
 * One story COMMENT, mapped into the SHIPPED `CommentView` the flat list renders (D-82).
 *
 * It maps into the feed's row type rather than a story-shaped one, because there is exactly one
 * comment row component in the product and it is the feed's. The four fields a story comment has no
 * concept of — `likeCount`, `viewerLiked`, `replyCount`, `isReply` — are pinned to their neutral
 * values HERE, in one place, rather than left to whatever a future caller happens to pass: with
 * `likeCount: 0` the row's count segment is dropped entirely (UI-D-21) and with `replyCount: 0` the
 * toggle is not drawn even in a variant that would draw one. The flat variant suppresses all three
 * controls anyway; this is the belt to that's braces.
 *
 * `now` is the page's SINGLE clock read (UI-D-14) and `nowLabel` is what a comment written seconds
 * ago reads instead of "há 0 s" — the feed's `commentView` rule, restated across the module edge
 * that stops the two importing each other.
 */
export function storyCommentView(
  comment: StoryComment,
  now: number,
  nowLabel: string,
): CommentView {
  const elapsed = now - new Date(comment.createdAt).getTime();

  return {
    id: comment.id,
    body: comment.body,
    author: {
      displayName: comment.author.displayName,
      // UI-D-24: a removed author has no membership to link to, and nothing here invents one.
      profileHref:
        comment.authorRemoved || comment.author.membershipId === null
          ? null
          : `/membros/${comment.author.membershipId}`,
      avatarUrl: avatarUrlFor(comment.author.avatarAssetId),
    },
    authorRemoved: comment.authorRemoved,
    createdAtIso: comment.createdAt,
    createdAtRelative: elapsed < 60_000 ? nowLabel : relativeFrom(comment.createdAt, now),
    createdAtAbsolute: absoluteStoryTime.format(new Date(comment.createdAt)),
    likeCount: 0,
    viewerLiked: false,
    replyCount: 0,
    isReply: false,
    canDelete: comment.canDelete,
  };
}

/* ── "Seus stories" (D-84, UI-D-40) ───────────────────────────────────────────────────────────── */

/**
 * One row of the admin history, composed on the SERVER — the `feed-view.ts` rule restated.
 *
 * **Nothing here is a function and nothing is a template.** Every value that crosses into
 * `StoryHistoryList` is a plain string, number or boolean, because the boundary only carries
 * serialisable props. The two strings that need NUMBERS in them — the meta line and the
 * plural-aware pin indicator — are interpolated HERE with the page's own translator, which is also
 * what keeps the pt-BR plural rules on the server where `next-intl` can apply them.
 */
export type StoryHistoryItemView = {
  id: string;
  thumbnailAssetId: string;
  thumbnailVariantWidths: readonly number[];
  thumbnailAlt: string;
  caption: string;
  captionMuted: boolean;
  meta: string;
  note?: string;
  status?: { tone: 'warning' | 'danger'; label: string };
  pinned?: { count: number; label: string };
  actionLabel: string;
  /** `/stories/{id}` — "Ver story" opens the viewer as a SINGLE-item sequence (05-06's route). */
  viewHref: string;
};

/** The history's date segment: "12 mar", the sketch's own format. */
const HISTORY_DATE = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

/**
 * The reader this view-model needs: a namespaced translator that can interpolate. Unlike
 * `storyViewerLabels` NOTHING here crosses as a template, so `.raw` is not needed — every
 * placeholder is filled before the value leaves the server.
 */
type HistoryLabelReader = (key: string, values?: Record<string, string | number>) => string;

export function storyHistoryView(
  story: StorySummary,
  ts: HistoryLabelReader,
  tm: HistoryLabelReader,
): StoryHistoryItemView {
  const date = HISTORY_DATE.format(new Date(story.publishedAt));
  const caption = story.caption.trim();

  // Phase 3's media vocabulary, VERBATIM (UI-SPEC §Components): the history does not invent a
  // second word for a state the media screens already name.
  const status =
    story.mediaStatus === 'processing'
      ? ({ tone: 'warning', label: tm('status.processing') } as const)
      : story.mediaStatus === 'rejected' || story.mediaStatus === 'failed'
        ? ({ tone: 'danger', label: tm('status.rejected') } as const)
        : undefined;

  // Pitfall 5: the ~60 s refusal arrives AFTER ingest, so the history is where an admin finds out
  // why a story they published never appeared. `processing` gets the reassurance instead.
  const note =
    story.mediaStatus === 'processing'
      ? ts('history.processingNote')
      : story.mediaFailureReason === 'duration_too_long'
        ? tm('errors.transcode')
        : undefined;

  return {
    id: story.id,
    thumbnailAssetId: story.mediaAssetId,
    thumbnailVariantWidths: story.mediaVariantWidths,
    thumbnailAlt: ts('history.row', { date }),
    caption: caption.length > 0 ? caption : ts('history.noCaption'),
    captionMuted: caption.length === 0,
    meta: ts('history.meta', {
      date,
      likes: story.likeCount,
      comments: story.commentCount,
    }),
    ...(note ? { note } : {}),
    ...(status ? { status } : {}),
    // UI zero-one-many/E08: pinned NOWHERE renders no indicator at all, so the key is absent
    // rather than carrying a zero. `StoryHistoryRow` checks the count too — belt and braces.
    ...(story.pinnedCommunityCount > 0
      ? {
          pinned: {
            count: story.pinnedCommunityCount,
            label: ts('history.pinned', { count: story.pinnedCommunityCount }),
          },
        }
      : {}),
    actionLabel: ts('history.row', { date }),
    viewHref: `/stories/${story.id}`,
  };
}

/* ── The Início row (05.2-04: HIGHLIGHT-03, D-104, D-106, UI-D-59..UI-D-62) ──────────────────── */

/**
 * The Início row's circles, composed on the SERVER — the `feed-view.ts` rule restated: every value
 * is a string, a number or an id (no function, no URL built from a title), so the descriptors cross
 * into `StoriesSurface` untouched and the module's `StoriesStrip` renders them in the given order.
 */
type RowLabelReader = (key: string, values?: Record<string, string | number>) => string;

/**
 * The first user-perceived character of `text`, trimmed and upper-cased (UI-D-60, UI-D-62) — never a
 * string slice, which would split a surrogate pair or a joined emoji. `Intl.Segmenter` is the
 * grapheme authority; `Array.from` (code points) is the fallback. An empty text is `''`: the
 * gradient disc with no letter.
 */
export function monogramOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const first =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })
          .segment(trimmed)
          [Symbol.iterator]()
          .next().value?.segment
      : Array.from(trimmed)[0];
  return (first ?? '').toLocaleUpperCase('pt-BR');
}

/**
 * D-106: the tenant circle plays OLDEST → NEWEST over the newest `STORY_MAX_PAGE_SIZE` live stories.
 *
 * `GET /v1/stories` keeps its `expires_at desc, id desc` statement and its index-only plan; the web
 * asks for ONE bounded page and reverses it here, rather than asking the API for an ascending read
 * that would walk the oldest stories first and page toward the news (R-D-6's anti-pattern). The cap
 * is applied to the API order FIRST, so a page longer than the cap still plays the NEWEST 25. A
 * missing page (a failed read) is an empty sequence. The input is never mutated.
 */
export function tenantSequence<T>(page: { items: readonly T[] } | null): T[] {
  if (page === null) return [];
  return page.items.slice(0, STORY_MAX_PAGE_SIZE).reverse();
}

/**
 * The tenant circle (D-104): the tenant's logo and display name — the same identity the viewer
 * header shows, so the circle and the screen it opens agree. No logo → the display name's monogram
 * (UI-D-60). It opens group 0 at index 0; plan 10 adds the resume index and the seen ring.
 */
export function tenantCircleView(
  tenant: { displayName: string; logoUrl: string | null },
  t: RowLabelReader,
): Extract<StoryStripCircle, { kind: 'open' }> {
  return {
    kind: 'open',
    key: 'tenant',
    label: tenant.displayName,
    actionLabel: t('circle.tenant', { tenant: tenant.displayName }),
    ring: 'brand',
    disc:
      tenant.logoUrl !== null
        ? { kind: 'logo', src: tenant.logoUrl }
        : { kind: 'monogram', text: monogramOf(tenant.displayName) },
    group: 0,
    index: 0,
  };
}

/**
 * One highlight circle (UI-D-62): the server-resolved cover, or the title's monogram when nothing
 * resolves (video-only, cover deleted); the title as label; always the neutral archive ring
 * (UI-D-61). The cover goes through `MediaImage` BY ASSET ID — no URL is ever built from tenant
 * content (T-05.2-21).
 *
 * It OPENS its own viewer group at its first story (05.2-05, D-107): `group` is the circle's place
 * among the row's openable circles, the same index `inicioGroups` gives the group it opens.
 */
export function highlightCircleView(
  summary: HighlightSummary,
  t: RowLabelReader,
  group: number,
): Extract<StoryStripCircle, { kind: 'open' }> {
  return {
    kind: 'open',
    key: summary.id,
    label: summary.title,
    actionLabel: t('circle.highlight', { title: summary.title }),
    ring: 'neutral',
    disc:
      summary.coverAssetId !== null
        ? {
            kind: 'asset',
            assetId: summary.coverAssetId,
            variantWidths: summary.coverVariantWidths,
          }
        : { kind: 'monogram', text: monogramOf(summary.title) },
    group,
    index: 0,
  };
}

/**
 * UI-D-59's order and render rule for Início, as one pure function:
 *
 * 1. the admin's `+ Seu story` link — ONLY with `stories.story.publish` (the caller passes the
 *    permission check's result, never a role, UI-D-28);
 * 2. the tenant circle — iff the tenant sequence is non-empty (a circle means something to watch);
 * 3. Início's highlights, one circle each, in the order the API returned (`position, id`), each
 *    opening its own viewer group (05.2-05).
 *
 * A member with nothing gets `[]`, and `StoriesStrip` then renders NO node (UI-D-26). The three
 * parts are independent (UI E01 partial): highlights render without the tenant circle and vice
 * versa, and an admin with nothing still gets the `+` alone (D-108).
 */
export function inicioRow(
  input: {
    canPublish: boolean;
    own: { avatarUrl: string | null };
    tenant: { displayName: string; logoUrl: string | null };
    sequenceLength: number;
    highlights: readonly HighlightSummary[];
  },
  t: RowLabelReader,
): StoryStripCircle[] {
  const row: StoryStripCircle[] = [];
  if (input.canPublish) {
    row.push({
      kind: 'link',
      key: 'own',
      href: '/stories/publicar',
      label: t('own.label'),
      actionLabel: t('own.action'),
      ring: 'neutral',
      disc: { kind: 'own', avatarUrl: input.own.avatarUrl },
    });
  }
  // The openable circles ARE the viewer's groups, in the same order (`inicioGroups`): the tenant's
  // is group 0 when it exists, and each highlight takes the next index.
  const first = input.sequenceLength > 0 ? 1 : 0;
  if (input.sequenceLength > 0) row.push(tenantCircleView(input.tenant, t));
  input.highlights.forEach((summary, k) => {
    row.push(highlightCircleView(summary, t, first + k));
  });
  return row;
}

/* ── The viewer's groups (05.2-05: D-107, UI-D-65, R-P6) ──────────────────────────────────────── */

/**
 * One group of the grouped viewer, composed on the SERVER — plain data, like everything above.
 *
 * - `kind` says where it came from: the Início tenant circle, an Início highlight, the community
 *   page's pinned row (until plan 08 replaces it with highlights) or a deep link's single story.
 * - `highlightId` is what the lazy read asks for; null for every kind but `highlight`.
 * - `name` and `avatar` head the viewer for the whole group (UI-D-65): the tenant's display name and
 *   logo, or the highlight's title and cover — the same identity the circle showed.
 * - `items` null means NOT LOADED: a highlight's stories are fetched when the member enters its
 *   group (or prefetched just before), never carried by `/inicio`'s SSR, which would be N×M.
 */
export type StoryGroupView = {
  key: string;
  kind: 'tenant' | 'highlight' | 'pins' | 'story';
  highlightId: string | null;
  name: string;
  avatar:
    | { kind: 'logo'; src: string }
    | { kind: 'avatar'; src: string | null }
    | { kind: 'monogram'; text: string }
    | { kind: 'asset'; assetId: string; variantWidths: readonly number[] };
  items: StoryViewerItemView[] | null;
};

/**
 * A group whose stories are the TENANT's — Início's tenant circle, the community pinned row and a
 * deep link alike. V1's single publisher is the tenant, so the header is its display name over its
 * logo in the shipped `Avatar` (unchanged from 05-06; see the host's note).
 */
function tenantHeadedGroup(
  key: string,
  kind: 'tenant' | 'pins' | 'story',
  tenant: { displayName: string; logoUrl: string | null },
  items: StoryViewerItemView[],
): StoryGroupView {
  return {
    key,
    kind,
    highlightId: null,
    name: tenant.displayName,
    avatar: { kind: 'avatar', src: tenant.logoUrl },
    items,
  };
}

/** Início's tenant circle as a group: group 0, carrying the D-106 sequence it plays. */
export function tenantGroupView(
  tenant: { displayName: string; logoUrl: string | null },
  items: StoryViewerItemView[],
): StoryGroupView {
  return tenantHeadedGroup('tenant', 'tenant', tenant, items);
}

/** The community page's pinned row as ONE group (unchanged behaviour until plan 08). */
export function pinsGroupView(
  tenant: { displayName: string; logoUrl: string | null },
  items: StoryViewerItemView[],
): StoryGroupView {
  return tenantHeadedGroup('pins', 'pins', tenant, items);
}

/** A deep link's single story as ONE group: it opens what the link names and closes at its end. */
export function storyGroupView(
  tenant: { displayName: string; logoUrl: string | null },
  item: StoryViewerItemView,
): StoryGroupView {
  return tenantHeadedGroup('story', 'story', tenant, [item]);
}

/**
 * A highlight as a group: its title and resolved cover (or the title's monogram) head it, exactly
 * as its circle draws them (UI-D-62), and its items are NOT loaded — `null` until the member enters
 * it. The key is the highlight id, so two highlights can never share a group key (Pitfall 4).
 */
export function highlightGroupView(summary: HighlightSummary): StoryGroupView {
  return {
    key: summary.id,
    kind: 'highlight',
    highlightId: summary.id,
    name: summary.title,
    avatar:
      summary.coverAssetId !== null
        ? {
            kind: 'asset',
            assetId: summary.coverAssetId,
            variantWidths: summary.coverVariantWidths,
          }
        : { kind: 'monogram', text: monogramOf(summary.title) },
    items: null,
  };
}

/**
 * Início's viewer groups, in the order `inicioRow` numbers its openable circles: the tenant group
 * iff the sequence is non-empty (a group means something to watch), then the highlight groups
 * (`highlightGroupView`, items not loaded) in the API's order. Circle `(g, 0)` opens `groups[g]` —
 * the two builders are the two halves of one composition and `story-view.test.ts` case 20 holds
 * them together.
 */
export function inicioGroups(input: {
  tenant: { displayName: string; logoUrl: string | null };
  sequence: StoryViewerItemView[];
  highlightGroups: readonly StoryGroupView[];
}): StoryGroupView[] {
  const groups: StoryGroupView[] = [];
  if (input.sequence.length > 0) groups.push(tenantGroupView(input.tenant, input.sequence));
  groups.push(...input.highlightGroups);
  return groups;
}

/* ── The highlight sheet's places (05.2-06) ───────────────────────────────────────────────────── */

/** One place's group in the highlight sheet — the module's `HighlightSheetPlace`, as plain data. */
export type HighlightPlaceView = {
  key: string;
  label: string;
  communityId: string | null;
  rows: { id: string; title: string; cover: { assetId: string; variantWidths: number[] } | null }[];
};

/**
 * The catalogue as the sheet draws it (D-110, UI-D-67): **grouped by PLACE**, Início first under the
 * caller's label, then one group per community in the order of `communities` — the ACTIVE list the
 * member sees everywhere else — labelled with the community's name. Rows keep the catalogue's own
 * order inside a place (`position, id`), and EMPTY highlights stay (a curator is filling them, UI E09
 * partial).
 *
 * What it drops, deliberately:
 * - a highlight whose community is not in `communities` — archived, removed, or the communities
 *   module off (R-D-F, HIGHLIGHT-04): the curator cannot add to it, so a switch would only fail;
 * - a place with no highlight — no empty group (UI E09) — unless `includeEmptyPlaces` asks for every
 *   place, which is the composer's single-select sheet (plan 08): there each place ends with its own
 *   "Novo destaque", so an empty community is still somewhere to publish.
 *
 * Plain data out, like every builder here: the result crosses into a client component. The cover is
 * the server-resolved one (R-D-D), by asset id — no URL is built from tenant content (T-05.2-21).
 */
export function highlightPlacesView(
  catalog: readonly HighlightSummary[],
  communities: readonly { id: string; name: string }[],
  labels: { homeLabel: string; includeEmptyPlaces?: boolean },
): HighlightPlaceView[] {
  const rowOf = (summary: HighlightSummary): HighlightPlaceView['rows'][number] => ({
    id: summary.id,
    title: summary.title,
    cover:
      summary.coverAssetId !== null
        ? { assetId: summary.coverAssetId, variantWidths: [...summary.coverVariantWidths] }
        : null,
  });

  const byCommunity = new Map<string, HighlightPlaceView['rows']>();
  const home: HighlightPlaceView['rows'] = [];
  for (const summary of catalog) {
    if (summary.communityId === null) {
      home.push(rowOf(summary));
      continue;
    }
    const rows = byCommunity.get(summary.communityId) ?? [];
    rows.push(rowOf(summary));
    byCommunity.set(summary.communityId, rows);
  }

  const keep = (rows: HighlightPlaceView['rows']) => labels.includeEmptyPlaces || rows.length > 0;
  const places: HighlightPlaceView[] = [];
  if (keep(home)) {
    places.push({ key: 'home', label: labels.homeLabel, communityId: null, rows: home });
  }
  // Iterating the ACTIVE list is what drops an orphan: a community absent from it is never visited.
  for (const community of communities) {
    const rows = byCommunity.get(community.id) ?? [];
    if (!keep(rows)) continue;
    places.push({ key: community.id, label: community.name, communityId: community.id, rows });
  }
  return places;
}
