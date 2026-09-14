import type { DomainEventName, EventMap } from '@tria/contracts';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, RequestContext } from '../auth/context';
import { type Logger, moduleLogger } from '../logging';

/**
 * In-process domain event bus (MOD-03 shape, discretion item resolved in 01-07).
 *
 * Two rules make it safe to build on:
 *  1. **Collect, then flush after commit.** `emit` only appends to `ctx.events`; nothing is
 *     delivered until `flush(ctx)` runs, which the response middleware calls once the handler —
 *     and therefore its `withTenantTx` — has returned. A subscriber can never observe a row that
 *     a rollback then erased.
 *  2. **A subscriber never breaks the request.** `flush` awaits handlers sequentially and logs
 *     failures; it does not rethrow. The write already committed, so failing the response would
 *     lie to the client about what happened.
 *
 * Typing comes from `EventMap` in `@tria/contracts`, which each module declaration-merges into.
 * The kernel stays module-agnostic (MOD-02) while every call site is checked.
 */

type AnyHandler = (payload: never) => Promise<void>;

const handlers = new Map<DomainEventName, Set<AnyHandler>>();

/** Fallback for flushes outside a request (tests, jobs); requests pass their own child logger. */
const busLogger = moduleLogger('events');

/** Queue an event on the request context. Delivery happens in `flush`, after the transaction commits. */
export function emit<K extends DomainEventName>(
  ctx: RequestContext,
  name: K,
  payload: EventMap[K],
): void {
  ctx.events.push({
    name,
    payload,
    tenantId: ctx.tenantId,
    occurredAt: new Date().toISOString(),
  });
}

/**
 * Register a handler for an event. Module manifests are wired through the registry at import time
 * (`apps/api/src/modules/registry.ts`). Returns an unsubscribe function — tests use it to keep the
 * process-wide map clean.
 */
export function subscribe<K extends DomainEventName>(
  name: K,
  handler: (payload: EventMap[K]) => Promise<void>,
): () => void {
  const set = handlers.get(name) ?? new Set<AnyHandler>();
  set.add(handler as AnyHandler);
  handlers.set(name, set);
  return () => {
    handlers.get(name)?.delete(handler as AnyHandler);
  };
}

/**
 * Drain `ctx.events` and deliver each record to every subscriber, sequentially. The array is
 * emptied FIRST, so a handler that emits again during the flush cannot spin the loop forever —
 * its events land in the (now empty) array and are picked up by the next iteration.
 *
 * `logger` is the request's child (`requestId`, `tenantId`, `userId`) when called from the
 * middleware, so a failed subscriber is attributable to the request that produced the event.
 */
export async function flush(ctx: RequestContext, logger: Logger = busLogger): Promise<void> {
  const log = logger.child({ name: 'events' });
  while (ctx.events.length > 0) {
    const batch = ctx.events.splice(0, ctx.events.length);
    for (const record of batch) {
      for (const handler of handlers.get(record.name) ?? []) {
        try {
          await (handler as (payload: unknown) => Promise<void>)(record.payload);
        } catch (err) {
          // Never throws: the write already committed; a broken subscriber is an operational
          // problem, not a failed request.
          log.error(
            {
              err,
              event: 'domain_event.handler_failed',
              name: record.name,
              tenantId: ctx.tenantId,
            },
            'domain event handler failed',
          );
        }
      }
    }
  }
}

/**
 * Mount once, right after the logger: `await next()` runs the whole handler chain (including its
 * transaction), and only then are the collected events delivered. It runs in the request's
 * critical path, BEFORE the response is sent — hence the name.
 *
 * Rule 1 is enforced here by construction, not by convention (phase-1 review WR-01): in Hono's
 * `compose()`, an error thrown by the handler is caught at the handler's own dispatch level and
 * turned into a response by `app.onError`, so this middleware's `await next()` resolves NORMALLY.
 * `c.error` is the only signal that the handler failed — and a failed handler means its
 * `withTenantTx` rolled back, so whatever it pushed to `ctx.events` before throwing describes rows
 * that no longer exist. Those events are dropped, never delivered.
 */
export const flushEventsAfterHandler = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const ctx = c.get('ctx');
  if (!ctx) return;
  if (c.error) {
    // Handler failed: nothing committed, so nothing may be announced.
    ctx.events.length = 0;
    return;
  }
  await flush(ctx, c.get('logger') ?? busLogger);
});
