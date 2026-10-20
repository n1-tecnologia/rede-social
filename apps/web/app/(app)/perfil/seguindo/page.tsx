import { SOCIAL_PERMISSIONS } from '@rede-social/module-social/contracts';
import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadFollowing } from '@/lib/social';
import { getHostTenant } from '@/lib/tenant-host';
import { SocialList } from '../SocialList';

/**
 * `/perfil/seguindo` (09-10, D-468, UI-D-502): the caller's PRIVATE "Seguindo" list. Counts are public
 * and lists are private, so this page takes **no id, no search parameter and no segment**: it reads
 * the SESSION's own rows (`GET /v1/social/me/following`) and there is no route, link or deep link to
 * anyone else's list. A guard test (`SocialList.test.tsx`) fails the day a dynamic segment appears
 * beneath it.
 *
 * Only a viewer holding the composed permission `social.participate` has a list: for everyone else -
 * a tenant with `social` off above all, and the staff - it is the standard not-found screen, decided
 * before any request is made. `notFound()` and `redirect()` both throw (Next 16), so they sit outside
 * any try/catch. The platform host has no membership to show, so it lands on `/inicio`.
 *
 * Server-rendered from the API, so the first paint already carries the first page; `SocialList` pages
 * on with the directory's own "Carregar mais". The list shows people, never their posts (D-471).
 */
export default async function FollowingPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') redirect('/inicio');

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(SOCIAL_PERMISSIONS.participate)) notFound();

  const [t, tm, page] = await Promise.all([
    getTranslations('social'),
    getTranslations('members'),
    loadFollowing(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        title={t('following.title')}
        backHref="/perfil"
        backLabel={tm('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />

      <SocialList
        kind="following"
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </div>
  );
}
