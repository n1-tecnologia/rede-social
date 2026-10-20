import { fakeGateway } from './fake';
import type { GatewayProvider } from './types';

/**
 * THE adapter list (09.1-05, D-486): the one place that maps a provider name to the adapter that
 * verifies and normalises its deliveries. A tenant's `payment_integrations.provider` is looked up here
 * (`index.ts#gatewayAdapter`), so a second gateway is a new file next to `fake.ts` plus ONE line below,
 * with no migration: the provider name is data, the set of adapters is code.
 *
 * This file and the real gateway's own adapter file (plan 08) are the only two files in the codebase
 * allowed to name a gateway; `packages/core/tests/payments-neutral.test.ts` greps the neutral layer
 * (tables, columns, queue, jobs, contracts, routes, logs, member-facing strings) for the brand and
 * exempts exactly these two.
 *
 * Plan 08 adds the real gateway's adapter here. `fake` stays registered everywhere: production refuses
 * it through the `PAYMENTS_PROVIDERS` list, not by removing it from the code.
 */
export const ADAPTERS: Readonly<Record<string, GatewayProvider>> = {
  fake: fakeGateway,
};
