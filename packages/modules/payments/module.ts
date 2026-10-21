import { defineModule } from '@rede-social/core/server/modules/manifest';
import { PAYMENTS_PERMISSIONS } from './contracts/index';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **No `nav`** (UI-D-513): the module's door is a row of Configuracoes, not a shell entry, so it never
 * competes for a tab or a top-bar slot. **No `requires`** (UI-D-527): a tenant with the store off can
 * still gate its door, and one with the gate off can still map store products. The module is OFF by
 * default for every tenant (it is not in `REAL_TENANT_DEFAULT_MODULES`).
 *
 * **No tables of its own, no jobs of its own** (D-501): the tables (`access_grants`,
 * `payment_integrations`, `payment_products`, `payment_events`), the webhook ingestion and the apply job
 * are KERNEL code, because the access gate is read by `requireAuth` on every request and the ingestion
 * is unauthenticated. The one thing the module contributes to the kernel is the hourly prune of the
 * event inbox, `sweepFunctions: ['payment_events_prune']`.
 *
 * **`payments.manage` is admin-only BY CONSTRUCTION** (the store's WR-03 rule). The routes authorise by
 * this permission, but the database authorises the setup by the `admin_tenant` claim: the
 * `payment_products` policies, and the settings and integration writes the kernel services make for an
 * `admin_tenant` caller. The two agree only while the permission is composed for `admin_tenant` and
 * nobody else; composing it for another role (through settings or any other path) would make that
 * role's reads and writes fail under RLS. Widen the SQL in the same change, or do not compose it
 * elsewhere: `apps/api/tests/unit/registry.test.ts` (case 20) fails first.
 */
export const paymentsModule = defineModule({
  key: 'payments',
  routes: () => import('./server/routes').then((m) => m.paymentsRoutes),
  defaultRolePermissions: {
    admin_tenant: [PAYMENTS_PERMISSIONS.manage],
  },
  sweepFunctions: ['payment_events_prune'],
});
