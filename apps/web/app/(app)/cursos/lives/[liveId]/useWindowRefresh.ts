'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * The live page's ONE refresh timer (08.5-09, UI-D-436, D-432, planning decision 3).
 *
 * The page never decides a state with the browser clock: the server answered `state`, `joinUrl` and
 * `serverNow`, and this timer only asks it again when the next edge of the window passes. The delay
 * is measured from the SERVER's `serverNow`, never from `Date.now()`, so a phone whose clock is
 * wrong still refreshes at the right moment (T-08.5-32): the browser's own timer only counts the
 * elapsed milliseconds.
 *
 * The edges, in order: `joinOpensAt` (the link appears), `startsAt` (the pill turns "Ao vivo agora"
 * and the helper stops saying "Você já pode entrar"), `endsAt` (the link leaves). The next edge
 * strictly after `serverNow` wins; a one-second grace makes the refreshed read land past it, since
 * the window is half-open at the server (open AT `joinOpensAt`, closed AT `endsAt`).
 */

/** The longest single wait: a live a week away refreshes once a day and re-arms from the answer. */
export const WINDOW_REFRESH_MAX_MS = 24 * 60 * 60 * 1000;

/** The margin past the edge, so the refreshed read is on the far side of it. */
export const WINDOW_REFRESH_GRACE_MS = 1000;

export interface WindowRefreshInput {
  joinOpensAt: string;
  /** Optional: the start edge (the on-air pill and the join helper change there). */
  startsAt?: string;
  endsAt: string;
  serverNow: string;
}

/**
 * Milliseconds until the page should refresh, or `null` when every edge already passed (nothing to
 * wait for: the server's next answer is final for this page). Pure: `serverNow` is a parameter.
 */
export function windowRefreshDelay(input: WindowRefreshInput): number | null {
  const now = Date.parse(input.serverNow);
  if (!Number.isFinite(now)) return null;
  const edges = [input.joinOpensAt, input.startsAt, input.endsAt]
    .filter((edge): edge is string => typeof edge === 'string')
    .map((edge) => Date.parse(edge))
    .filter((edge) => Number.isFinite(edge) && edge > now)
    .sort((a, b) => a - b);
  const next = edges[0];
  if (next === undefined) return null;
  return Math.min(next - now + WINDOW_REFRESH_GRACE_MS, WINDOW_REFRESH_MAX_MS);
}

/**
 * Schedules `router.refresh()` at the next window edge. `null` input (the page's state needs no
 * timer: cancelled, locked, replay, ended) schedules nothing. A refresh brings a new `serverNow`, so
 * the effect re-arms from the server's new answer.
 */
export function useWindowRefresh(input: WindowRefreshInput | null): void {
  const router = useRouter();
  const joinOpensAt = input?.joinOpensAt;
  const startsAt = input?.startsAt;
  const endsAt = input?.endsAt;
  const serverNow = input?.serverNow;

  useEffect(() => {
    if (joinOpensAt === undefined || endsAt === undefined || serverNow === undefined) return;
    const delay = windowRefreshDelay({ joinOpensAt, startsAt, endsAt, serverNow });
    if (delay === null) return;
    const timer = setTimeout(() => router.refresh(), delay);
    return () => clearTimeout(timer);
  }, [router, joinOpensAt, startsAt, endsAt, serverNow]);
}

/** The client island that mounts the timer inside a server page. */
export function WindowRefresh({ input }: { input: WindowRefreshInput | null }) {
  useWindowRefresh(input);
  return null;
}
