import { EmptyState } from '@rede-social/ui';
import { CircleAlert, Pencil, Settings } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { OwnerPanelSection } from '@/components/dashboard/OwnerPanelSection';
import { ActivitySkeleton } from '@/components/profile/activity/ActivitySkeleton';
import { ProfileCompletenessCard } from '@/components/profile/ProfileCompletenessCard';
import { ProfileHero, ProfileHeroAction } from '@/components/profile/ProfileHero';
import { ProfileRailSkeleton, ProfileSection } from '@/components/profile/ProfileSection';
import { adminIconFor } from '@/lib/admin-icon';
import { readAdminIconChoice } from '@/lib/admin-icon-cookie';
import { requireBootstrap } from '@/lib/bootstrap';
import { instagramLinkView } from '@/lib/feed-view';
import { ownerPanelFlags } from '@/lib/owner-panel';
import { loadOwnProfile } from '@/lib/profile';
import { preloadProfileSections } from '@/lib/profile-activity';
import {
  moduleFlags,
  profileCompleteness,
  readsCommunityAccess,
} from '@/lib/profile-activity-view';
import { splitProfileBio } from '@/lib/profile-instagram';
import { getHostTenant } from '@/lib/tenant-host';
import { ProfileActivity } from './ProfileActivity';
import { ProfileCommunitiesRail } from './ProfileCommunitiesRail';
import { ProfileEventsRail } from './ProfileEventsRail';

/**
 * `/perfil` (PROF-01), the member's own profile. Since 2026-10-12 (the REINE prototype's profile
 * as a reference, not a copy) it is a hero, a warning and up to three sections:
 * - the hero (`ProfileHero`): the tenant's gradient band with the pencil ("Editar perfil") and the
 *   gear ("Configurações") in its corner, where the rows used to be, the photo over the band, then
 *   the name, the Instagram link, the e-mail and the bio, centred on the band (2026-10-13). The
 *   "Membros" row is gone with them: a member no longer learns who is in the community (`/membros`
 *   is the staff's, `member-directory`);
 * - "Complete seu perfil" (`ProfileCompletenessCard`): the warning, only while the photo, the bio or
 *   the Instagram is missing, from the profile the page already holds (it waits for nothing). It is
 *   all that is left of the "Atividades" dashboard, which the owner removed on 2026-10-13;
 * - "Sua atividade" (`MemberActivityReport`, 2026-10-13; 08.7-03 on real data): the
 *   rede-social-dashboard preview's member report, for the `member` role ONLY (the staff never see
 *   it), on the member's OWN numbers of the nightly snapshot (`GET /v1/dashboard/activity`), with
 *   "Em breve" where nothing is measured yet. It streams in its own `Suspense` (`ProfileActivity`,
 *   `ActivitySkeleton`) with its own preparing and error cards;
 * - the owner's panel (`OwnerPanelSection`, 2026-10-15): the rede-social-dashboard preview's "Dono
 *   do cliente" screen, for the `admin_tenant` role ONLY (members and support never see it), in the
 *   same place as "Sua atividade". Its six areas, lists and details navigate by the query on
 *   `/perfil` (`?area=membros`, `lib/owner-panel.ts`); the tenant's name, icon and host are real, the
 *   numbers are SAMPLE values, untagged, until the backend measures them (item 10);
 * - "Eventos" and "Comunidades": the member's galleries, with their "Ver todos".
 * Each section exists only with its module on, and costs no request without it.
 *
 * **Nothing here waits for the sections.** The page reads what the hero needs (the bootstrap, the
 * profile, the admin icon), starts every section read beside it (`preloadProfileSections`), and
 * streams each section in its own `Suspense`; the loaders never throw, so a failed read is that
 * section's error card and never `app/error.tsx`. ONE clock read serves every relative label.
 *
 * 2026-10-09: the member's Instagram is stored inside the bio (`lib/profile-instagram.ts`), so the
 * page splits it: the hero shows the text as the bio and the handle as a link under the name, the
 * same link a post of theirs carries (`instagramLinkView`).
 *
 * **A tab page** (the Perfil tab of the BottomNav and the rail), so, like `/inicio` and
 * `/eventos`, it has no `PageHeader`. Its h1 "Perfil" stays for assistive tech only; the visible
 * heading is the member's name, the hero's h2.
 *
 * The platform host has no membership to show, so it lands back on `/inicio`. A refusal the
 * bootstrap map knows redirects (`requireBootstrap`, `loadOwnProfile`); a profile that cannot be
 * read renders the generic "Tentar novamente" empty state here rather than the app-level error page
 * (E1/error).
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  // The layout reads the same cached bootstrap; the sections' reads start before the profile's.
  const bootstrap = await requireBootstrap();
  const flags = moduleFlags(bootstrap.modules);
  const role = bootstrap.membership.role;
  preloadProfileSections(flags, role);

  const [t, tf, ta, profile, iconChoice] = await Promise.all([
    getTranslations('profile'),
    getTranslations('feed'),
    getTranslations('profile.activity'),
    loadOwnProfile(),
    readAdminIconChoice(),
  ]);
  // The viewer's OWN role: the only one this screen may know (D-47).
  const adminLabel = role === 'admin_tenant' ? tf('post.adminBadge') : null;

  if (!profile) {
    return (
      <div className="flex flex-col gap-6 px-4 pt-4 md:px-0">
        <h1 className="sr-only">{t('title')}</h1>
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <a
              href="/perfil"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {t('errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  // 2026-10-09: the stored bio carries the Instagram line; the hero shows the text and the link.
  const { text: bio, instagram } = splitProfileBio(profile.bio);
  const completeness = profileCompleteness({
    avatarAssetId: profile.avatarAssetId,
    bioText: bio,
    instagram,
  });
  const tz = bootstrap.tenant.timezone;
  const nowMs = Date.now();

  return (
    <div className="flex flex-col gap-8 pb-6">
      <h1 className="sr-only">{t('title')}</h1>

      <ProfileHero
        displayName={profile.displayName}
        avatarAssetId={profile.avatarAssetId}
        bio={bio || null}
        instagram={instagram === null ? null : instagramLinkView(instagram, tf)}
        email={profile.email}
        adminLabel={adminLabel}
        adminIcon={adminIconFor(iconChoice, profile.membershipId)}
        actions={
          <>
            <ProfileHeroAction href="/perfil/editar" label={t('actions.edit')} icon={Pencil} />
            <ProfileHeroAction
              href="/configuracoes"
              label={t('actions.settings')}
              icon={Settings}
            />
          </>
        }
      />

      {completeness.done < completeness.total ? (
        <div className="px-4">
          <ProfileCompletenessCard
            percent={completeness.percent}
            percentLabel={t('completeness.percent', { percent: completeness.percent })}
            title={t('completeness.title')}
            progress={t('completeness.progress', {
              done: completeness.done,
              total: completeness.total,
            })}
            items={completeness.items.map((item) => ({
              key: item.key,
              label: t(`completeness.items.${item.key}`),
              done: item.done,
              stateLabel: item.done
                ? t('completeness.state.done')
                : t('completeness.state.missing'),
            }))}
            cta={{ href: '/perfil/editar', label: t('completeness.cta') }}
          />
        </div>
      ) : null}

      {role === 'member' ? (
        <ProfileSection
          id="activity"
          title={ta('title')}
          meta={ta('period')}
          titleStyle="prominent"
        >
          <Suspense fallback={<ActivitySkeleton />}>
            <ProfileActivity tz={tz} nowMs={nowMs} />
          </Suspense>
        </ProfileSection>
      ) : null}

      {role === 'admin_tenant' ? (
        <OwnerPanelSection
          tenantName={bootstrap.tenant.displayName}
          branding={bootstrap.tenant.branding}
          host={hostTenant}
          query={await searchParams}
          timeZone={tz}
          flags={ownerPanelFlags(bootstrap.modules)}
        />
      ) : null}

      {flags.events ? (
        <ProfileSection
          id="events"
          title={t('sections.events')}
          seeAll={{
            href: '/eventos/meus',
            label: t('sections.seeAllEvents'),
            ariaLabel: t('sections.seeAllEventsLabel'),
          }}
        >
          <Suspense fallback={<ProfileRailSkeleton kind="poster" />}>
            <ProfileEventsRail tz={tz} nowMs={nowMs} />
          </Suspense>
        </ProfileSection>
      ) : null}

      {flags.communities ? (
        <ProfileSection
          id="communities"
          title={t('sections.communities')}
          seeAll={{
            href: '/comunidades',
            label: t('sections.seeAllCommunities'),
            ariaLabel: t('sections.seeAllCommunitiesLabel'),
          }}
        >
          <Suspense fallback={<ProfileRailSkeleton kind="tile" />}>
            <ProfileCommunitiesRail readsAccess={readsCommunityAccess(flags, role)} />
          </Suspense>
        </ProfileSection>
      ) : null}
    </div>
  );
}
