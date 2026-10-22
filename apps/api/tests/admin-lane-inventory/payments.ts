import type { AdminLaneEntry, SiteClass } from './index';

/** The payments area (`packages/core/server/payments/*`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [fn: string, cls: SiteClass, plan: number, note?: string])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note]) => ({
    file,
    fn,
    class: cls,
    status: 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const payments: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/payments/access.ts', [
    ['listAccesses', 'T', 5],
    ['releaseEmail', 'T', 5],
    ['blockEmail', 'T', 5],
    ['unblockEmail', 'T', 5],
    ['removeRelease', 'T', 5],
  ]),
  ...group('packages/core/server/payments/apply.ts', [
    ['markFailed', 'T', 5],
    ['applyPaymentEvent', 'T', 5],
  ]),
  ...group('packages/core/server/payments/events.ts', [
    ['listEvents', 'T', 5],
    ['readItem', 'T', 5],
    ['grantEventManually', 'T', 5],
    ['grantEventManually', 'T', 5],
  ]),
  ...group('packages/core/server/payments/gate.ts', [
    ['previewGate', 'T', 5],
    ['setGate', 'T', 5],
  ]),
  ...group('packages/core/server/payments/inbox.ts', [['recordPaymentEvent', 'N', 10]]),
  ...group('packages/core/server/payments/receive.ts', [['receivePaymentWebhook', 'N', 10]]),
  ...group('packages/core/server/payments/setup.ts', [
    ['readIntegration', 'T', 5],
    ['saveIntegration', 'T', 5],
  ]),
  ...group('packages/core/server/payments/status.ts', [['getSubscriptionStatus', 'T', 5]]),
];
