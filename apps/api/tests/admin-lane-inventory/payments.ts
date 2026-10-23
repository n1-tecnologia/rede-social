import type { AdminLaneEntry, SiteClass, SiteStatus } from './index';

/** The payments area (`packages/core/server/payments/*`). One row per site, in site order. */
const group = (
  file: string,
  rows: readonly (readonly [
    fn: string,
    cls: SiteClass,
    plan: number,
    note?: string,
    status?: SiteStatus,
  ])[],
): AdminLaneEntry[] =>
  rows.map(([fn, cls, plan, note, status]) => ({
    file,
    fn,
    class: cls,
    status: status ?? 'pending',
    plan,
    ...(note ? { note } : {}),
  }));

export const payments: readonly AdminLaneEntry[] = [
  ...group('packages/core/server/payments/access.ts', [
    ['listAccesses', 'T', 5, undefined, 'migrated'],
    ['releaseEmail', 'T', 5, undefined, 'migrated'],
    ['blockEmail', 'T', 5, undefined, 'migrated'],
    ['unblockEmail', 'T', 5, undefined, 'migrated'],
    ['removeRelease', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/payments/apply.ts', [
    ['markFailed', 'T', 5, undefined, 'migrated'],
    [
      'applyPaymentEvent',
      'L',
      10,
      'the job payload is the event id alone, so the site opens the project whose queue delivered the job (the event was recorded there); the tenant still comes from the stored row',
      'migrated',
    ],
  ]),
  ...group('packages/core/server/payments/events.ts', [
    ['listEvents', 'T', 5, undefined, 'migrated'],
    ['readItem', 'T', 5, undefined, 'migrated'],
    ['grantEventManually', 'T', 5, undefined, 'migrated'],
    ['grantEventManually', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/payments/gate.ts', [
    ['previewGate', 'T', 5, undefined, 'migrated'],
    ['setGate', 'T', 5, undefined, 'migrated'],
  ]),
  ...group('packages/core/server/payments/inbox.ts', [
    [
      'recordPaymentEvent',
      'N',
      10,
      'tenant from the integration the route index resolved',
      'migrated',
    ],
  ]),
  ...group('packages/core/server/payments/receive.ts', [
    [
      'receivePaymentWebhook',
      'N',
      10,
      'tenant resolved through platform.payment_integration_routes first',
      'migrated',
    ],
  ]),
  ...group('packages/core/server/payments/setup.ts', [
    ['readIntegration', 'T', 5, undefined, 'migrated'],
    ['saveIntegration', 'T', 5, undefined, 'migrated'],
    ['saveIntegration', 'T', 10, 'the write after the central route was reserved', 'migrated'],
    ['releaseOrphanIntegrationRoute', 'T', 10, 'compensation read', 'migrated'],
  ]),
  ...group('packages/core/server/payments/status.ts', [
    ['getSubscriptionStatus', 'T', 5, undefined, 'migrated'],
  ]),
];
