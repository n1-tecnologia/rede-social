import { exampleItemsSchema } from '@tria/module-example/contracts';
import { ExampleWidget } from '@tria/module-example/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';
import { createExampleItem } from './example-actions';

/**
 * The module's data, fetched only when the tenant HAS the module (D-19). An enabled key in
 * `bootstrap.modules` is the single source of truth here: the page never hardcodes "example
 * exists", so a tenant without the flag renders nothing and makes no request.
 */
async function getExampleItems() {
  const res = await apiFetch('/v1/example/items');
  if (!res.ok) return [];
  return exampleItemsSchema.parse(await res.json()).items;
}

/**
 * `/inicio` placeholder (D-07): tenant name, who you are, your role and the enabled modules from
 * `/v1/me/bootstrap` (deduped with the layout by React `cache`). Phase 2 replaces it with `/feed`
 * inside the branded shell; 01-06 fills `modules`; 01-07 mounts the example widget here.
 * On the platform host it renders the D-21 placeholder (01-06 replaces the body with the tenant list).
 */
export default async function InicioPage() {
  const [hostTenant, t, tp] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    getTranslations('platform'),
  ]);

  if (hostTenant.mode === 'platform') {
    const supabase = await createClient();
    const [{ data }, platform] = await Promise.all([
      supabase.auth.getClaims(),
      // Deduped with the layout by React `cache`: the layout already proved this session may read it.
      requirePlatformTenants(),
    ]);
    const email = typeof data?.claims.email === 'string' ? data.claims.email : null;
    return (
      <>
        <h1>{tp('title')}</h1>
        <p>{tp('placeholder')}</p>
        {email ? <p>{email}</p> : null}

        <section aria-labelledby="tenants-heading">
          <h2 id="tenants-heading">{tp('tenants')}</h2>
          <ul>
            {platform.tenants.map((tenant) => (
              <li key={tenant.id}>
                {tenant.slug} — {tenant.displayName} (
                {tp('modulesCount', { count: tenant.enabledModules.length })})
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  }

  const bootstrap = await requireBootstrap();
  const { user, membership, tenant, modules, permissions } = bootstrap;

  // 01-07: the throwaway reference module's widget (D-19). Phase 4 removes these three lines with
  // the package. `canCreate` comes from the bootstrap permissions, which already account for the
  // role AND the flag — the API re-checks it on every write regardless.
  const hasExample = modules.some((m) => m.key === 'example');
  const exampleItems = hasExample ? await getExampleItems() : [];
  const te = await getTranslations('example');

  return (
    <>
      <h1>{tenant.displayName}</h1>
      <p>
        {user.name} — {user.email}
      </p>
      <p>{t(`role.${membership.role}`)}</p>

      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading">{t('modules')}</h2>
        {modules.length === 0 ? (
          <p>{t('none')}</p>
        ) : (
          <ul>
            {modules.map((m) => (
              <li key={m.key}>{m.nav?.label ?? m.key}</li>
            ))}
          </ul>
        )}
      </section>

      {hasExample ? (
        <ExampleWidget
          items={exampleItems}
          canCreate={permissions.includes('example.create')}
          createAction={createExampleItem}
          labels={{
            title: te('title'),
            empty: te('empty'),
            add: te('add'),
            placeholder: te('placeholder'),
            processed: te('processed'),
          }}
        />
      ) : null}
    </>
  );
}
