'use client';

import { cn, IconButton, useMediaQuery } from '@rede-social/ui';
import { Heart } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  /**
   * 2026-10-09: the host's version of the seed. A NEW value re-syncs the local state even when the
   * pair is the one given before: a host that learned the pair from another surface (the Reels
   * overlay over the feed) may hand back exactly the seed this card started from while its own
   * optimistic state has moved away from it. Absent, only a changed pair re-syncs.
   */
  revision?: number;
  onToggle: LikeToggle;
  /**
   * Raised once per failed toggle, after the revert — the host shows the generic error toast.
   * 08.2-09 (UI-D-376): `code` is the refusal's code when the toggle rejected with one (the card
   * rejects with the action's `code`, e.g. `community_locked`); absent for a plain failure.
   */
  onError?: (code?: string) => void;
};

/** The `code` a rejected toggle carried, when it carried a string one. */
function refusalCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

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
  revision,
  onToggle,
  onError,
}: UseOptimisticLikeOptions): UseOptimisticLikeResult {
  const [state, setState] = useState<LikeState>({ liked, likeCount });
  const [pulseKey, setPulseKey] = useState(0);

  // Re-seed from the props when the SERVER sends a different pair (pull-to-refresh replaced the
  // list), or when the host bumps its revision. Adjusting state during render is React's documented
  // alternative to an effect and keeps the card and its seed in lockstep without painting the
  // previous value first.
  const [seed, setSeed] = useState({ liked, likeCount, revision });
  if (seed.liked !== liked || seed.likeCount !== likeCount || seed.revision !== revision) {
    setSeed({ liked, likeCount, revision });
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
      } catch (error) {
        if (requestId.current !== id) return;
        currentRef.current = previous;
        setState(previous);
        onError?.(refusalCode(error));
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
  /**
   * `'default'` (the feed card and the story viewer) renders exactly as before. `'overMedia'` is
   * for a surface that draws the button straight on video (the Reels rail, D-124): see the tone
   * note on `LikeButton`.
   */
  tone?: LikeButtonTone;
  /** The heart's size in px (default 20; the Reels rail passes 28, UI-D-87). */
  glyphSize?: number;
};

export type LikeButtonTone = 'default' | 'overMedia';

/** How long the pop lasts. Short enough to be over before a second tap can land. */
const PULSE_MS = 220;

/**
 * The colour classes per tone. The `default` entry is the pre-D-124 class list, byte for byte.
 *
 * **Why `overMedia` exists (D-124).** On video the default tone's `text-text` idle stroke is the
 * theme's ink (dark in the light theme) and the `hover:bg-bg-hover` disc is a grey blot on the
 * frame. The over-media tone is a white stroke idle, the like colour liked, the story caption's
 * drop shadow on the glyph, a translucent white hover and the white focus ring every control over
 * video carries (UI-D-97).
 *
 * **Why it is a tone and not a wrapper override.** The story viewer paints its like white with a
 * descendant override on a wrapper (`[&_button]:text-white`). That override has higher specificity
 * than the button's own classes, so it would repaint a LIKED heart white too and lose the like
 * colour (UI-D-08) — the story surface lives with it, the Reels rail must not. The tone sets the
 * idle and liked colours on the button itself, so nothing outside has to fight it.
 */
const TONE: Record<LikeButtonTone, { idle: string; liked: string; extra?: string }> = {
  default: { idle: 'text-text', liked: 'text-like [&_svg]:fill-like' },
  overMedia: {
    idle: 'text-white',
    liked: 'text-like [&_svg]:fill-like',
    extra:
      '[&_svg]:drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] hover:bg-white/10 active:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-0',
  },
};

export function LikeButton({
  liked,
  countLabel,
  likeLabel,
  unlikeLabel,
  pulseKey,
  onToggle,
  tone = 'default',
  glyphSize = 20,
}: LikeButtonProps) {
  const colours = TONE[tone];
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [pulsing, setPulsing] = useState(false);
  const [seenPulse, setSeenPulse] = useState(pulseKey);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 08.2-12: the pulse timer dies with the button, so an unmount inside the 220 ms never sets
  // state on a gone component (it surfaced as a teardown error in a unit run of the gate).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

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
        size={glyphSize}
        label={liked ? unlikeLabel : likeLabel}
        aria-pressed={liked}
        data-like-state={liked ? 'liked' : 'unliked'}
        onClick={onToggle}
        className={cn(
          '[&_svg]:transition-transform [&_svg]:duration-200',
          liked ? colours.liked : colours.idle,
          colours.extra,
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
