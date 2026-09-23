'use client';

import { BottomSheet } from '@tria/ui';
import { CommentsList, type CommentsListProps } from './CommentsList';

/**
 * The comment sheet over the feed (D-59) — `[proto]` `comments/CommentSheet.tsx` on the SHIPPED
 * `BottomSheet`.
 *
 * **It is a container and nothing else.** Every behaviour a member can observe inside it — the
 * ordering, the paging, the reply expansion, the delete affordance, the two UI-D-22 error branches
 * — belongs to `CommentsList`, which `/post/[id]` renders inline from the same file. That is the
 * whole point of D-59: two surfaces, one implementation. If this component ever grows a conditional
 * about what a comment looks like, the drift the decision exists to prevent has started.
 *
 * **The sheet's HEIGHT is the primitive's, unmodified** (UI-D-18). The prototype set its own
 * `0.7`; the shipped `BottomSheet` uses `0.8` and nothing here overrides it. One sheet geometry
 * across the app is exactly what `@tria/ui` exists to hold, and a per-caller override is the drift
 * it exists to prevent — so there is deliberately no height class in this file.
 *
 * **Focus is the primitive's too**: `role="dialog"`, `aria-modal`, the focus trap, Escape and the
 * drag-to-dismiss all come from `BottomSheet`, which moves focus into the panel on open and returns
 * it to the control that opened it on close. Re-implementing any of that here would be a second
 * dialog behaviour for members to learn.
 */
export type CommentSheetProps = Omit<CommentsListProps, 'variant'> & {
  open: boolean;
  onClose: () => void;
  /** The sheet's title — a fixed string from the host's catalog, never interpolated (E10/long-text). */
  title: string;
};

export function CommentSheet({ open, onClose, title, ...list }: CommentSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <CommentsList {...list} variant="sheet" />
    </BottomSheet>
  );
}
