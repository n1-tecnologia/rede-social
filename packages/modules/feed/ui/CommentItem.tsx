'use client';

import { Avatar, BottomSheet, cn, IconButton } from '@rede-social/ui';
import { Ban, Ellipsis, Flag, Heart, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { linkify } from './linkify';
import { MenuRow } from './MenuRow';
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
  /**
   * 11-20 (D-733): the author's membership id, for the block call (a membership id, never a user id,
   * T-11-34). Null for a removed member; absent from a host that predates it.
   */
  membershipId?: string | null;
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
   * 11-20 (D-733, UI-D-632): the API's riders, copied through and never derived from a role. `canReport`: the
   * viewer did not write the comment. `canBlock`: not their own AND the author is a live member AND the viewer
   * is a member. Absent reads as false.
   */
  canReport?: boolean;
  canBlock?: boolean;
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
  /**
   * 11-20 (UI-D-632): the menu control's accessible name, "Mais ações do comentário". ABSENT means the host
   * predates the menu: the row keeps its single direct delete control, exactly as shipped.
   */
  moreActions?: string;
  /** The report row's own label (the sheet's title is the host's). */
  report?: string;
  /** The block row's label with `{nome}` still in it; the row fills in the name it is showing. */
  block?: string;
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
   * 11-20 (D-733): raised by the menu's "Denunciar comentário" and "Bloquear {nome}" rows, AFTER the menu
   * closes. The report sheet and the block dialog are the host's. A row is drawn only when its rider
   * (`canReport`, `canBlock`), its label and its callback are all present; the same "the presence of a handler
   * chooses the shell" rule as `onReply` and `onDelete`.
   */
  onReport?: (comment: CommentView) => void;
  onBlock?: (comment: CommentView) => void;
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
  onReport,
  onBlock,
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

  // 11-20 (D-733, UI-D-632): what the "Mais ações do comentário" menu holds, from DATA. Staff and the
  // author's own row never get "Bloquear" (the rider says so); a removed author has no name to put in it.
  const canRemove = removal !== null && onDelete !== undefined;
  const reportLabel =
    comment.canReport === true && onReport !== undefined ? (labels.report ?? null) : null;
  const blockLabel =
    comment.canBlock === true &&
    onBlock !== undefined &&
    !authorRemoved &&
    author.displayName !== null &&
    labels.block !== undefined
      ? labels.block.replace('{nome}', author.displayName)
      : null;
  const hasMenu =
    labels.moreActions !== undefined &&
    !pending &&
    (canRemove || reportLabel !== null || blockLabel !== null);
  // The sheet mounts on its first open and stays mounted so its exit animation can play; a list of
  // twenty rows therefore carries no overlay machinery until one is used.
  const [menuUsed, setMenuUsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeThen = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };

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
          {hasMenu ? (
            // 11-20 (D-733, UI-D-632): the row's ONE overflow control. It replaces the single trash
            // button of 04-07/08-01 and opens the SAME `BottomSheet` geometry as the post menu, with the
            // destructive row last. The author's own row holds the delete row alone; someone else's holds
            // "Denunciar" and, for a member author, "Bloquear {nome}", plus the moderator's remove row.
            <IconButton
              icon={Ellipsis}
              size={20}
              label={labels.moreActions ?? ''}
              data-comment-more
              data-comment-removal={removal ?? undefined}
              aria-haspopup="dialog"
              onClick={() => {
                setMenuUsed(true);
                setMenuOpen(true);
              }}
              className="-my-3.5 text-text-tertiary"
            />
          ) : labels.moreActions === undefined && canRemove && !pending ? (
            // A host that has not adopted the menu keeps the one direct control, as shipped.
            <button
              type="button"
              data-comment-delete
              data-comment-removal={removal}
              aria-label={removeLabel}
              onClick={() => onDelete?.(comment)}
              className="inline-flex items-center gap-1 font-bold text-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Trash2 aria-hidden size={14} />
            </button>
          ) : null}
        </div>

        {children}
      </div>

      {menuUsed ? (
        <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
          <div className="flex flex-col gap-1">
            {reportLabel !== null ? (
              <MenuRow
                icon={Flag}
                label={reportLabel}
                onClick={closeThen(() => onReport?.(comment))}
                attrs={{ 'data-comment-report': '' }}
              />
            ) : null}
            {blockLabel !== null ? (
              <MenuRow
                icon={Ban}
                label={blockLabel}
                onClick={closeThen(() => onBlock?.(comment))}
                attrs={{ 'data-comment-block': '' }}
              />
            ) : null}
            {canRemove ? (
              <MenuRow
                icon={Trash2}
                label={removeLabel}
                destructive
                onClick={closeThen(() => onDelete?.(comment))}
                attrs={{
                  'data-comment-delete': '',
                  'data-comment-removal': removal ?? undefined,
                }}
              />
            ) : null}
          </div>
        </BottomSheet>
      ) : null}

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
