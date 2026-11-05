'use client';

import { cn, IconButton } from '@rede-social/ui';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { CommentsList, type CommentsListProps } from './CommentsList';

/**
 * 2026-10-23 — the comments BESIDE the desktop Reels player (the YouTube Shorts layout, the product
 * owner's request): the same `CommentsList` `CommentSheet` holds (D-59: two containers, one list),
 * in a panel instead of a sheet, so nothing a member can observe in the list differs between them.
 *
 * **Not modal.** The video keeps playing beside it and the member may move to the next video, whose
 * comments the host then puts in it. So there is no backdrop and no focus trap: focus moves to the
 * title on open (the sheet's `initialFocus="title"`) and returns to the control that opened it when
 * the panel closes with the focus still in it.
 *
 * **Escape closes the panel only.** A NATIVE listener on the panel itself stops it: the Reels overlay
 * a feed video opens is a modal whose own (native) Escape handler sits on an ancestor, and a React
 * handler would run only after that one had already closed the overlay.
 *
 * Every word is a prop (PWA-03); the title's count arrives drawn (`compactCount`).
 */
export type CommentPanelProps = Omit<CommentsListProps, 'variant'> & {
  /** "Comentários". */
  title: string;
  /** The drawn count beside the title, or null. */
  count?: string | null;
  /** "Fechar comentários": the close control's name. */
  closeLabel: string;
  onClose: () => void;
  className?: string;
};

export function CommentPanel({
  title,
  count = null,
  closeLabel,
  onClose,
  className,
  ...list
}: CommentPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    titleRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation();
      closeRef.current();
    };
    root?.addEventListener('keydown', onKeyDown);
    return () => {
      root?.removeEventListener('keydown', onKeyDown);
      // Back to the opener when the focus went down with the panel (it falls to the body), never
      // when the member had already moved it elsewhere.
      const active = document.activeElement;
      if (opener?.isConnected && (active === null || active === document.body)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <aside
      ref={rootRef}
      aria-label={title}
      data-comment-panel=""
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary text-text',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-divider py-2 pr-2 pl-4">
        <h2
          ref={titleRef}
          tabIndex={-1}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-lg font-bold focus:outline-none"
        >
          <span className="truncate">{title}</span>
          {count ? (
            <span className="text-sm font-normal text-text-secondary tabular-nums">{count}</span>
          ) : null}
        </h2>
        <IconButton icon={X} label={closeLabel} onClick={onClose} />
      </div>
      <CommentsList {...list} variant="sheet" />
    </aside>
  );
}
