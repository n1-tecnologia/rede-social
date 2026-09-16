import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { exampleProcessJob } from './server/jobs';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-example');

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * `routes` is a lazy import so the manifest itself stays cheap to load (the worker reads `jobs`
 * without ever building the HTTP router). The mount in `apps/api/src/app.ts` uses the eager export
 * for the chained `AppType`; both point at the same router.
 */
export const exampleModule = defineModule({
  key: 'example',
  nav: { label: 'Exemplo', icon: 'sparkles', href: '/inicio#exemplo', order: 90 },
  // D-42: one home slot on /inicio; `apps/web/lib/registry.tsx` maps `example` → home[0] to the widget.
  home: [{ order: 90 }],
  routes: () => import('./server/routes').then((m) => m.exampleRoutes),
  jobs: [exampleProcessJob],
  events: [
    {
      event: 'example.item.created',
      handler: async (payload) => {
        log.info({ event: 'example.item.created', ...payload }, 'example item created');
      },
    },
  ],
  // Unioned onto the role's kernel permissions by `permissionsFor`, and revoked with the flag.
  defaultRolePermissions: { admin_tenant: ['example.create'] },
});
