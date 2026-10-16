import { CommunityCard } from '@rede-social/module-communities/ui';
import { CircleAlert, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  ProfileEmptyCard,
  ProfileRail,
  ProfileRailItem,
} from '@/components/profile/ProfileSection';
import { profileCommunityAccess, profileCommunityPage } from '@/lib/profile-activity';
import { accessibleCommunities, PROFILE_RAIL_SIZE } from '@/lib/profile-activity-view';

/**
 * The "Comunidades" section of `/perfil` (2026-10-12): the comunidades the member can open, the
 * open ones and the exclusive ones they unlocked (a locked exclusive stays out), in the list's own
 * order, as compact cards (`CommunityCard variant="tile"`) in the sideways rail; the section's
 * "Ver todas" opens `/comunidades`. There is no membership per comunidade yet (every member reads
 * every open one), so this is the first page of `/comunidades` filtered by the store's access list:
 * `docs/pendencias-backend.md` item 8.
 *
 * `readsAccess` is `readsCommunityAccess` (a member, with the store on): the access list is shared
 * with the "Loja" block's count, one request per render. A failed list read is this section's own
 * error card; a failed access read drops nothing, as on `/comunidades`, since the gate itself is the
 * server's.
 */
export async function ProfileCommunitiesRail({ readsAccess }: { readsAccess: boolean }) {
  const [t, tc, page, access] = await Promise.all([
    getTranslations('profile'),
    getTranslations('communities'),
    profileCommunityPage(),
    readsAccess ? profileCommunityAccess() : null,
  ]);

  if (!page) {
    return (
      <ProfileEmptyCard
        icon={CircleAlert}
        title={t('sectionErrors.title')}
        body={t('sectionErrors.communities')}
        action={{ href: '/perfil', label: t('sectionErrors.retry'), variant: 'outline' }}
      />
    );
  }

  const communities = accessibleCommunities(page.items, access, PROFILE_RAIL_SIZE);
  if (communities.length === 0) {
    return (
      <ProfileEmptyCard
        icon={Users}
        title={t('communities.emptyTitle')}
        body={t('communities.emptyBody')}
        action={{ href: '/comunidades', label: t('communities.explore'), variant: 'filled' }}
      />
    );
  }

  return (
    <ProfileRail>
      {communities.map((community) => (
        <ProfileRailItem key={community.id}>
          <CommunityCard
            variant="tile"
            href={`/comunidades/${community.id}`}
            name={community.name}
            description={community.description}
            coverAssetId={community.coverAssetId}
            coverVariantWidths={community.coverVariantWidths}
            postCountLabel={tc('card.posts', { count: community.postCount })}
            coverAlt={tc('card.cover', { community: community.name })}
          />
        </ProfileRailItem>
      ))}
    </ProfileRail>
  );
}
