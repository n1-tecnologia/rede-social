import { avatarUrlFor } from '@tria/contracts/profiles';
import type { CommentView } from '@tria/module-feed/ui';
import type { StoryComment, StorySummary } from '@tria/module-stories/contracts';
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
  /** `Story {current} de {total}` */
  position: string;
  likesOne: string;
  likesOther: string;
  commentsOne: string;
  commentsOther: string;
  genericError: string;
};

/** Who the sequence is FROM. V1 has a single publisher, so it is the tenant (see the host's note). */
export type StoryViewerAuthorView = { name: string; avatarUrl: string | null };

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
 * The whole label block, read once from the `stories.viewer` catalog namespace.
 *
 * **The five templated strings are read with `.raw`, and that is not optional.** `next-intl`
 * FORMATS on read: asking for `viewer.position` through `t()` without a `{current}` raises
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
    position: String(tf.raw('viewer.position')),
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
