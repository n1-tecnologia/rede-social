import {
  COMMUNITY_PERMISSIONS,
  type CommunityStatus,
} from '@rede-social/module-communities/contracts';
import { Chip } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadCommunities } from '@/lib/communities';
import { CommunitiesList } from './CommunitiesList';

/**
 * `/comunidades` (COMM-02, COMM-03) — the tenant's communities in the order an admin chose, most
 * recent activity first inside it (2026-10-03; with no reorder yet, simply most recent activity
 * first), reached from the `Comunidades` BottomNav/rail tab the module's manifest declares (D-40).
 * The "Reordenar" mode lives in `CommunitiesList`, offered from `canManage` on `Ativas` only — this
 * page decides nothing new for it.
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
 *
 * **05.1 — what a manager gets on top (D-86, D-88, UI-D-48, UI-D-49).**
 *   - The title row carries the create control, in the empty AND the non-empty state and under
 *     either filter, so an admin who already has communities can still reach the form. It is ONE
 *     anchor (never the shipped icon-button primitive, which renders a `<button>`; never a FAB and
 *     never a first card): a 44×44 brand square below `sm`, `+ Criar comunidade` from `sm`, with the
 *     label an `sr-only` span below `sm` so the accessible name is always the visible catalog string.
 *   - Two `Chip` links, `Ativas` and `Arquivadas`, carry the filter in the URL and are read HERE on
 *     the server, so a chip switch, a refresh, back and a shared link all land on the same list.
 *
 * **The status is decided on the server and only for a manager (D-89, web half).** `Arquivadas` is
 * selected only when the viewer holds `communities.community.manage` AND the `status` query value is
 * exactly the single string `arquivadas`. A repeated value (an array), any other value, or a member
 * lands on the active list with no chips and no error. The API's 403 is the real control; this is
 * UX. A member's title markup and request are today's: the flex row, the control and the chips
 * exist only in the manager branch, and `status` is never sent for the active list.
 *
 * `CommunitiesList` is keyed by the status, so switching chips starts from the server's page 1 with
 * no client state carried across lists.
 */
export default async function CommunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations('communities'),
    searchParams,
  ]);

  const canManage = bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manage);
  // Deliberately NOT the "first value wins" rule `/criar` applies: a repeated value lands on Ativas.
  const status: CommunityStatus =
    canManage && params.status === 'arquivadas' ? 'archived' : 'active';
  const page = await loadCommunities({ status });

  const heading = (
    <>
      <h1
        data-brand-title
        className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
      >
        {t('list.title')}
      </h1>
      <p className="mt-1 text-sm font-normal text-text-secondary">{t('list.subtitle')}</p>
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {canManage ? (
        <>
          {/* The heading block is `min-w-0 flex-1` and the control `shrink-0`: at any width the
              control keeps its 44px and the heading wraps rather than overlapping it (UI-D-48). */}
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0 flex-1">{heading}</div>
            <a
              href="/comunidades/nova"
              data-communities-create
              className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:px-4"
            >
              <Plus aria-hidden size={20} className="sm:hidden" />
              <Plus aria-hidden size={16} className="hidden sm:block" />
              <span className="sr-only sm:not-sr-only">{t('actions.create')}</span>
            </a>
          </div>

          <nav aria-label={t('list.filter.label')} className="flex gap-2 px-4 pb-3">
            <Chip href="/comunidades" active={status === 'active'}>
              {t('list.filter.active')}
            </Chip>
            <Chip href="/comunidades?status=arquivadas" active={status === 'archived'}>
              {t('list.filter.archived')}
            </Chip>
          </nav>
        </>
      ) : (
        <div className="px-4 pt-4 pb-3">{heading}</div>
      )}

      <CommunitiesList
        key={status}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
        canManage={canManage}
        status={status}
      />
    </div>
  );
}
