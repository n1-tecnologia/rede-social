'use client';

import { useTranslations } from 'next-intl';
import {
  type CountdownT,
  type CountdownTarget,
  countdownBlocks,
  countdownLead,
  countdownParts,
  countdownShort,
  countdownSpoken,
} from '@/lib/event-countdown';
import { useCountdownClock } from './useCountdownClock';

/** Where a `text` count is drawn; the cells of the `blocks` variant only ever live in the zone. */
export type LiveCountdownSurface = 'zone' | 'poster' | 'hero' | 'reine';

export interface LiveCountdownProps {
  /** The instant counted to: the opening (`kind` `opening`) or the start of the event (`event`). */
  targetIso: string;
  /** The server's own instant taken when the page rendered; null for an older API (no count, no tick). */
  seedIso: string | null;
  kind: CountdownTarget;
  /** `blocks`: the zone's cells; `text`: the short count of the card, the hero and `Meus eventos`. */
  variant: 'blocks' | 'text';
  surface?: LiveCountdownSurface;
  /** `text`, `opening`: the reference price that precedes the count on the poster (D-786). */
  price?: string | null;
  /** `text`, `event`, hero: the finished static right part of the overline (`seg., 12 de out.`). */
  when?: string | null;
  /** `text`, `event`: the word at zero; defaults to the shipped `Acontecendo agora`. */
  liveLabel?: string | null;
  /** `text`: `timer` wraps the text in a `role="timer"`, `none` leaves it plain (a card inside a link). */
  announce?: 'timer' | 'none';
  /** `text`: what to draw when there is no seed (the static line a caller already has), else nothing. */
  fallback?: string | null;
}

/**
 * The live count of Phase 10.2 (D-785, D-786, D-787, D-788, OPEN-08, OPEN-10, OPEN-21).
 *
 * **Hydration-safe and server-seeded.** The remaining time comes from `useCountdownClock`, whose FIRST
 * render is `target minus seed` from the props alone, so the server string and the first client render
 * are identical; afterwards it follows ONE `setTimeout` per instance aimed at the next minute change,
 * recomputed from the server clock. No interval, and this file never reads the device clock: with no
 * seed there is no count and no tick, and nothing falls back to the device (a wrong clock must not show
 * a wrong count).
 *
 * **Never a link, never a state.** At zero the `blocks` variant says `Abrindo agora` and nothing else
 * changes; the buy control comes only from the server's answer through the boundary refresh (D-789).
 * The component owns that word because the pure formatter renders nothing at zero.
 *
 * **Silent by design (UI-D-787).** The visible cells are `aria-hidden`; a visually hidden `role="timer"`
 * sibling holds the current spoken value and changes without announcing. It is NEVER inside a polite
 * live region (the caller puts it outside the wrapper), so a changing digit is not spoken every minute.
 * No animation exists: digits change in place. Every string is a catalog fragment or a React text node.
 */
export function LiveCountdown({
  targetIso,
  seedIso,
  kind,
  variant,
  surface = variant === 'blocks' ? 'zone' : 'poster',
  price = null,
  when = null,
  liveLabel = null,
  announce = 'timer',
  fallback = null,
}: LiveCountdownProps) {
  const t = useTranslations('events') as unknown as CountdownT;
  const { remainingMs } = useCountdownClock(targetIso, seedIso);

  if (remainingMs === null) {
    return variant === 'text' && fallback ? <span>{fallback}</span> : null;
  }

  if (variant === 'text') {
    const text = countdownText(t, { kind, surface, remainingMs, price, when, liveLabel });
    return announce === 'timer' ? (
      <span role="timer" data-testid="live-countdown-text">
        {text}
      </span>
    ) : (
      <span data-testid="live-countdown-text">{text}</span>
    );
  }

  const parts = countdownParts(remainingMs);
  const opening = t('ticket.soon.opening');
  const cells = countdownBlocks(t, remainingMs);
  const spoken = parts.state === 'now' ? opening : countdownSpoken(t, remainingMs, kind) || opening;

  return (
    <>
      <div aria-hidden="true" data-testid="live-countdown-cells" className="flex gap-2">
        {parts.state === 'now' ? (
          <WideCell>{opening}</WideCell>
        ) : parts.state === 'lessThanMinute' ? (
          <WideCell>{cells[0]?.label ?? ''}</WideCell>
        ) : (
          cells.map((cell) => (
            <div
              key={cell.label}
              data-testid="live-countdown-cell"
              className="flex min-w-0 flex-1 flex-col items-center rounded-xl bg-bg-tertiary px-2 py-4 text-center"
            >
              <span className="text-2xl font-bold tabular-nums text-text">{cell.value}</span>
              <span className="text-xs text-text-tertiary">{cell.label}</span>
            </div>
          ))
        )}
      </div>
      <span role="timer" className="sr-only" data-testid="live-countdown-timer">
        {spoken}
      </span>
    </>
  );
}

/** The single full-width cell: `Menos de 1 min` in the last minute and `Abrindo agora` at zero. */
function WideCell({ children }: { children: string }) {
  return (
    <div
      data-testid="live-countdown-cell"
      className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-bg-tertiary px-2 py-4 text-center text-base font-bold text-text"
    >
      {children}
    </div>
  );
}

/**
 * The short text of a surface, built from the same keys the server view uses (`events-view.ts`), so a
 * card's first client render is the string the server drew:
 * - `opening`: `Abre em 2 d 4 h 13 min`, `Abre em menos de 1 min`, `Abrindo agora`, with the price first;
 * - `event`: `Faltam 12 d 4 h 13 min` / `Falta 1 h` (the singular by ICU select), `Falta menos de 1 min`,
 *   the `Meus eventos` scope on the `reine` surface, the hero's `{until} · {when}`, and the live word at
 *   zero.
 */
function countdownText(
  t: CountdownT,
  input: {
    kind: CountdownTarget;
    surface: LiveCountdownSurface;
    remainingMs: number;
    price: string | null;
    when: string | null;
    liveLabel: string | null;
  },
): string {
  const { kind, surface, remainingMs, price, when, liveLabel } = input;
  const state = countdownParts(remainingMs).state;

  if (kind === 'opening') {
    const note =
      state === 'now'
        ? t('ticket.soon.opening')
        : state === 'lessThanMinute'
          ? t('card.soonNoteLessThanMinute')
          : t('card.soonNote', { time: countdownShort(t, remainingMs) });
    return price ? t('card.priceNote', { price, note }) : note;
  }

  if (state === 'now') return liveLabel ?? t(surface === 'hero' ? 'hero.live' : 'card.live');
  const scope = surface === 'reine' ? 'reine.mine' : 'card';
  const until =
    state === 'lessThanMinute'
      ? t(`${scope}.untilLessThanMinute`)
      : t(`${scope}.until`, {
          lead: countdownLead(remainingMs),
          time: countdownShort(t, remainingMs),
        });
  return surface === 'hero' && when ? t('hero.until', { until, when }) : until;
}
