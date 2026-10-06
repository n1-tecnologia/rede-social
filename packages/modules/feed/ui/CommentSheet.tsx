'use client';

import { BottomSheet } from '@rede-social/ui';
import { CommentsList, type CommentsListProps } from './CommentsList';

/**
 * The comment sheet over the feed (D-59) and over the story viewer (D-82) — `[proto]`
 * `comments/CommentSheet.tsx` on the SHIPPED `BottomSheet`.
 *
 * **It is a container and nothing else.** Every behaviour a member can observe inside it — the
 * ordering, the paging, the reply expansion, the delete affordance, the two UI-D-22 error branches
 * — belongs to `CommentsList`, which `/post/[id]` renders inline from the same file. That is the
 * whole point of D-59: two surfaces, one implementation. If this component ever grows a conditional
 * about what a comment looks like, the drift the decision exists to prevent has started. The story
 * surface is therefore ONE prop — `variant="flat"` — handed straight to the list.
 *
 * **The sheet's HEIGHT is the primitive's, unmodified** (UI-D-18). The prototype set its own
 * `0.7`; the shipped `BottomSheet` uses `0.8` and nothing here overrides it. One sheet geometry
 * across the app is exactly what `@rede-social/ui` exists to hold, and a per-caller override is the drift
 * it exists to prevent — so there is deliberately no height class in this file.
 *
 * **Only the SCROLL moves, through the primitive's own prop** (`scroll="content"`). The list owns
 * the scrollport and the composer is the sheet's footer BELOW it, which is the UI-SPEC's geometry
 * ("the list scrolls with the input pinned at the bottom"). A composer that was `sticky` inside the
 * primitive's padded body sat 16px above the edge, covering the last row's meta line and letting
 * rows show through a strip beneath it.
 *
 * **Focus is the primitive's too**: `role="dialog"`, `aria-modal`, the focus trap, Escape, the
 * drag-to-dismiss and the lift above the phone keyboard all come from `BottomSheet`. Here it moves
 * focus to the sheet's TITLE on open (`initialFocus="title"`, 04-UI-SPEC §Accessibility), not to
 * the field, which on a phone is the keyboard rising over a sheet that has not finished sliding in;
 * the member taps the field to write, and "Responder" still focuses it. Closing returns focus to
 * the control that opened the sheet. Re-implementing any of that here would be a second dialog
 * behaviour for members to learn.
 */
export type CommentSheetProps = Omit<CommentsListProps, 'variant'> & {
  open: boolean;
  onClose: () => void;
  /** The sheet's title — a fixed string from the host's catalog, never interpolated (E10/long-text). */
  title: string;
  /**
   * `sheet` is the feed's; `flat` is a story's (D-82) — no reply affordance, no replies toggle, no
   * per-comment like, and new comments appended at the bottom. `inline` is deliberately NOT
   * offerable here: it is the shape the POST PAGE renders without a sheet at all.
   */
  variant?: 'sheet' | 'flat';
  /** The handle's accessible name ("Fechar comentários"); the handle is the sheet's close control. */
  closeLabel?: string;
};

/**
 * 2026-10-06: a swipe on a long list SCROLLS it and never closes the sheet. Only the handle bar
 * closes it (a tap, or a drag down), besides a tap outside and Escape (`dismiss="handle"`).
 */
export function CommentSheet({
  open,
  onClose,
  title,
  variant = 'sheet',
  closeLabel,
  ...list
}: CommentSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      scroll="content"
      initialFocus="title"
      dismiss="handle"
      handleLabel={closeLabel}
    >
      <CommentsList {...list} variant={variant} />
    </BottomSheet>
  );
}
