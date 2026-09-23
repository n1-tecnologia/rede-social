import { COMMUNITY_PERMISSIONS } from '@tria/module-communities/contracts';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCommunities } from '@/lib/communities';
import { CommunitiesList } from './CommunitiesList';

/**
 * `/comunidades` (COMM-02, COMM-03) — the tenant's communities, most recent activity first, reached
 * from the `Comunidades` BottomNav/rail tab the module's manifest declares (D-40).
 *
 * Server-rendered from `GET /v1/communities`, so the first paint already carries page 1 and a shared
 * link opens on the same list. Everything the list shows is the API's answer: COMM-02's "every
 * member sees every community" is a property of a read that never joins `community_members`, so
 * nothing here filters by role and the payload has no role field to filter on.
 *
 * `canManage` is the composed `communities.community.manage` permission from the bootstrap — the
 * SAME value the API's `requirePermission` guard evaluates (T-05-03). There is deliberately no role
 * comparison: granting the permission to another role must change what this page offers with no web
 * edit at all.
 *
 * **`PageHeader`-less on purpose** (UI-SPEC §List `/comunidades`): the 24/700 heading and its
 * subheading sit in the column itself, because this screen is a TAB destination and has nothing to
 * go back to.
 */
export default async function CommunitiesPage() {
  const [bootstrap, page, t] = await Promise.all([
    requireBootstrap(),
    loadCommunities(),
    getTranslations('communities'),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text">
          {t('list.title')}
        </h1>
        <p className="mt-1 text-sm font-normal text-text-secondary">{t('list.subtitle')}</p>
      </div>

      <CommunitiesList
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
        canManage={bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manage)}
      />
    </div>
  );
}
