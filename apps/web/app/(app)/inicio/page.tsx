import { getTranslations } from 'next-intl/server';
import { getBootstrap } from '@/lib/bootstrap';
import { getPlatformTenants } from '@/lib/platform';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';

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
      getPlatformTenants(),
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

  const bootstrap = await getBootstrap();
  const { user, membership, tenant, modules } = bootstrap;

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
    </>
  );
}
