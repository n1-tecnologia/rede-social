'use client';

import { FollowCounts } from '@rede-social/module-social/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FollowControl } from './FollowControl';

/**
 * A count as the counts row prints it: the full number in pt-BR ("1.234"), and compact notation from
 * 10 000 ("12 mil") so a count never outgrows its cell (UI-D-501, E06 long-text and overflow).
 */
export function formatFollowCount(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    notation: value >= 10_000 ? 'compact' : 'standard',
  }).format(value);
}

export interface SocialCountsBlockProps {
  /**
   * `member`: another member's profile, plain cells and the follow control under them.
   * `own`: the caller's own `/perfil`, the same two cells as links to the PRIVATE lists, no control.
   */
  mode: 'member' | 'own';
  membershipId: string;
  /** The person's display name, used only in the control's accessible name. */
  name: string;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
}

/**
 * The profile's social block, client side (09-10, UI-D-501, D-468): the counts row and, on another
 * member's profile, the follow control beneath it. It is a client component only because the follower
 * count has to follow the server's answer to a follow without a reload: the control reports
 * `{ followerCount }` and the row re-renders.
 *
 * **Counts are public, lists are private.** In `member` mode the cells are plain `div`s (no link, no
 * cursor); in `own` mode they link to `/perfil/seguidores` and `/perfil/seguindo`, which take no id
 * and read the session's own rows. There is no way to build a link to anyone else's list from here.
 *
 * **The count follows the server value (WR-04).** A refresh that changes the `followerCount` prop
 * replaces the local count during render (a `seen` copy of the prop is compared, no effect); a
 * re-render with the SAME prop keeps the number the control's last answer set. `followingCount` and
 * `viewerFollows` are plain props: the control below resyncs itself.
 *
 * The profile shows no post count and no "Mensagem" button (D-471, Phase 11).
 */
export function SocialCountsBlock({
  mode,
  membershipId,
  name,
  followerCount: initialFollowerCount,
  followingCount,
  viewerFollows,
}: SocialCountsBlockProps) {
  const t = useTranslations('social');
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [seenFollowerCount, setSeenFollowerCount] = useState(initialFollowerCount);
  if (seenFollowerCount !== initialFollowerCount) {
    setSeenFollowerCount(initialFollowerCount);
    setFollowerCount(initialFollowerCount);
  }
  const own = mode === 'own';

  return (
    <div className="flex flex-col">
      <FollowCounts
        followers={{
          value: formatFollowCount(followerCount),
          label: t('counts.followers', { count: followerCount }),
          ...(own
            ? {
                href: '/perfil/seguidores',
                ariaLabel: t('counts.followersLink', { count: followerCount }),
              }
            : {}),
        }}
        following={{
          value: formatFollowCount(followingCount),
          label: t('counts.following'),
          ...(own
            ? {
                href: '/perfil/seguindo',
                ariaLabel: t('counts.followingLink', { count: followingCount }),
              }
            : {}),
        }}
      />
      {own ? null : (
        <div className="px-4 pt-4">
          <FollowControl
            membershipId={membershipId}
            name={name}
            size="md"
            fullWidth
            className="md:mx-auto md:max-w-[400px]"
            initialFollowing={viewerFollows}
            onChange={setFollowerCount}
          />
        </div>
      )}
    </div>
  );
}
