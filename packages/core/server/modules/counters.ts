import type { RequestContext } from '../auth/context';

/**
 * The shell's badge counters (D-40, RESEARCH Pattern 13): `bootstrap.counters`, composed from every
 * EFFECTIVE module's manifest `counters` (the app registry's `countersFor`). The kernel owns the
 * shape and the zero default; which module feeds which key is the app tier's composition (MOD-02).
 *
 * 07-08: `conversationsBadge` is how the chat slot draws `unreadConversations`: a `dot` for a member
 * ("the team answered", D-237) or a `count` for staff (threads awaiting the team, D-238). The chat
 * module decides it from the caller's PERMISSIONS; with chat off (or on the platform host) it stays
 * the default `count` over a zero, which draws nothing.
 */
export type Counters = {
  unreadNotifications: number;
  unreadConversations: number;
  conversationsBadge: 'dot' | 'count';
};

export const ZERO_COUNTERS: Counters = {
  unreadNotifications: 0,
  unreadConversations: 0,
  conversationsBadge: 'count',
};

/**
 * Resolves the caller's counters, opening its OWN tenant-lane transaction (07 review A-WR-03): the
 * resolver reads the module flags first, and a flags-cache miss needs a pooled connection of its own,
 * so a caller must never hand it an already-open transaction.
 */
export type CountersResolver = (ctx: RequestContext) => Promise<Counters>;

let resolver: CountersResolver | null = null;

/** Called once, at import time, by the app registry. Last registration wins (tests). */
export function setCountersResolver(fn: CountersResolver): void {
  resolver = fn;
}

/**
 * The caller's composed counters in their own tenant-lane transaction, or zeros when no resolver is
 * registered (a counter is a hint, never an authority: failing closed to zero is the safe default).
 * Call it OUTSIDE any open transaction (A-WR-03).
 */
export async function resolveCounters(ctx: RequestContext): Promise<Counters> {
  if (!resolver) return { ...ZERO_COUNTERS };
  return resolver(ctx);
}
