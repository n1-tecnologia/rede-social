'use client';

import { cn } from '@tria/ui';
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * The caption block over a Reels page (REELS-07, UI-D-88, D-129, D-131): the author, the community
 * chip, and the caption clamped to two rendered lines.
 *
 * **The body arrives linkified.** The host renders the caption through the feed's ONE `linkify`
 * sink (D-54) and passes the result as children, so this module has no HTML-injection sink and no
 * link rules of its own (T-05.3-14); it only re-colours the links white over video with a
 * descendant override of linkify's brand colour.
 *
 * **Clamped by lines, never cut by characters.** Collapsed is `line-clamp-2`; the component never
 * shortens the string, so no emoji, surrogate pair or grapheme cluster can be split (unlike
 * `PostCaption`, whose character cut is right for a card of fixed width and wrong on a surface that
 * runs from 320 px to the desktop column). Whether "… mais" is needed is MEASURED after layout and
 * again on every resize: `scrollHeight > clientHeight` on the clamped paragraph. A caption that
 * exactly fills two lines shows no toggle.
 *
 * **Expanded.** The clamp is dropped and the paragraph scrolls inside a 40vh box (`touch-action:
 * pan-y`, the story caption's bound), so a long caption can never push the block into the lane row;
 * a trailing "menos" collapses it; and a veil darkens the page under the overlays. The veil is a
 * sibling rendered BEFORE the block, so with the block at `z-[3]` and the veil at `z-[2]` it covers
 * the video but not the lanes, the rail or the caption.
 *
 * **The video keeps playing (D-131).** Reading is not a reason to stop a reel, and the component
 * has no pause callback at all. The expanded state is controlled by the host, which resets it when
 * the page changes.
 *
 * **What toggles.** "… mais", "menos", the veil, and a tap on the caption text that does not land
 * on a link (the link navigates; toggling under it would be a second, surprising action). A tap on
 * text that is neither clamped nor expanded does nothing.
 *
 * **Pointers stop here.** The block and the veil sit over the pager's tap surface: a tap on either
 * must never pause the video or count toward a double-tap like.
 *
 * Plain `<a>` links (D-52): a module must not depend on the web framework. Every string is a prop.
 */
export type ReelCaptionProps = {
  /** The author's name and profile href (`/membros/{membershipId}`). */
  author: { name: string; href: string };
  /** `null` when the post has no community: no chip at all (D-129). */
  community: { name: string; href: string; ariaLabel: string } | null;
  /** The linkified caption; absent or empty renders the name and chip only. */
  children?: ReactNode;
  moreLabel: string;
  lessLabel: string;
  expanded: boolean;
  onExpandedChange(next: boolean): void;
};

/** The story caption's shipped text shadow, so white ink stays legible over a bright frame. */
const SHADOW = 'drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]';
/** The white focus ring every control over video carries (UI-D-97). */
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';
const TOGGLE = cn('text-sm font-bold text-white/70', RING);

function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}
const STOP_POINTER = {
  onPointerDown: stopPointer,
  onPointerMove: stopPointer,
  onPointerUp: stopPointer,
  onPointerCancel: stopPointer,
};

function hasContent(children: ReactNode): boolean {
  if (children === null || children === undefined || typeof children === 'boolean') return false;
  if (typeof children === 'string') return children.length > 0;
  if (Array.isArray(children)) return children.some(hasContent);
  return true;
}

export function ReelCaption({
  author,
  community,
  children,
  moreLabel,
  lessLabel,
  expanded,
  onExpandedChange,
}: ReelCaptionProps) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const withText = hasContent(children);

  // Measured only while collapsed: expanded, the 40vh box may overflow too, and that is scrolling,
  // not a reason to offer "mais". The measurement re-runs when the text or the clamp changes and on
  // every resize of the paragraph (rotation, the desktop column, a font that loaded late).
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text can overflow at an unchanged clamped height, which no resize reports.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, children]);

  const onTextClick = (event: ReactMouseEvent<HTMLParagraphElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button')) return;
    if (!expanded && !overflowing) return;
    onExpandedChange(!expanded);
  };

  return (
    <>
      {expanded ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; "menos" is the keyboard path.
        // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; "menos" is the keyboard path.
        <div
          aria-hidden
          data-reel-caption-veil
          onClick={() => onExpandedChange(false)}
          {...STOP_POINTER}
          className="absolute inset-0 z-[2] bg-black/50 transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
        />
      ) : null}

      <div
        data-reel-caption
        {...STOP_POINTER}
        className="absolute right-[72px] bottom-[calc(var(--safe-bottom)+88px)] left-4 z-[3] text-white md:bottom-6"
      >
        <a
          href={author.href}
          className={cn('block truncate text-base font-bold text-white', SHADOW, RING)}
        >
          {author.name}
        </a>

        {community ? (
          <a
            href={community.href}
            aria-label={community.ariaLabel}
            className={cn('inline-flex min-h-11 max-w-full items-center', RING)}
          >
            <span className="block h-7 max-w-full truncate rounded-full bg-white/20 px-3 text-xs leading-7 font-bold text-white">
              {community.name}
            </span>
          </a>
        ) : null}

        {withText ? (
          <div className="relative">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; "mais"/"menos" are the keyboard path. */}
            <p
              ref={textRef}
              data-reel-caption-text
              onClick={onTextClick}
              style={expanded ? { touchAction: 'pan-y' } : undefined}
              className={cn(
                'whitespace-pre-wrap break-words text-sm leading-normal font-normal text-white',
                '[&_a]:font-bold [&_a]:text-white [&_a]:underline',
                SHADOW,
                expanded ? 'max-h-[40vh] overflow-y-auto overscroll-contain' : 'line-clamp-2',
              )}
            >
              {children}
              {expanded ? (
                <>
                  {' '}
                  <button
                    type="button"
                    aria-expanded="true"
                    onClick={() => onExpandedChange(false)}
                    className={TOGGLE}
                  >
                    {lessLabel}
                  </button>
                </>
              ) : null}
            </p>
            {!expanded && overflowing ? (
              <button
                type="button"
                aria-expanded="false"
                onClick={() => onExpandedChange(true)}
                className={cn(
                  'absolute right-0 bottom-0 bg-gradient-to-r from-transparent to-black/70 pl-6',
                  TOGGLE,
                )}
              >
                {moreLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
