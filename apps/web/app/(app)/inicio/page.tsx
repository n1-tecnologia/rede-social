import { HomeSlots } from '@rede-social/core/ui';
import { EmptyState } from '@rede-social/ui';
import { Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { NoticeToast } from '@/components/feedback/NoticeToast';
import { ProfileNudgeOnArrival } from '@/components/profile/ProfileNudgeOnArrival';
import { requireBootstrap } from '@/lib/bootstrap';
import { requirePlatformTenants } from '@/lib/platform';
import { loadOwnProfile } from '@/lib/profile';
import { homeSlotsFor } from '@/lib/registry';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * `/inicio` — the kernel home (D-42, amends D-07): the home slots the tenant's ENABLED modules
 * registered, or the "Em breve" card when there is none, and, while the member still owes a photo
 * or a bio (R-13), the D-02 profile nudge as the "Complete seu perfil" popup that rises over the
 * page on arrival (2026-10-02; until then it was a card above the slots). There is no visible
 * welcome block (removed 2026-10-01: the shell's TopBar/rail already carries the tenant's logo, or
 * its name without one); the page's h1 is screen-reader only.
 * Server-rendered from the bootstrap (deduped with the layout by React `cache`), so there is no
 * client loading state for the brand or the widgets; the popup's host renders nothing until it
 * rises.
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
  const [slots, profile, tn] = await Promise.all([
    homeSlotsFor(bootstrap),
    loadOwnProfile(),
    getTranslations('notifications'),
  ]);
  const storyExpired = query.aviso === STORY_EXPIRED_NOTICE;

  return (
    // The REINE timeline (2026-10-02): no side gutter and no top padding on a phone, so the stories
    // band and the posts run edge to edge right under the top bar's 7px of page ground; the cards
    // between them (the empty and error states) keep the `px-4` gutter on their own. The next
    // event is no card here since 2026-10-03: it is the red dot on the Eventos tab. From md up
    // everything sits in the centred column, as before.
    <div className="flex flex-col gap-3">
      {/* No visible welcome block (product decision, 2026-10-01): the tenant's logo, or its name
          without one, already heads the shell (TopBar / rail). The page keeps its h1 for assistive
          tech only. */}
      <h1 className="sr-only">{t('nav.home')}</h1>

      <HomeSlots
        slots={slots}
        empty={
          <div className="px-4 md:px-0">
            <EmptyState
              variant="card"
              icon={Sparkles}
              title={t('home.soonTitle')}
              body={t('home.soonBody', { tenant: tenant.displayName })}
            />
          </div>
        }
      />

      {storyExpired ? <NoticeToast message={tn('fallback.storyExpired')} param="aviso" /> : null}

      {/* The D-02 nudge is the "Complete seu perfil" POPUP since 2026-10-02 (a product decision
          that amends D-02's "a card, never a modal", after the reference app): Início is where the
          app is entered (`/entrar` lands here), so it rises over the page on arrival, outside
          `HomeSlots` (kernel, not a module widget, D-42) and taking no room in the column. WHO sees
          it is the SERVER's `needsNudge` (R-13), never a client recomputation: the host is mounted
          only while it holds, so a member who dismissed the old card never sees the popup. WHEN is
          the host's: 500 ms after the page settles, once per visit (`lib/profile-nudge.ts`). */}
      {profile?.needsNudge ? <ProfileNudgeOnArrival membershipId={profile.membershipId} /> : null}
    </div>
  );
}
