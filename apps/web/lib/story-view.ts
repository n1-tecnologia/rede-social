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
  /** 05.2 (HIGHLIGHT-06): the caller's own server-side seen flag (`viewerSeen`). */
  seen: boolean;
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
    // TDD RED STUB (05.2-10 Task 2): inert until GREEN maps `story.viewerSeen`.
    seen: false,
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
 * plural-aware highlight indicator (UI-D-77) — are interpolated HERE with the page's own translator, which is also
 * what keeps the pt-BR plural rules on the server where `next-intl` can apply them.
 */
export type StoryHistoryItemView = {
  id: string;
  /** The bare short date ("12 mar") — the "Adicionar stories" picker's row line (05.2-09, UI-D-76). */
  date: string;
  thumbnailAssetId: string;
  thumbnailVariantWidths: readonly number[];
  thumbnailAlt: string;
  caption: string;
  captionMuted: boolean;
  meta: string;
  note?: string;
  status?: { tone: 'warning' | 'danger'; label: string };
  /**
   * UI-D-77: "Em # destaque(s)", present ONLY when the story is in at least one highlight. The
   * client replaces it from each confirmed toggle's `highlightCount` (and drops it at 0).
   */
  highlighted?: { count: number; label: string };
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
    date,
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
    // UI-D-77 / UI E12 zero-one-many: in NO highlight renders no indicator at all, so the key is
    // absent rather than carrying a zero. `StoryHistoryRow` checks the count too — belt and braces.
    // `pinnedCommunityCount` is no longer read: the pin model is retired on the web (UI-D-79).
    ...(story.highlightCount > 0
      ? {
          highlighted: {
            count: story.highlightCount,
            label: ts('history.highlighted', { count: story.highlightCount }),
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
/** The tenant circle's seen state (D-105): is anything live unseen, and where does it resume. */
export type TenantSeenState = { anyUnseen: boolean; resumeIndex: number };

/** TDD RED STUB (05.2-10 Task 2): inert — "everything new, resume at 0" until GREEN. */
export function tenantSeenState(
  _items: readonly { id: string; seen: boolean }[],
  _session?: ReadonlySet<string>,
): TenantSeenState {
  return { anyUnseen: true, resumeIndex: 0 };
}

export function tenantCircleView(
  tenant: { displayName: string; logoUrl: string | null },
  t: RowLabelReader,
  _seen?: TenantSeenState,
): Extract<RowCircleView, { kind: 'open' }> {
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
): Extract<RowCircleView, { kind: 'open' }> {
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
 * A row circle as the WEB composes it: the module's `StoryStripCircle` with one serialisable disc
 * more — `{ kind: 'manage' }` (05.2-09). The module's `glyph` disc carries a React node (the Pencil
 * icon), which cannot cross from a server component into `StoriesSurface`; the server says WHICH
 * glyph with plain data and the client shell draws it (`StoriesSurface` maps it to the Pencil).
 */
export type RowCircleDisc =
  | Exclude<StoryStripCircle['disc'], { kind: 'glyph' }>
  | { kind: 'manage' };
type WithRowDisc<C> = C extends unknown ? Omit<C, 'disc'> & { disc: RowCircleDisc } : never;
export type RowCircleView = WithRowDisc<StoryStripCircle>;

/**
 * UI-D-63 (a) — the admin-only trailing MANAGE circle (D-109): a `link` to the place's manage screen,
 * in the dashed "only you see this" ring, with the manage glyph. It is an ANCHOR, never a button:
 * the manage screen is a full route (the UI-D-28 rule).
 */
export function manageCircleView(
  href: string,
  actionLabel: string,
  t: RowLabelReader,
): RowCircleView {
  return {
    kind: 'link',
    key: 'manage',
    href,
    label: t('highlights.circle.label'),
    actionLabel,
    ring: 'dashed',
    disc: { kind: 'manage' },
  };
}

/**
 * UI-D-63 (b) — an EMPTY highlight in a curator's row (D-102): its cover or monogram inside the
 * dashed ring, as a LINK to the manage screen with `?editar={id}`, which opens its edit sheet on
 * arrival. It never opens the viewer, and it is never one of the viewer's groups, so "skip empty
 * groups" is structural (R-D-M).
 */
export function emptyHighlightCircleView(
  summary: HighlightSummary,
  manageHref: string,
  t: RowLabelReader,
): RowCircleView {
  return {
    kind: 'link',
    key: summary.id,
    href: `${manageHref}?editar=${summary.id}`,
    label: summary.title,
    actionLabel: t('circle.highlightEmpty', { title: summary.title }),
    ring: 'dashed',
    disc:
      summary.coverAssetId !== null
        ? {
            kind: 'asset',
            assetId: summary.coverAssetId,
            variantWidths: summary.coverVariantWidths,
          }
        : { kind: 'monogram', text: monogramOf(summary.title) },
  };
}

/**
 * A curator's two row artefacts (D-108, D-109): where the manage screen is, and the manage circle's
 * accessible name ("Gerenciar destaques do início" / "… de {community}"). Absent for a member.
 */
export type CuratorRow = { manageHref: string; manageActionLabel: string };

/**
 * One place's highlight circles in the API's `position, id` order, followed — for a CURATOR — by the
 * manage circle. A highlight with a member-visible story OPENS its viewer group (numbered from
 * `firstGroup`, in the same order `highlightGroupView` builds the groups); an EMPTY one is the
 * curator's dashed link (UI-D-63b), and it takes NO group number, because the viewer never plays it.
 * Without `curator`, an empty highlight is dropped (a member's read never carries one anyway).
 */
export function highlightRowCircles(
  highlights: readonly HighlightSummary[],
  firstGroup: number,
  t: RowLabelReader,
  curator?: CuratorRow,
): RowCircleView[] {
  const circles: RowCircleView[] = [];
  let group = firstGroup;
  for (const summary of highlights) {
    if (summary.itemCount > 0) {
      circles.push(highlightCircleView(summary, t, group));
      group += 1;
    } else if (curator) {
      circles.push(emptyHighlightCircleView(summary, curator.manageHref, t));
    }
  }
  if (curator) circles.push(manageCircleView(curator.manageHref, curator.manageActionLabel, t));
  return circles;
}

/** The highlights the viewer can PLAY — the ones with a member-visible story — in row order. */
export function openableHighlights(highlights: readonly HighlightSummary[]): HighlightSummary[] {
  return highlights.filter((summary) => summary.itemCount > 0);
}

/**
 * UI-D-59's order and render rule for Início, as one pure function:
 *
 * 1. the admin's `+ Seu story` link — ONLY with `stories.story.publish` (the caller passes the
 *    permission check's result, never a role, UI-D-28);
 * 2. the tenant circle — iff the tenant sequence is non-empty (a circle means something to watch);
 * 3. Início's highlights, one circle each, in the order the API returned (`position, id`), each
 *    opening its own viewer group (05.2-05) — and, for a CURATOR (05.2-09), the empty ones as dashed
 *    links to the manage screen;
 * 4. for a curator, the trailing manage circle (D-109).
 *
 * A member with nothing gets `[]`, and `StoriesStrip` then renders NO node (UI-D-26). The parts are
 * independent (UI E01 partial): highlights render without the tenant circle and vice versa, and an
 * admin with nothing still gets the `+` and the manage circle (D-108).
 */
export function inicioRow(
  input: {
    canPublish: boolean;
    own: { avatarUrl: string | null };
    tenant: { displayName: string; logoUrl: string | null };
    sequenceLength: number;
    highlights: readonly HighlightSummary[];
    curator?: CuratorRow;
    /** TDD RED STUB (05.2-10 Task 2): accepted and ignored until GREEN. */
    tenantSeen?: TenantSeenState;
  },
  t: RowLabelReader,
): RowCircleView[] {
  const row: RowCircleView[] = [];
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
  // is group 0 when it exists, and each playable highlight takes the next index.
  const first = input.sequenceLength > 0 ? 1 : 0;
  if (input.sequenceLength > 0) row.push(tenantCircleView(input.tenant, t));
  row.push(...highlightRowCircles(input.highlights, first, t, input.curator));
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

/* ── 05.2-09: the manage screen's views (UI-D-72, UI-D-74) ──────────────────────────────────── */

/**
 * One card of the manage list (UI-D-72), composed on the SERVER like every row here: plain data, so
 * it crosses into `HighlightManager` untouched. `meta` is interpolated HERE under pt-BR's plural
 * rules ("1 story" / "3 stories"), and an EMPTY highlight says so plainly ("Vazio · só você vê") —
 * `itemCount` counts member-visible items, so "empty" means exactly what members do not see.
 *
 * `coverChosen` rides along so the edit sheet can offer "Usar capa automática" before its own read
 * lands, and `communityId` is the place a curation write revalidates.
 */
export type HighlightManageRowView = {
  id: string;
  communityId: string | null;
  title: string;
  meta: string;
  cover: { assetId: string; variantWidths: number[] } | null;
  coverChosen: boolean;
  itemCount: number;
  editLabel: string;
};

export function highlightManageRowView(
  summary: HighlightSummary,
  t: RowLabelReader,
): HighlightManageRowView {
  return {
    id: summary.id,
    communityId: summary.communityId,
    title: summary.title,
    meta:
      summary.itemCount > 0
        ? t('highlights.manage.count', { count: summary.itemCount })
        : t('highlights.manage.emptyItem'),
    // By asset id, never a URL built from tenant content (T-05.2-21).
    cover:
      summary.coverAssetId !== null
        ? { assetId: summary.coverAssetId, variantWidths: [...summary.coverVariantWidths] }
        : null,
    coverChosen: summary.coverChosen,
    itemCount: summary.itemCount,
    editLabel: t('highlights.manage.edit', { title: summary.title }),
  };
}

/**
 * One story row of the edit sheet (UI-D-74). The date is the history's own short format, so a story
 * reads the same in "Seus stories", the edit sheet and the picker. The media pill is Phase 3's
 * vocabulary VERBATIM (R-D-H: a curator sees every live item, ready or not).
 *
 * **`isCover` compares the RESOLVED cover asset, not `coverStoryId`.** The server resolves a chosen
 * frame and the automatic rule (the most recently added image item) to the story's OWN media asset
 * (R-D-D), so one comparison marks the right row in both cases — and an uploaded cover, whose asset
 * belongs to no story, marks none. Reading `coverStoryId` would miss the automatic case and keep
 * marking a chosen story that is no longer a valid cover.
 */
export type HighlightEditStoryView = {
  id: string;
  thumb: { assetId: string; variantWidths: number[] };
  mediaKind: 'image' | 'video';
  dateLabel: string;
  status?: { tone: 'warning' | 'danger'; label: string };
  isCover: boolean;
  removeLabel: string;
};

export function highlightEditStoryView(
  story: StorySummary,
  coverAssetId: string | null,
  t: RowLabelReader,
  tm: RowLabelReader,
): HighlightEditStoryView {
  const dateLabel = HISTORY_DATE.format(new Date(story.publishedAt));
  const status =
    story.mediaStatus === 'processing'
      ? ({ tone: 'warning', label: tm('status.processing') } as const)
      : story.mediaStatus === 'rejected' || story.mediaStatus === 'failed'
        ? ({ tone: 'danger', label: tm('status.rejected') } as const)
        : undefined;

  return {
    id: story.id,
    thumb: { assetId: story.mediaAssetId, variantWidths: [...story.mediaVariantWidths] },
    mediaKind: story.mediaKind,
    dateLabel,
    ...(status ? { status } : {}),
    isCover:
      story.mediaKind === 'image' && coverAssetId !== null && story.mediaAssetId === coverAssetId,
    removeLabel: t('highlights.edit.remove', { date: dateLabel }),
  };
}
