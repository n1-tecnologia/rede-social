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

/** Two skeleton cells while the social read is pending - never a "0" (UI-D-511, E06 loading). */
export function SocialCountsSkeleton() {
  return (
    <div aria-busy className="grid grid-cols-2 border-y border-border py-4">
      {[0, 1].map((cell) => (
        <div key={cell} className="flex flex-col items-center gap-1">
          <Skeleton variant="text" width="2rem" className="h-4" />
          <Skeleton variant="text" width="4rem" className="h-3" />
        </div>
      ))}
    </div>
  );
}

/** Exported for the unit test only: the awaited half of the block, rendered without the Suspense. */
export async function SocialProfileData({
  mode = 'member',
  membershipId,
  name,
  retryHref,
}: Omit<SocialProfileBlockProps, 'permissions'>) {
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

  return (
    <Suspense fallback={<SocialCountsSkeleton />}>
      <SocialProfileData {...rest} />
    </Suspense>
  );
}
