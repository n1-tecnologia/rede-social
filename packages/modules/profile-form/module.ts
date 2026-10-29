import { defineModule } from '@rede-social/core/server/modules/manifest';
import { PROFILE_FORM_PERMISSIONS } from './contracts/index';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **No `nav`**: the module's door is a Configuracoes row, not a shell entry. **No `requires`**: the form
 * works whatever other module is on. The module is OFF by default for every tenant (it is not in
 * `REAL_TENANT_DEFAULT_MODULES`, D-596) and no existing tenant gets a row: turning it on is the
 * super_admin's explicit per-tenant act, because the form can hold members out of the app.
 *
 * **No `routes` yet** (plan 08 adds the admin routes at `/v1/profile_form`). **No tables or jobs of its
 * own** (D-501 split): the tables and the services are KERNEL code, because the gate reads them on every
 * request.
 *
 * **`profile_form.manage` is admin-only BY CONSTRUCTION** (the payments and store rule): composed for
 * `admin_tenant` only, since the database authorises the builder by the `admin_tenant` claim. Composing it
 * for another role would make that role's writes fail under RLS; `apps/api/tests/unit/registry.test.ts`
 * (case 22) fails first. `profile_form.read` is composed for `admin_tenant` and `support_tenant`; a
 * `member` never gets either.
 */
export const profileFormModule = defineModule({
  key: 'profile_form',
  defaultRolePermissions: {
    admin_tenant: [PROFILE_FORM_PERMISSIONS.manage, PROFILE_FORM_PERMISSIONS.read],
    support_tenant: [PROFILE_FORM_PERMISSIONS.read],
  },
});
