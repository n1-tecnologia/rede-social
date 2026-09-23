'use client';

import { cn, IconButton, useMediaQuery } from '@tria/ui';
import { Heart } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

/**
 * The like affordance (FEED-04, UI-D-07, UI-D-08) and the optimistic engine behind it.
 *
 * **The engine is a hook, not the button's private state.** `useOptimisticLike` lives here because
 * it is the like's behaviour, but the CARD calls it: the same toggle has to serve three entry
 * points — this button, the double tap on the gallery, and the count the meta row prints — and a
 * state hidden inside the button could serve only the first. One hook, one truth, one request in
 * flight.
 *
 * **Optimistic, never pending.** Activation flips the local value immediately: no spinner, no
 * disabled state (UI-SPEC E09/loading). The server's authoritative `{ liked, likeCount }` replaces
 * the optimistic value on response; a rejection restores the exact pair that was on screen before
 * the click and raises `onError` — and NEVER removes the card (the 03-05 no-optimistic-removal
 * rule).
 *
 * **The heart is `--color-like`, never the tenant accent** (UI-D-08): a green or purple heart loses
 * an affordance every member already knows, and the brand is everywhere else in the shell.
 */
export type LikeState = { liked: boolean; likeCount: number };

/**
 * What the card hands the engine. Resolving with a state REPLACES the optimistic pair with the
 * server's authoritative one; resolving with `null` leaves the optimistic pair standing (the caller
 * could not read a count); REJECTING reverts it. Those three are the whole protocol.
 */
export type LikeToggle = (nextLiked: boolean) => Promise<LikeState | null> | LikeState | null;

export type UseOptimisticLikeOptions = {
  /** The server-rendered seed; a NEW value re-syncs the local state (a refresh replaced the card). */
  liked: boolean;
  likeCount: number;
  onToggle: LikeToggle;
  /** Raised once per failed toggle, after the revert — the host shows the generic error toast. */
  onError?: () => void;
};

export type UseOptimisticLikeResult = {
  state: LikeState;
  /** Idempotent per activation: one call, one request, one flip. */
  toggle: () => void;
  /** Bumped on every activation; the button animates on the change, not on the liked value. */
  pulseKey: number;
};

export function useOptimisticLike({
  liked,
  likeCount,
  onToggle,
  onError,
}: UseOptimisticLikeOptions): UseOptimisticLikeResult {
  const [state, setState] = useState<LikeState>({ liked, likeCount });
  const [pulseKey, setPulseKey] = useState(0);

  // Re-seed from the props when the SERVER sends a different pair (pull-to-refresh replaced the
  // list). Adjusting state during render is React's documented alternative to an effect and keeps
  // the card and its seed in lockstep without painting the previous value first.
  const [seed, setSeed] = useState<LikeState>({ liked, likeCount });
  if (seed.liked !== liked || seed.likeCount !== likeCount) {
    setSeed({ liked, likeCount });
    setState({ liked, likeCount });
  }

  // Only the LATEST request may write the authoritative value back. Without this a slow first
  // response could land after a second tap and resurrect the state the member just left.
  const requestId = useRef(0);
  const currentRef = useRef(state);
  currentRef.current = state;

  const toggle = useCallback(() => {
    const previous = currentRef.current;
    const next: LikeState = {
      liked: !previous.liked,
      likeCount: Math.max(0, previous.likeCount + (previous.liked ? -1 : 1)),
    };
    const id = requestId.current + 1;
    requestId.current = id;

    currentRef.current = next;
    setState(next);
    setPulseKey((value) => value + 1);

    void (async () => {
      try {
        const result = await onToggle(next.liked);
        if (requestId.current !== id) return;
        if (result) {
          currentRef.current = result;
          setState(result);
        }
      } catch {
        if (requestId.current !== id) return;
        currentRef.current = previous;
        setState(previous);
        onError?.();
      }
    })();
  }, [onToggle, onError]);

  return { state, toggle, pulseKey };
}

export type LikeButtonProps = {
  liked: boolean;
  /** The already-formatted count, or `null` at zero — announced, not drawn (the meta row draws it). */
  countLabel: string | null;
  /** Accessible name while UNLIKED: activating it likes the post. */
  likeLabel: string;
  /** Accessible name while LIKED: activating it removes the like. */
  unlikeLabel: string;
  /** Changes on every activation; the pulse runs on the change. */
  pulseKey: number;
  onToggle: () => void;
};

/** How long the pop lasts. Short enough to be over before a second tap can land. */
const PULSE_MS = 220;

export function LikeButton({
  liked,
  countLabel,
  likeLabel,
  unlikeLabel,
  pulseKey,
  onToggle,
}: LikeButtonProps) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [pulsing, setPulsing] = useState(false);
  const [seenPulse, setSeenPulse] = useState(pulseKey);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (seenPulse !== pulseKey) {
    setSeenPulse(pulseKey);
    if (!reduceMotion) {
      setPulsing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPulsing(false), PULSE_MS);
    }
  }

  return (
    <span className="inline-flex items-center">
      <IconButton
        icon={Heart}
        size={20}
        label={liked ? unlikeLabel : likeLabel}
        aria-pressed={liked}
        data-like-state={liked ? 'liked' : 'unliked'}
        onClick={onToggle}
        className={cn(
          '[&_svg]:transition-transform [&_svg]:duration-200',
          liked ? 'text-like [&_svg]:fill-like' : 'text-text',
          pulsing && '[&_svg]:scale-125',
        )}
      />
      {/* Polite, not assertive, and OUTSIDE the button: a screen reader hears the new count without
          the card being re-announced around it (UI-SPEC Motion & Accessibility). */}
      <span aria-live="polite" className="sr-only" data-like-count>
        {countLabel ?? ''}
      </span>
    </span>
  );
}
