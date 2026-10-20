import { env } from '../env';
import { registerJobQueues } from '../jobs/boss';
import { ADAPTERS } from './adapters';
import { type GatewayProvider, PAYMENT_EVENT_QUEUE } from './types';

/**
 * Adapter resolution by INTEGRATION ROW (09.1-05, D-486). Unlike `media/video/index.ts`, nothing here is
 * an env-selected singleton: the route reads the `provider` of the tenant's `payment_integrations` row
 * and asks `gatewayAdapter(provider)`. The environment only keeps a deny list: `PAYMENTS_PROVIDERS`, a
 * comma list of the adapter names this process accepts. Unset means every registered adapter (the local
 * default, so `fake` works with no configuration); production lists exactly the real gateway, so `fake`
 * is refused there and a delivery to a `fake` integration answers 404.
 *
 * Imported as `@rede-social/core/server/payments/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 */

/** The adapter names this process accepts: `raw` (the `PAYMENTS_PROVIDERS` value) intersected with the adapter list. */
export function enabledProviders(raw: string | undefined = env.PAYMENTS_PROVIDERS): string[] {
  const registered = Object.keys(ADAPTERS);
  if (raw === undefined) return registered;
  const listed = new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  return registered.filter((name) => listed.has(name));
}

/**
 * The adapter registered under EXACTLY `name`, or null when there is none or it is not enabled. The match
 * is on the whole name and on the object's OWN keys: `fake2` never resolves to `fake`, and `constructor`
 * or `__proto__` (path segments are attacker-chosen) never resolve to anything.
 */
export function gatewayAdapter(
  name: string,
  raw: string | undefined = env.PAYMENTS_PROVIDERS,
): GatewayProvider | null {
  if (!Object.hasOwn(ADAPTERS, name)) return null;
  if (!enabledProviders(raw).includes(name)) return null;
  return ADAPTERS[name] ?? null;
}

// `kernel.payment-event` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). The webhook route's
// receive service imports this barrel, so the API's lazy `startedBoss()` knows the queue before the
// first `send`; the worker creates it from its explicit job list (plan 07).
registerJobQueues([PAYMENT_EVENT_QUEUE]);

export type { GatewayErrorKind, GatewayProvider, NeutralPaymentEvent } from './types';
export { EFFECT_BY_TYPE, GatewayError, PAYMENT_EVENT_QUEUE } from './types';
