'use client';

import { FollowButton } from '@rede-social/module-social/ui';
import { useToast } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { followAction, unfollowAction } from './follow-actions';

export interface FollowControlProps {
  membershipId: string;
  /** The person's display name: it appears ONLY in the accessible name, never as visible text. */
  name: string;
  size: 'md' | 'sm';
  /**
   * The caller's state toward this person, or `null` while it has not arrived (EP-43): the control
   * then holds its fixed slot and draws no label, so a "Seguir" that is really "Seguindo" can never
   * show.
   */
  initialFollowing: boolean | null;
  fullWidth?: boolean;
  className?: string;
  /** Receives the target's follower count the server answered with (the profile's counts row). */
  onChange?: (followerCount: number) => void;
  /**
   * Called once, after a FOLLOW the server confirmed (`following: true`); never for an unfollow or a
   * failure. The locked post screen (09-11) uses it to refresh the route into the real post.
   */
  onFollowed?: () => void;
}

/**
 * THE follow toggle, one component for every placement (09-10, UI-D-498, D-470): the profile, a
 * directory row, a row of the two private lists and the "Siga para ver" screen (09-11).
 *
 * **Optimistic and reconciled.** A tap flips the button at once and calls the matching action in a
 * transition. The server's `{ following, followerCount }` then wins over the guess, and the count goes
 * to the host (`onChange`). While the action is in flight the button is the shipped `loading` look
 * (spinner, `aria-busy`, disabled), and a second tap is ignored by a ref as well, because two clicks
 * can land in the same tick before the disabled state paints. Follow and unfollow are idempotent end
 * to end (T-09-28), so a retry never shows a conflict.
 *
 * **A failure reverts the button and toasts a fixed catalog sentence** (T-09-37): the action answers a
 * code, never copy. There is no confirmation on unfollow and no success toast; the flipped button is
 * the feedback.
 *
 * **It follows the server value (WR-04, EP-43).** `initialFollowing` is the server's answer, and it can
 * arrive late (`null`, then a boolean) or change after a refresh. The control keeps a copy of the last
 * value it saw and, when the prop differs, replaces its local state DURING render (never in an effect,
 * so no frame shows the stale label, and never by a `key`, so a tap in flight is not dropped). Only a
 * CHANGED server value replaces local state: a re-render with the same value leaves a confirmed tap
 * alone. A tap in flight keeps the `inFlight` guard and the action's own answer is applied when it
 * resolves.
 *
 * It owns no placement rule: WHERE it renders (never in a post header, a comment, the Reels rail) is
 * the host screens' decision, and the staff, own-row and `social`-off cases never mount it.
 */
export function FollowControl({
  membershipId,
  name,
  size,
  initialFollowing,
  fullWidth,
  className,
  onChange,
  onFollowed,
}: FollowControlProps) {
  const t = useTranslations('social');
  const toast = useToast();
  const [following, setFollowing] = useState(initialFollowing === true);
  const [seenInitial, setSeenInitial] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  if (seenInitial !== initialFollowing) {
    // Adjust state while rendering: React re-runs this render at once with the new state.
    setSeenInitial(initialFollowing);
    setFollowing(initialFollowing === true);
  }

  if (initialFollowing === null) {
    // The slot keeps the row's geometry; it carries no word and no control.
    return <span aria-hidden className="inline-block w-24 shrink-0" />;
  }

  const toggle = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !following;
    setFollowing(next);
    startTransition(async () => {
      try {
        const answer = await (next ? followAction : unfollowAction)(membershipId);
        if (answer.ok) {
          setFollowing(answer.following);
          onChange?.(answer.followerCount);
          if (next && answer.following) onFollowed?.();
        } else {
          setFollowing(!next);
          toast.show({ tone: 'error', message: t(next ? 'errors.follow' : 'errors.unfollow') });
        }
      } catch (error) {
        // An action that never reached the server is the same outcome as a refusal for the member.
        console.error('social.follow_toggle_failed', { error: String(error) });
        setFollowing(!next);
        toast.show({ tone: 'error', message: t(next ? 'errors.follow' : 'errors.unfollow') });
      } finally {
        inFlight.current = false;
      }
    });
  };

  return (
    <FollowButton
      following={following}
      pending={pending}
      size={size}
      fullWidth={fullWidth}
      className={className}
      labels={{
        follow: t('follow.follow'),
        following: t('follow.following'),
        ariaFollow: t('follow.ariaFollow', { name }),
        ariaFollowing: t('follow.ariaFollowing', { name }),
      }}
      onToggle={toggle}
    />
  );
}
