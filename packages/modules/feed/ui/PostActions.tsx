'use client';

import { IconButton } from '@rede-social/ui';
import { MessageCircle, Send } from 'lucide-react';
import { LikeButton } from './LikeButton';

/**
 * The card's action row: exactly THREE 44x44 controls (UI-D-07) — like, comment, share — offset
 * `-ml-2.5` so the leftmost glyph sits optically on the card's 16px gutter while the row keeps the
 * prototype's density.
 *
 * Deliberately only three: the prototype ships a fourth control that files a post away for later,
 * the requirements name no such feature, and a control that stores nothing is worse than an absent
 * one.
 *
 * The row never wraps and never changes size with the numbers beside it — the meta row shrinks
 * first (UI-SPEC E09/overflow). Comment and share take handlers from the host (04-07 and 04-08);
 * with no handler the control is still present but inert, because "the action row is always
 * present" is the contract and there is no "no actions" state (E09/empty).
 */
/**
 * 11.1-14 (UI-D-888, BPERM-21): which of the three controls the viewer's FINISHED facts allow. A
 * control whose fact is false is not rendered at all (not in the DOM, not inert, not hidden by CSS)
 * and the rest close up from the left in the shipped order. The module compares no role and names no
 * product: the host hands booleans in.
 */
export type PostActionsShow = { like: boolean; comment: boolean; share: boolean };

export type PostActionsProps = {
  /** Absent means all three, the shipped row, so no existing host changes. */
  show?: PostActionsShow;
  liked: boolean;
  /** Announced by the like control; `null` at zero (UI-D-21). */
  countLabel: string | null;
  pulseKey: number;
  onToggleLike: () => void;
  onComment?: () => void;
  onShare?: () => void;
  labels: {
    like: string;
    unlike: string;
    comment: string;
    share: string;
  };
};

export function PostActions({
  show,
  liked,
  countLabel,
  pulseKey,
  onToggleLike,
  onComment,
  onShare,
  labels,
}: PostActionsProps) {
  return (
    <div className="-ml-2.5 flex shrink-0 items-center">
      {show?.like === false ? null : (
        <LikeButton
          liked={liked}
          countLabel={countLabel}
          likeLabel={labels.like}
          unlikeLabel={labels.unlike}
          pulseKey={pulseKey}
          onToggle={onToggleLike}
        />
      )}
      {show?.comment === false ? null : (
        <IconButton
          icon={MessageCircle}
          size={20}
          label={labels.comment}
          data-post-action="comment"
          onClick={onComment}
        />
      )}
      {show?.share === false ? null : (
        <IconButton
          icon={Send}
          size={20}
          label={labels.share}
          data-post-action="share"
          onClick={onShare}
        />
      )}
    </div>
  );
}
