import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';

/**
 * The shell's badge counters (D-40, RESEARCH Pattern 13): `bootstrap.counters`, composed from every
 * EFFECTIVE module's manifest `counters` (the app registry's `countersFor`). The kernel owns the
 * shape and the zero default; which module feeds which key is the app tier's composition (MOD-02).
 * 07-08 widens it for the chat badge style.
 */
export type Counters = { unreadNotifications: number; unreadConversations: number };

export const ZERO_COUNTERS: Counters = { unreadNotifications: 0, unreadConversations: 0 };

export type CountersResolver = (tx: Tx, ctx: RequestContext) => Promise<Counters>;

let resolver: CountersResolver | null = null;

/** Called once, at import time, by the app registry. Last registration wins (tests). */
export function setCountersResolver(fn: CountersResolver): void {
  resolver = fn;
}

/**
 * The composed counters inside the caller's tenant-lane transaction, or zeros when no resolver is
 * registered (a counter is a hint, never an authority: failing closed to zero is the safe default).
 */
export async function resolveCounters(tx: Tx, ctx: RequestContext): Promise<Counters> {
  if (!resolver) return { ...ZERO_COUNTERS };
  return resolver(tx, ctx);
}
