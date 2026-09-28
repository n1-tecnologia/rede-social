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
export type PostActionsProps = {
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
      <LikeButton
        liked={liked}
        countLabel={countLabel}
        likeLabel={labels.like}
        unlikeLabel={labels.unlike}
        pulseKey={pulseKey}
        onToggle={onToggleLike}
      />
      <IconButton icon={MessageCircle} size={20} label={labels.comment} onClick={onComment} />
      <IconButton icon={Send} size={20} label={labels.share} onClick={onShare} />
    </div>
  );
}
