'use client';

import { FollowCounts } from '@rede-social/module-social/ui';
import { Button, buttonClasses, useToast } from '@rede-social/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FollowControl } from './FollowControl';
import { unblockMemberAction } from './follow-actions';

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
  blockedByViewer,
  canChat = false,
}: SocialCountsBlockProps) {
  const t = useTranslations('social');
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [seenFollowerCount, setSeenFollowerCount] = useState(initialFollowerCount);
  if (seenFollowerCount !== initialFollowerCount) {
    setSeenFollowerCount(initialFollowerCount);
    setFollowerCount(initialFollowerCount);
  }
  // The blocker lifted the block from this very screen: the pair is back until the refreshed facts arrive
  // (and the follow rows were deleted at the block, so it reads "Seguir", D-724). A changed server value of
  // `blockedByViewer` replaces the local guess during render, the same way the follower count does.
  const [unblocked, setUnblocked] = useState(false);
  const [seenBlocked, setSeenBlocked] = useState(blockedByViewer);
  if (seenBlocked !== blockedByViewer) {
    setSeenBlocked(blockedByViewer);
    setUnblocked(false);
  }
  const own = mode === 'own';
  const blocker = !own && blockedByViewer === true && !unblocked;
  const showFollow = unblocked || canFollow !== false;
  const showMessage = canChat && (unblocked || canMessage !== false);
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
      {blocker ? (
        <div className="px-4 pt-4">
          <UnblockButton
            membershipId={membershipId}
            name={name}
            onUnblocked={() => setUnblocked(true)}
          />
        </div>
      ) : null}
      {own || blocker || (!showFollow && !showMessage) ? null : (
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

/**
 * "Desbloquear" for the blocker (UI-D-867, A-UI-19): one tap, no confirmation, "Desbloqueando…" while the
 * request is in flight, a success toast naming the person and the pair back in the zone. It takes the zone's
 * whole width, like the pair, with the same desktop cap. A failure keeps the button and toasts the generic
 * error; a second tap while pending is ignored (a ref as well as the disabled state, as `FollowControl` does).
 * An answer `changed: false` (somebody lifted it already) re-renders the pair WITHOUT a second toast. The
 * route is refreshed so the facts are read again.
 */
function UnblockButton({
  membershipId,
  name,
  onUnblocked,
}: {
  membershipId: string;
  name: string;
  onUnblocked: () => void;
}) {
  const t = useTranslations('social');
  const tf = useTranslations('feed');
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const unblock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    let answer: { ok: boolean; changed: boolean } = { ok: false, changed: false };
    try {
      answer = await unblockMemberAction(membershipId);
    } catch (error) {
      console.error('social.unblock_failed', { error: String(error) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    if (!answer.ok) {
      toast.show({ tone: 'error', message: tf('errors.generic') });
      return;
    }
    if (answer.changed) {
      toast.show({ tone: 'success', message: t('profile.unblocked', { nome: name }) });
    }
    onUnblocked();
    router.refresh();
  };

  return (
    <Button
      variant="outline"
      size="md"
      fullWidth
      loading={pending}
      aria-label={t('profile.unblockAria', { nome: name })}
      className="md:mx-auto md:max-w-[400px]"
      onClick={() => void unblock()}
    >
      {pending ? t('profile.unblocking') : t('profile.unblock')}
    </Button>
  );
}
