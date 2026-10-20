'use client';

import { FollowListRow } from '@rede-social/module-social/ui';
import { useTranslations } from 'next-intl';
import { MemberAvatar } from '@/components/profile/MemberRow';
import { profileRowSnippet } from '@/lib/profile-instagram';
import { FollowControl } from './FollowControl';

export interface MemberFollowRowProps {
  membershipId: string;
  displayName: string;
  avatarAssetId: string | null;
  bio: string | null;
  /**
   * The caller's state toward this person, or `null` while it has not arrived: the action slot then
   * keeps its `w-24` width and shows no label (EP-43).
   */
  following: boolean | null;
  /** The caller's own row: the label "Você" in place of the button (UI-D-503 b). */
  own?: boolean;
}

/**
 * One person with a Seguir button: a row of `/membros` for a member viewer and a row of the two
 * private lists (09-10, UI-D-502, UI-D-503). `MemberRow`'s anatomy (photo, 14/700 name, the bio's
 * first line) in the link slot, the `FollowControl` (`sm`, `w-24`) in the action slot - link first,
 * action second in the DOM (EP-44).
 *
 * The caller's own row shows "Você" (12/700 tertiary) at the button's width and no control: nobody
 * follows themselves, and the API would answer `self_follow` anyway.
 */
export function MemberFollowRow({
  membershipId,
  displayName,
  avatarAssetId,
  bio,
  following,
  own = false,
}: MemberFollowRowProps) {
  const t = useTranslations('social');

  return (
    <FollowListRow
      href={`/membros/${membershipId}`}
      avatar={<MemberAvatar displayName={displayName} avatarAssetId={avatarAssetId} />}
      name={displayName}
      snippet={profileRowSnippet(bio)}
      action={
        own ? (
          <span className="inline-block w-24 text-center text-xs font-bold text-text-tertiary">
            {t('directory.you')}
          </span>
        ) : (
          <FollowControl
            membershipId={membershipId}
            name={displayName}
            size="sm"
            initialFollowing={following}
          />
        )
      }
    />
  );
}
