import { defineModule } from '@rede-social/core/server/modules/manifest';
import { STORE_PERMISSIONS } from './contracts/index';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **D-350 / UI-D-366: Loja is a TOP-BAR entry at order 5**, before Notificações (10) and Suporte
 * (20). `shopping-bag` joins `ICONS` in `packages/core/ui/nav.ts` with the screens (plan 07); until
 * then an unknown icon name falls back to the kernel's default glyph. The entry is driven by the
 * module FLAG (D-77), and `store` is OFF by default for every tenant (STORE-01: it is not in
 * `REAL_TENANT_DEFAULT_MODULES`, and no migration backfills a row for it).
 *
 * No `requires`: a store with communities off still sells products that open none. No jobs and no
 * notification sources in 08.2.
 *
 * `defaultRolePermissions`: only `admin_tenant` manages products (D-338). Buying takes no permission
 * (RESEARCH Assumption A10): every role may buy, and the screens decide what staff see.
 */
export const storeModule = defineModule({
  key: 'store',
  nav: { placement: 'topbar', label: 'Loja', icon: 'shopping-bag', href: '/loja', order: 5 },
  routes: () => import('./server/routes').then((m) => m.storeRoutes),
  defaultRolePermissions: {
    admin_tenant: [STORE_PERMISSIONS.manage],
  },
});
