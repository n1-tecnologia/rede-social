import type { StorySummary } from '@tria/module-stories/contracts';
import { relativeFrom } from '@/lib/relative-time';

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

/** The whole label block, read once from the `stories.viewer` catalog namespace. */
export function storyViewerLabels(tf: (key: string) => string): StoryViewerLabelsView {
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
    position: tf('viewer.position'),
    likesOne: tf('viewer.likes.one'),
    likesOther: tf('viewer.likes.other'),
    commentsOne: tf('viewer.comments.one'),
    commentsOther: tf('viewer.comments.other'),
    genericError: tf('viewer.errors.generic'),
  };
}
