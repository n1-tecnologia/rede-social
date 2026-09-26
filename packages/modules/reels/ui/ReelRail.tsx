'use client';

import { Avatar, cn, IconButton } from '@tria/ui';
import { MessageCircle, Send } from 'lucide-react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';

/**
 * The right rail over a Reels page (REELS-07, UI-D-87, D-129, D-130): the print's avatar, like and
 * comment, plus share last.
 *
 * **Layout only.** The like is a NODE the host builds — the feed's `LikeButton` in its over-media
 * tone with a 28 px glyph, bound to the host's optimistic engine — so this module never imports the
 * feed (MOD-02). Every string is a prop (PWA-03), and every count arrives already drawn
 * (`compactCount`) because the accessible count is the host's full template, not this glyph.
 *
 * **The count slots are always there.** Each `h-5` slot under like and comment is rendered even
 * when its value is `null`, so a first like on a zero-like post fills a slot that already exists
 * instead of pushing every item above it up by 20 px. The drawn number is `aria-hidden`.
 *
 * **Share is last and has no count.** It is omitted only when the host passes no handler — there
 * is no verified primary host to build a link on (T-04-51) — and then nothing is reserved for it.
 *
 * **The author link is a plain `<a>`** (D-52, D-129): a module must not depend on the web framework,
 * and the host is free to intercept the navigation.
 *
 * **Pointers stop here.** The rail sits over the pager's tap surface; a tap on any control must
 * never also pause the video or count toward a double-tap like.
 */
export type ReelRailProps = {
  author: {
    /** `/membros/{membershipId}`, built by the host. */
    href: string;
    avatarUrl: string | null;
    name: string;
    /** The link's accessible name ("Ver o perfil de {name}"). */
    label: string;
  };
  /** The host-built like control (the feed's `LikeButton tone="overMedia" glyphSize={28}`). */
  like: ReactNode;
  /** The drawn like count (`compactCount`), or `null` at zero. */
  likeCount: string | null;
  commentLabel: string;
  /** The drawn comment count (`compactCount`), or `null` at zero. */
  commentCount: string | null;
  onComment(): void;
  shareLabel: string;
  /** Absent → no share control at all (T-04-51). */
  onShare?: () => void;
};

/** The story caption's shipped text shadow, so white ink stays legible over a bright frame. */
const SHADOW = 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]';
/**
 * A 44 px control over video: white glyph with the same shadow, translucent press, and the white
 * focus ring (UI-D-97). Spelled out in full, never interpolated, so Tailwind's scanner sees it.
 */
const OVER_MEDIA_BUTTON =
  'text-white hover:bg-white/10 active:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-0 [&_svg]:drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]';
const GLYPH = 28;

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}

/** The reserved number under a glyph: always 20 px tall, empty at zero, never announced. */
function CountSlot({ which, value }: { which: 'like' | 'comment'; value: string | null }) {
  return (
    <span
      aria-hidden
      data-reel-count={which}
      className={cn('h-5 text-xs leading-5 font-bold text-white tabular-nums', SHADOW)}
    >
      {value ?? ''}
    </span>
  );
}

export function ReelRail({
  author,
  like,
  likeCount,
  commentLabel,
  commentCount,
  onComment,
  shareLabel,
  onShare,
}: ReelRailProps) {
  return (
    <div
      className="absolute right-2 bottom-[calc(var(--safe-bottom)+88px)] z-[3] flex w-12 flex-col items-center gap-4 md:bottom-6"
      onPointerDown={stopPointer}
      onPointerMove={stopPointer}
      onPointerUp={stopPointer}
      onPointerCancel={stopPointer}
    >
      <a
        href={author.href}
        aria-label={author.label}
        className="grid size-11 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Avatar src={author.avatarUrl} alt={author.name} size="md" className="ring-2 ring-white" />
      </a>

      <div className="flex flex-col items-center">
        {like}
        <CountSlot which="like" value={likeCount} />
      </div>

      <div className="flex flex-col items-center">
        <IconButton
          icon={MessageCircle}
          size={GLYPH}
          label={commentLabel}
          onClick={onComment}
          className={OVER_MEDIA_BUTTON}
        />
        <CountSlot which="comment" value={commentCount} />
      </div>

      {onShare ? (
        <IconButton
          icon={Send}
          size={GLYPH}
          label={shareLabel}
          onClick={onShare}
          className={OVER_MEDIA_BUTTON}
        />
      ) : null}
    </div>
  );
}
