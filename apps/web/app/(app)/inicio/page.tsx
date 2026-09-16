import { resolveBranding } from '@tria/contracts';
import { HomeSlots, TenantLogo } from '@tria/core/ui';
import { EmptyState } from '@tria/ui';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { homeSlotsFor } from '@/lib/registry';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/inicio` — the kernel home (D-42, amends D-07): the branded welcome (logo as-is + "Bem-vindo(a) à
 * {tenant}") and the home slots the tenant's ENABLED modules registered, or the "Em breve" card when
 * there is none. Server-rendered from the bootstrap (deduped with the layout by React `cache`), so
 * there is no client loading state for the brand or the widgets.
 *
 * On the platform host it renders the D-21 landing (02-12 owns the panel at `/plataforma`).
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
      <div className="flex flex-col gap-4 px-4 md:px-0">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-text">{tp('title')}</h1>
        <p className="text-sm text-text-secondary">{tp('placeholder')}</p>
        {email ? <p className="text-sm text-text-secondary">{email}</p> : null}

        <section aria-labelledby="tenants-heading" className="flex flex-col gap-2">
          <h2 id="tenants-heading" className="text-base font-bold text-text">
            {tp('tenants')}
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-text">
            {platform.tenants.map((tenant) => (
              <li key={tenant.id}>
                {tenant.slug} — {tenant.displayName} (
                {tp('modulesCount', { count: tenant.enabledModules.length })})
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  const bootstrap = await requireBootstrap();
  const { tenant } = bootstrap;
  const branding = resolveBranding(tenant.branding);
  const slots = await homeSlotsFor(bootstrap);

  return (
    <div className="flex flex-col gap-6 px-4 md:px-0">
      <div className="flex flex-col items-center gap-4">
        <TenantLogo
          logoUrl={branding.logoUrl}
          displayName={tenant.displayName}
          size="home"
          className="mx-auto mt-8"
        />
        <h1 className="text-center text-2xl font-bold tracking-[-0.02em] text-text">
          {t('home.welcome', { tenant: tenant.displayName })}
        </h1>
      </div>

      <HomeSlots
        slots={slots}
        empty={
          <EmptyState
            variant="card"
            icon={Sparkles}
            title={t('home.soonTitle')}
            body={t('home.soonBody')}
          />
        }
      />
    </div>
  );
}
