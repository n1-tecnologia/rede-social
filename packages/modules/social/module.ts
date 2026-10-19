import { defineModule } from '@rede-social/core/server/modules/manifest';
import { SOCIAL_PERMISSIONS } from './contracts/index';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **D-482: `social` is the ONE switch for member authoring.** Turning it on for a tenant makes the
 * members of that tenant authors (`feed.post.create`, `feed.post.manage`) and lets them take part in
 * the follow graph (`social.participate`); turning it off, or turning `feed` off, removes all of it.
 * It replaces the old per-tenant posting-policy value on the `feed` settings, which the registry no
 * longer reads. It is OFF by default for every tenant: it is not in `REAL_TENANT_DEFAULT_MODULES`
 * and no migration backfills a row (a missing row reads as disabled, SOCIAL-01).
 *
 * `requires: ['feed']` (D-121): while the tenant's `feed` flag is off this module contributes
 * nothing, no bootstrap entry and no permission, even with its own flag on (`effectiveKeys` in
 * `apps/api/src/modules/registry.ts`). It is the first module with BOTH routes (plan 02) and
 * `requires`, so its routes chain `requireModule('feed')` beside `requireModule('social')`.
 *
 * No `nav` (D-479 adds no tab: the Explorar chip lives in the web's Inicio), no `home` slot, no jobs
 * and no notification sources of its own. `routes` is omitted rather than set to a loader that points
 * at a file that does not exist yet; plan 02 adds it with the first route file.
 *
 * `defaultRolePermissions`: only `member` holds `social.participate`. **It is member-only BY
 * CONSTRUCTION** (see `SOCIAL_PERMISSIONS`): the routes authorise by the permission, the database by
 * the member role, and the two agree only while it is composed for that role and nobody else.
 *
 * The member authoring permissions `feed.post.create` / `feed.post.manage` are NOT named here: they
 * are composed by the app-tier registry when `social` is effective, because naming a feed permission
 * from this package would be a module-to-module edge, which `pnpm boundaries` denies (MOD-02).
 */
export const socialModule = defineModule({
  key: 'social',
  requires: ['feed'],
  defaultRolePermissions: {
    member: [SOCIAL_PERMISSIONS.participate],
  },
});
