'use client';

import { FollowCounts } from '@rede-social/module-social/ui';
import { buttonClasses } from '@rede-social/ui';
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
  /**
   * 11-23 (D-720, D-722, UI-D-867): the finished facts of the social read, all optional because an API older
   * than the web does not send them (the zone then reads as the shipped one). The zone is driven by these and
   * by `canChat`, never by a role and never by a "blocked me" flag (T-11-03).
   */
  canFollow?: boolean;
  canMessage?: boolean;
  blockedByViewer?: boolean;
  /** The viewer holds `chat.direct` (the composed permission): the web's half of "may write to them". */
  canChat?: boolean;
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
 * **The action zone (11-23, UI-D-867).** Under the counts: Seguir (brand) beside "Enviar mensagem" (outline, a
 * LINK to `/conversas/com/{membershipId}`, so following is not required), stacked below 360px with Seguir
 * first. The link is drawn only when the viewer holds `chat.direct` and `canMessage` is not false. A member
 * the viewer BLOCKED sees neither button but one "Desbloquear"; a member who was blocked sees NOTHING in the
 * zone, not even a wrapper (D-722, D-725). The profile shows no post count (D-471).
 */
export function SocialCountsBlock({
  mode,
  membershipId,
  name,
  followerCount: initialFollowerCount,
  followingCount,
  viewerFollows,
  canFollow,
  canMessage,
  canChat = false,
}: SocialCountsBlockProps) {
  const t = useTranslations('social');
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [seenFollowerCount, setSeenFollowerCount] = useState(initialFollowerCount);
  if (seenFollowerCount !== initialFollowerCount) {
    setSeenFollowerCount(initialFollowerCount);
    setFollowerCount(initialFollowerCount);
  }
  const own = mode === 'own';
  const showFollow = canFollow !== false;
  const showMessage = canChat && canMessage !== false;
  const pair = showFollow && showMessage;

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
      {own || (!showFollow && !showMessage) ? null : (
        <div className="px-4 pt-4">
          {pair ? (
            <div className="flex flex-col gap-2 min-[360px]:flex-row md:mx-auto md:max-w-[400px]">
              <FollowControl
                membershipId={membershipId}
                name={name}
                size="md"
                className="min-[360px]:flex-1"
                initialFollowing={viewerFollows}
                onChange={setFollowerCount}
              />
              <MessageLink membershipId={membershipId} name={name} className="min-[360px]:flex-1" />
            </div>
          ) : showFollow ? (
            <FollowControl
              membershipId={membershipId}
              name={name}
              size="md"
              fullWidth
              className="md:mx-auto md:max-w-[400px]"
              initialFollowing={viewerFollows}
              onChange={setFollowerCount}
            />
          ) : (
            <MessageLink
              membershipId={membershipId}
              name={name}
              className="w-full md:mx-auto md:max-w-[400px]"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** "Enviar mensagem": an outline link to the conversation entry; the name is only in the accessible name. */
function MessageLink({
  membershipId,
  name,
  className,
}: {
  membershipId: string;
  name: string;
  className?: string;
}) {
  const t = useTranslations('social');
  return (
    <a
      href={`/conversas/com/${encodeURIComponent(membershipId)}`}
      aria-label={t('profile.messageAria', { nome: name })}
      className={buttonClasses({ variant: 'outline', size: 'md', className })}
    >
      {t('profile.message')}
    </a>
  );
}
