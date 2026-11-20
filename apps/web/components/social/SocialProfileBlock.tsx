import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { SOCIAL_PERMISSIONS } from '@rede-social/module-social/contracts';
import { buttonClasses, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { getSocialProfile } from '@/lib/social';
import { SocialCountsBlock } from './SocialCountsBlock';

export interface SocialProfileBlockProps {
  /** `member` under another member's profile header, `own` under the hero of `/perfil`. */
  mode?: 'member' | 'own';
  /** The membership whose counts are read (the profile's, or the caller's own for `own`). */
  membershipId: string;
  /** Used only in the follow control's accessible name. */
  name: string;
  /** The viewer's COMPOSED permissions (`bootstrap.permissions`): the one switch (D-482). */
  permissions: readonly string[];
  /** The page's own URL, for the "Tentar novamente" link of the inline error. */
  retryHref: string;
}

/** What the awaited half needs on top of the block's props: the viewer's `chat.direct`, already derived. */
type SocialProfileDataProps = Omit<SocialProfileBlockProps, 'permissions'> & {
  canChat?: boolean;
};

/**
 * Two skeleton cells while the social read is pending - never a "0" (UI-D-511, E06 loading) - and, for a
 * viewer who may message, two skeleton blocks where the action pair will be (11-23, E4 loading): never a
 * button that then appears. A viewer without `chat.direct` gets one block, the Seguir button's.
 */
export function SocialCountsSkeleton({ canChat = false }: { canChat?: boolean }) {
  return (
    <>
      <div aria-busy className="grid grid-cols-2 border-y border-border py-4">
        {[0, 1].map((cell) => (
          <div key={cell} className="flex flex-col items-center gap-1">
            <Skeleton variant="text" width="2rem" className="h-4" />
            <Skeleton variant="text" width="4rem" className="h-3" />
          </div>
        ))}
      </div>
      <div className="px-4 pt-4">
        <div
          data-testid="social-zone-skeleton"
          className="flex flex-col gap-2 min-[360px]:flex-row md:mx-auto md:max-w-[400px]"
        >
          {(canChat ? [0, 1] : [0]).map((block) => (
            <Skeleton key={block} variant="rect" className="h-11 min-[360px]:flex-1" />
          ))}
        </div>
      </div>
    </>
  );
}

/** Exported for the unit test only: the awaited half of the block, rendered without the Suspense. */
export async function SocialProfileData({
  mode = 'member',
  membershipId,
  name,
  retryHref,
  canChat = false,
}: SocialProfileDataProps) {
  const [result, t] = await Promise.all([
    getSocialProfile(membershipId),
    getTranslations('social'),
  ]);

  // A staff target, a blocked one, the module off: the profile is exactly D-45's.
  if (result.status === 'not-eligible') return null;

  // The base profile has rendered; only this slot failed, and it says so (never a bare staff look).
  if (result.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 border-y border-border px-4 py-4 text-center">
        <p className="text-sm font-normal text-danger">{t('counts.error')}</p>
        <a
          href={retryHref}
          className={buttonClasses({ variant: 'outline', size: 'sm', hitArea: true })}
        >
          {t('counts.retry')}
        </a>
      </div>
    );
  }

  const { data } = result;
  // Another member's page for the caller themself is redirected before this renders; `own` expects it.
  if (mode === 'member' && data.self) return null;
  if (mode === 'own' && !data.self) return null;

  return (
    <SocialCountsBlock
      mode={mode}
      membershipId={data.membershipId}
      name={name}
      followerCount={data.followerCount}
      followingCount={data.followingCount}
      viewerFollows={data.viewerFollows}
      canFollow={data.canFollow}
      canMessage={data.canMessage}
      blockedByViewer={data.blockedByViewer}
      canChat={canChat}
    />
  );
}

/**
 * The social block of a profile (09-10, D-467, D-468, UI-D-501, UI-D-511): the follower and following
 * counts and, on another member's profile, the Seguir / Seguindo button.
 *
 * **A small server component on purpose** (planning decision 5): the social read is its own request,
 * awaited inside its own `Suspense`, so its loading state is two skeleton cells and its failure is an
 * inline line with a retry link - never a hidden base profile and never a blank that would read as a
 * staff profile.
 *
 * It renders nothing - and makes NO request - unless the viewer holds `social.participate` (the
 * composed permission, the same switch the API guards with). A staff viewer, a tenant with `social`
 * off and a viewer outside the graph therefore get exactly D-45's screen (T-09-36).
 */
export function SocialProfileBlock({ permissions, ...rest }: SocialProfileBlockProps) {
  if (!permissions.includes(SOCIAL_PERMISSIONS.participate)) return null;

  // 11-23 (D-720): the entry point to a conversation also needs the viewer's `chat.direct` (composed).
  const canChat = permissions.includes(CHAT_PERMISSIONS.direct);

  return (
    <Suspense fallback={<SocialCountsSkeleton canChat={canChat} />}>
      <SocialProfileData {...rest} canChat={canChat} />
    </Suspense>
  );
}
