'use client';

import { FollowListRow } from '@rede-social/module-social/ui';
import { MessageCircle } from 'lucide-react';
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
  /**
   * 11-23 (D-720, UI-D-868): draw the round message control left of Seguir. Opt-in: only the `/membros`
   * list passes it, so the two private follow lists never grow it. Ignored on the caller's own row.
   */
  message?: boolean;
  /**
   * 11-23 (D-722): the pair cannot interact (a block either way, nothing to offer): the row keeps its link
   * and draws no control and no slot content, so a blocked pair reads like a staff row and says nothing.
   */
  hideControls?: boolean;
  /** Forwarded to the Seguir control: a refused follow, after its revert and toast. */
  onFollowRefused?: () => void;
}

/**
 * One person with a Seguir button: a row of `/membros` for a member viewer and a row of the two
 * private lists (09-10, UI-D-502, UI-D-503). `MemberRow`'s anatomy (photo, 14/700 name, the bio's
 * first line) in the link slot, the `FollowControl` (`sm`, `w-24`) in the action slot - link first,
 * action second in the DOM (EP-44).
 *
 * The caller's own row shows "Você" (12/700 tertiary) at the button's width and no control: nobody
 * follows themselves, and the API would answer `self_follow` anyway.
 *
 * **The message control (11-23, UI-D-868).** With `message`, a 44px round outline link to
 * `/conversas/com/{membershipId}` sits in the same non-shrinking cluster, left of Seguir; the name link keeps
 * `min-w-0 flex-1` and truncates. The control is ABSENT, never disabled, where it does not apply.
 */
export function MemberFollowRow({
  membershipId,
  displayName,
  avatarAssetId,
  bio,
  following,
  own = false,
  message = false,
  hideControls = false,
  onFollowRefused,
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
        ) : hideControls ? null : message ? (
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/conversas/com/${encodeURIComponent(membershipId)}`}
              aria-label={t('directory.messageAria', { nome: displayName })}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg-secondary text-text-secondary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <MessageCircle aria-hidden size={20} />
            </a>
            <FollowControl
              membershipId={membershipId}
              name={displayName}
              size="sm"
              initialFollowing={following}
              onFollowRefused={onFollowRefused}
            />
          </div>
        ) : (
          <FollowControl
            membershipId={membershipId}
            name={displayName}
            size="sm"
            initialFollowing={following}
            onFollowRefused={onFollowRefused}
          />
        )
      }
    />
  );
}
