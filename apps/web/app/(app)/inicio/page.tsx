import { resolveBranding } from '@rede-social/contracts';
import { HomeSlots, TenantLogo } from '@rede-social/core/ui';
import { EmptyState } from '@rede-social/ui';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { NoticeToast } from '@/components/feedback/NoticeToast';
import { ProfileNudgeCard } from '@/components/profile/ProfileNudgeCard';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { loadOwnProfile } from '@/lib/profile';
import { homeSlotsFor } from '@/lib/registry';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/inicio` — the kernel home (D-42, amends D-07): the branded welcome (logo as-is + "Bem-vindo(a) à
 * {tenant}"), the D-02 profile nudge while the member still owes a photo or a bio (R-13), and the
 * home slots the tenant's ENABLED modules registered, or the "Em breve" card when there is none.
 * Server-rendered from the bootstrap (deduped with the layout by React `cache`), so there is no
 * client loading state for the brand, the nudge or the widgets.
 *
 * On the platform host it renders the D-21 landing (02-12 owns the panel at `/plataforma`).
 *
 * `?aviso=story-expirado` (07-04, UI-D-254) is where a notification about a story that has passed
 * its 24 h lands: Início renders the info toast "Este story expirou." once. Only that exact single
 * value maps to a catalog key; any other `aviso` is ignored in silence (D-93, T-07-23).
 */
const STORY_EXPIRED_NOTICE = 'story-expirado';

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [hostTenant, t, tp, query] = await Promise.all([
    getHostTenant(),
    getTranslations('app'),
    getTranslations('platform'),
    searchParams,
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
                {tp('tenantRow', {
                  slug: tenant.slug,
                  name: tenant.displayName,
                  modules: tp('modulesCount', { count: tenant.enabledModules.length }),
                })}
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
  const [slots, profile, tn] = await Promise.all([
    homeSlotsFor(bootstrap),
    loadOwnProfile(),
    getTranslations('notifications'),
  ]);
  const storyExpired = query.aviso === STORY_EXPIRED_NOTICE;

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

      {/* The D-02 nudge sits BETWEEN the welcome block and the home slots, and deliberately NOT
          inside `HomeSlots`: it is kernel, not a module widget, so it must not compete for slot
          ordering (D-42). With zero module slots the page reads welcome → nudge → the existing
          "Em breve" card; the nudge does not suppress that empty state. `needsNudge` is the
          SERVER's flag (R-13), never a client recomputation and never `localStorage`. */}
      {profile?.needsNudge ? (
        <ProfileNudgeCard displayName={profile.displayName} avatarAssetId={profile.avatarAssetId} />
      ) : null}

      <HomeSlots
        slots={slots}
        empty={
          <EmptyState
            variant="card"
            icon={Sparkles}
            title={t('home.soonTitle')}
            body={t('home.soonBody', { tenant: tenant.displayName })}
          />
        }
      />

      {storyExpired ? <NoticeToast message={tn('fallback.storyExpired')} param="aviso" /> : null}
    </div>
  );
}
