'use client';

import { Avatar, cn, IconButton } from '@rede-social/ui';
import { Heart, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { linkify } from './linkify';
import type { CountTemplates } from './meta';
import { formatCountLabel } from './meta';

/**
 * One comment row — `[proto]` `comments/CommentItem.tsx`, with the prototype's unbounded recursion
 * REPLACED by a flag (D-60/FEED-05) and its `lib/mock/users` gender read and `VerifiedBadge`
 * dropped.
 *
 * **`isReply` is the visible half of the one-level cap.** The database refuses a second reply level
 * outright (`feed_comments_parent_fk`), but a UI that still offered "Responder" on a reply would be
 * inviting members into a refusal. So a row rendered with `isReply` shows NO reply control and NO
 * replies toggle — there is no branch here that can put one there — and the cap is something a
 * member can see rather than only something the database knows.
 *
 * **A removed author keeps their row** (UI-D-24). When `authorRemoved` is true the name renders as
 * the catalog's fixed label in PLAIN TEXT — never a link, because `profileHref` is null and there
 * is nothing to link to — and the avatar falls back to the shipped neutral placeholder. The body,
 * the timestamp, the likes and the thread beneath are all untouched: this removes the person, not
 * the conversation.
 *
 * **The body goes through the shared `linkify`**, which is the caption's (D-54, T-04-43): plain
 * text in, real anchor elements out, `http(s)` only, `rel="noopener noreferrer nofollow"`, and no
 * HTML-injection sink anywhere in the path.
 *
 * **No clock is read here** (UI-D-14): the relative string, the absolute title and the ISO value
 * all arrive as props, formatted on the server — or, for a comment the member just wrote, as the
 * host's "agora".
 */

/** The author as the HOST has already resolved them; all three are null for a removed member. */
export type CommentAuthorView = {
  displayName: string | null;
  /** `/membros/{membershipId}` (D-52) — null when the membership is gone (UI-D-24). */
  profileHref: string | null;
  avatarUrl: string | null;
};

export type CommentView = {
  id: string;
  body: string;
  author: CommentAuthorView;
  /** UI-D-24 — true exactly when the author's membership is missing or soft-deleted. */
  authorRemoved: boolean;
  createdAtIso: string;
  createdAtRelative: string;
  createdAtAbsolute: string;
  likeCount: number;
  viewerLiked: boolean;
  /** Live replies under this root (D-60). Zero means no rule and no toggle are drawn at all. */
  replyCount: number;
  isReply: boolean;
  /** Server-derived (T-04-44): the client never compares ids to decide who may delete. */
  canDelete: boolean;
  /**
   * 08-01 (UI-D-276): what the removal control MEANS for this viewer, copied through from the server
   * — `'own'` (their comment: "Excluir"), `'moderation'` (someone else's, the viewer moderates:
   * "Remover", logged) or `null` (no control). Absent on a row from an API that predates it; the
   * host maps that to `canDelete ? 'own' : null`, and `removalOf` below does the same.
   */
  removal?: 'own' | 'moderation' | null;
  /**
   * An optimistic row the server has not confirmed yet. It renders identically except that its
   * controls are inert — a like or a delete addressed to an id the server has never seen would be
   * a guaranteed 404, and offering it would be a lie about what the row currently is.
   */
  pending?: boolean;
};

export type CommentItemLabels = {
  /** UI-D-24's fixed label, shown INSTEAD of a name and never as a link. */
  removedAuthor: string;
  like: string;
  unlike: string;
  /** The like-count segment templates; the row hides the count entirely at zero **[proto]**. */
  likes: CountTemplates;
  /** "Responder" — root comments only. */
  reply: string;
  /** The own-comment control's accessible name; it opens the confirmation directly (see below). */
  delete: string;
  /**
   * 08-01 (UI-D-276): the MODERATION control's accessible name, "Remover comentário de {author}",
   * with `{author}` still in it — the row fills in the name it is showing. Absent means the host
   * predates moderation, and the own label is used.
   */
  remove?: string;
};

/** The row's removal meaning, with an absent server value read as the pre-08-01 `canDelete` rule. */
export function removalOf(comment: CommentView): 'own' | 'moderation' | null {
  if (comment.removal !== undefined) return comment.removal;
  return comment.canDelete ? 'own' : null;
}

export type CommentItemProps = {
  comment: CommentView;
  /** BCP-47 tag from the host: the module formats numbers for it but ships no words (PWA-03). */
  locale: string;
  labels: CommentItemLabels;
  /** Absent on a reply BY CONSTRUCTION — the list never passes one for an `isReply` row. */
  onReply?: (comment: CommentView) => void;
  /** Raises the list's shared confirmation dialog; the row owns the control, not the dialog. */
  onDelete?: (comment: CommentView) => void;
  /**
   * ABSENT MEANS NO HEART AT ALL, not a disabled one (05-07). The flat variant a story's comments
   * render in has no per-comment like, because `feed_likes_comment_fk` makes the row
   * unrepresentable — and an affordance a member can see but never use is worse than none. The same
   * "the presence of a handler chooses the shell" rule `onReply` and `onDelete` already follow.
   */
  onToggleLike?: (comment: CommentView) => void;
  /** Rendered beneath the body by the LIST: the replies toggle, its skeleton, its retry, its rows. */
  children?: React.ReactNode;
  /**
   * 07-04 (UI-D-254): this is the comment a notification tap named. After mount the row scrolls to
   * the centre and wears `rounded-xl bg-brand/10` (the unread row's tint, so "this is what you were
   * told about" reads the same on both screens) for `HIGHLIGHT_HOLD_MS`, then fades over
   * `HIGHLIGHT_FADE_MS`. Under `prefers-reduced-motion: reduce` there is no transition and the tint
   * stays until the member's first tap, key or scroll gesture.
   */
  highlighted?: boolean;
};

/** UI-D-254: how long the highlight tint holds, and how long it takes to fade. */
export const HIGHLIGHT_HOLD_MS = 2_400;
export const HIGHLIGHT_FADE_MS = 600;

/**
 * The gestures that end a reduced-motion highlight. `wheel` and `touchmove` stand for "the member
 * scrolled": listening to `scroll` itself would end the tint on the row's OWN `scrollIntoView`.
 */
const HIGHLIGHT_END_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const;

export function CommentItem({
  comment,
  locale,
  labels,
  onReply,
  onDelete,
  onToggleLike,
  children,
  highlighted = false,
}: CommentItemProps) {
  const { author, authorRemoved, isReply, pending } = comment;
  const name = authorRemoved ? labels.removedAuthor : (author.displayName ?? labels.removedAuthor);
  const likeLabel = formatCountLabel(comment.likeCount, labels.likes, locale);
  const removal = removalOf(comment);
  // UI-D-276: the SAME control on more rows; only its name says whether this is a moderator's act.
  const removeLabel =
    removal === 'moderation' && labels.remove
      ? labels.remove.replace('{author}', name)
      : labels.delete;

  const rowRef = useRef<HTMLElement>(null);
  const [tinted, setTinted] = useState(highlighted);

  useEffect(() => {
    if (!highlighted) return;
    setTinted(true);
    rowRef.current?.scrollIntoView({ block: 'center' });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const end = () => setTinted(false);
      for (const type of HIGHLIGHT_END_EVENTS) {
        window.addEventListener(type, end, { once: true, passive: true, capture: true });
      }
      return () => {
        for (const type of HIGHLIGHT_END_EVENTS) {
          window.removeEventListener(type, end, { capture: true });
        }
      };
    }
    const timer = window.setTimeout(() => setTinted(false), HIGHLIGHT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  return (
    <article
      ref={rowRef}
      data-comment-id={comment.id}
      data-comment-kind={isReply ? 'reply' : 'root'}
      data-comment-author-removed={authorRemoved ? 'true' : undefined}
      data-comment-highlighted={highlighted && tinted ? 'true' : undefined}
      aria-busy={pending || undefined}
      // UI-D-288: programmatically focusable (never in the tab order), so a removal can hand focus
      // to the next row instead of dropping it on `<body>`.
      tabIndex={-1}
      // `pl-14` overrides the row's own left gutter for the reply indent **[proto]**; the avatar is
      // `shrink-0`, so at 320px the indent is preserved by pushing the BODY in, never by clipping.
      // A highlighted row trades 8px of gutter for 8px of margin on each side so its `rounded-xl`
      // tint reads as a shape, with the content exactly where it was (UI-D-254, sketch 007 item 8).
      className={cn(
        'flex gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
        isReply && 'pl-14',
        highlighted &&
          'mx-2 rounded-xl px-2 transition-colors duration-[600ms] motion-reduce:transition-none',
        highlighted && isReply && 'pl-12',
        highlighted && tinted && 'bg-brand/10',
        pending && 'opacity-60',
      )}
    >
      <Avatar src={author.avatarUrl} alt={name} size="sm" />

      {/* `min-w-0` is what lets long words and long names wrap instead of widening the row. */}
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm font-normal leading-relaxed text-text">
          {authorRemoved || author.profileHref === null ? (
            <span className="font-bold text-text">{name}</span>
          ) : (
            <a
              href={author.profileHref}
              className="font-bold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {name}
            </a>
          )}{' '}
          {linkify(comment.body)}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-normal text-text-tertiary tabular-nums">
          <time dateTime={comment.createdAtIso} title={comment.createdAtAbsolute}>
            {comment.createdAtRelative}
          </time>
          {likeLabel ? <span className="font-bold">{likeLabel}</span> : null}
          {/* THE CAP, rendered: `onReply` is only ever passed for a root, and the `!isReply` guard
              means no future caller can smuggle one onto a reply either (D-60). */}
          {!isReply && onReply && !pending ? (
            <button
              type="button"
              data-comment-reply
              onClick={() => onReply(comment)}
              className="font-bold text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {labels.reply}
            </button>
          ) : null}
          {removal !== null && onDelete && !pending ? (
            // ONE control, one destination. D-61 is "the row's own overflow control, behind a
            // confirmation dialog", and with exactly one action in V1 an intermediate menu would
            // add a second layer over the comment sheet for nothing — and would leave the control
            // named "Mais opções" when it does precisely one thing. 08-01 (UI-D-276) reuses this
            // exact control for a moderator on everyone's rows, named for what it does; Phase 11's
            // "Denunciar" is when it becomes a menu.
            <button
              type="button"
              data-comment-delete
              data-comment-removal={removal}
              aria-label={removeLabel}
              onClick={() => onDelete(comment)}
              className="inline-flex items-center gap-1 font-bold text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Trash2 aria-hidden size={14} />
            </button>
          ) : null}
        </div>

        {children}
      </div>

      {/* `self-start`: the heart stays on the row's first line however tall the body grows. */}
      {onToggleLike ? (
        <IconButton
          icon={Heart}
          size={16}
          label={comment.viewerLiked ? labels.unlike : labels.like}
          aria-pressed={comment.viewerLiked}
          data-comment-like={comment.viewerLiked ? 'liked' : 'unliked'}
          disabled={pending}
          onClick={() => onToggleLike(comment)}
          className={cn(
            'self-start',
            comment.viewerLiked ? 'text-like [&_svg]:fill-like' : 'text-text-tertiary',
          )}
        />
      ) : null}
    </article>
  );
}
