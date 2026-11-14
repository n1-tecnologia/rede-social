'use client';

import type { CountdownDescriptor } from '@/lib/events-view';
import { LiveCountdown, type LiveCountdownSurface } from './LiveCountdown';

/**
 * The plain descriptor a view model hands over (`EventCardCountdown`, `EventHeroCountdown`, the holder's
 * `eventHolderCountdown`): which sentence it frames, the target and the server seed, plus the optional
 * price (the opening on a poster) or the finished static right part (`when`, the hero's overline).
 */
export type EventLiveNoteDescriptor = CountdownDescriptor & {
  price?: string | null;
  when?: string | null;
};

export interface EventLiveNoteProps {
  /** The finished static note the server drew: what shows with no descriptor and with no seed. */
  note: string;
  /** The descriptor of the count the note carries; absent draws the static note and arms no timer. */
  countdown?: EventLiveNoteDescriptor | null;
  /** Where the note sits: the poster card, the hero overline or the `Meus eventos` card (`reine`). */
  surface: Exclude<LiveCountdownSurface, 'zone'>;
  /** The word at zero of a holder's count; defaults to the shipped `Acontecendo agora`. */
  liveLabel?: string | null;
  /**
   * `timer` wraps the count in a `role="timer"`; `none` leaves it plain. The default follows the surface:
   * a poster card is ONE link whose accessible name is static, so its count is plain text (a card never
   * speaks a count); the hero and `Meus eventos` carry the silent timer.
   */
  announce?: 'timer' | 'none';
}

/**
 * The host island that draws a card, hero or `Meus eventos` note live from its descriptor (Phase 10.2,
 * D-785, D-786, D-790, OPEN-07, OPEN-20). It is the `text` variant of the one live count
 * (`LiveCountdown`), so the first client render is the string the server drew and afterwards ONE seeded
 * timeout follows the minute change; with no descriptor, or no seed, it draws the finished static `note`
 * and arms nothing. The module UI packages stay props-only: the host passes this island as their node.
 *
 * It holds no logic that decides access and never reads the device clock (`LiveCountdown` goes through the
 * seeded clock only).
 */
export function EventLiveNote({
  note,
  countdown,
  surface,
  liveLabel = null,
  announce,
}: EventLiveNoteProps) {
  if (!countdown) return <>{note}</>;
  return (
    <LiveCountdown
      variant="text"
      kind={countdown.kind}
      targetIso={countdown.targetIso}
      seedIso={countdown.seedIso}
      surface={surface}
      price={countdown.price ?? null}
      when={countdown.when ?? null}
      liveLabel={liveLabel}
      announce={announce ?? (surface === 'poster' ? 'none' : 'timer')}
      fallback={note}
    />
  );
}
