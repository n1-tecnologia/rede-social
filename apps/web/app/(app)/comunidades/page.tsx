import {
  COMMUNITY_PERMISSIONS,
  type CommunityStatus,
} from '@rede-social/module-communities/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { Chip } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { communityEntryState, loadCommunities } from '@/lib/communities';
import { getCommunityAccessList } from '@/lib/store';
import { type CommunityTagsView, communityTagsView } from '@/lib/store-view';
import { CommunitiesList } from './CommunitiesList';
import { CommunityLimitNotice } from './CommunityLimitNotice';

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
 * **The status is decided on the server and only for who may read it (D-89, web half; 10-13).**
 * `Arquivadas` is selected only when the viewer may read an archived list AND the `status` query
 * value is exactly the single string `arquivadas`. A manager (`communities.community.manage`) may
 * always; a member creator (`manage_own`, composed only while `social` is on) may only while they own
 * at least one archived community, which one read of THEIR OWN archived rows answers (the API scopes
 * it, D-713). A repeated value (an array), any other value, a member with none or `social` off lands
 * on the active list with no chips and no error. The API's 403 is the real control; this is UX.
 *
 * **10-13 — the member's entry (UI-D-706).** The title-row control is `communityEntryState`: an admin
 * always, a member under their limit, and at the limit `CommunityLimitNotice` stands where the control
 * was (limit 0 and `social` off show neither). The decision reads the composed permissions and the
 * `memberQuota` the list read carries, never a role. The cards carry their "Criada por" byline (UI-D-708).
 *
 * `CommunitiesList` is keyed by the status, so switching chips starts from the server's page 1 with
 * no client state carried across lists.
 *
 * **2026-10-26 — the whole width on a desktop** (the product owner: "essa tela de comunidade deve ter
 * o aproveitamento igual da área de membros"): the page carries `data-shell-full`, so the shell lifts
 * the 680px column, and the list lays its cards out in a grid (`CommunitiesList`).
 *
 * **08.2-09 — the store's card tags (UI-D-372, P81).** Only when `store` is among the bootstrap's
 * modules, `GET /v1/store/community-access` runs BESIDE the first page (`Promise.all`); with the
 * store off no store request is made at all. The answer becomes a map of finished tag views by
 * community id, computed HERE on the server (who sees what: `communityTagsView`), so the client list
 * only draws two booleans per card and pages it appends later find their tags in the same map (the
 * access read is not paged). A failed read is `null` → no map → no tags, never wrong ones
 * (UI-D-384). The list's order and counts are the communities API's, untouched (P47, P48, P76).
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
  const canCreate = bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.create);
  // 10-13 (D-713): the member creator reads the archived list too, scoped by the API to THEIR OWN
  // rows. The key is composed for a member only while `social` is effective, so with `social` off
  // this is false and the member's chips and archived read are gone (UI-D-716).
  const canManageOwn = bootstrap.permissions.includes(COMMUNITY_PERMISSIONS.manageOwn);
  // The member's chips exist only while they own at least one archived community (UI-D-706): one
  // read of the caller's own archived rows, asked for a single row. Asked BEFORE the status is
  // decided, because the answer is what makes `?status=arquivadas` a valid request for a member.
  let ownsArchived = false;
  if (!canManage && canManageOwn) {
    const probe = await loadCommunities({ status: 'archived', limit: 1 });
    ownsArchived = (probe?.items.length ?? 0) > 0;
  }
  const showChips = canManage || ownsArchived;
  // Deliberately NOT the "first value wins" rule `/criar` applies: a repeated value lands on Ativas.
  const status: CommunityStatus =
    showChips && params.status === 'arquivadas' ? 'archived' : 'active';
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const [page, access] = await Promise.all([
    loadCommunities({ status }),
    storeOn ? getCommunityAccessList() : Promise.resolve(null),
  ]);
  // 10-13 (UI-D-706): the create entry is the composed permission plus the quota the read carries.
  const entry = communityEntryState({
    canManage,
    canCreate,
    memberQuota: page?.memberQuota,
  });
  const viewer = {
    canManage: bootstrap.permissions.includes(STORE_PERMISSIONS.manage),
    // UI-D-372: support reads every community in full and holds no store role, so it never sees a
    // tag. The API already answers `locked: false` for staff; this keeps a future permission grant
    // from turning the manager rule on for support by accident.
    isSupport: bootstrap.membership.role === 'support_tenant',
  };
  const storeTags: Record<string, CommunityTagsView> | undefined = access
    ? Object.fromEntries(
        access.items
          .map((item) => [item.communityId, communityTagsView(item, viewer)] as const)
          .filter(([, tags]) => tags.coverBadge || tags.archived),
      )
    : undefined;

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

  const createControl = (
    <a
      href="/comunidades/nova"
      data-communities-create
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:px-4"
    >
      <Plus aria-hidden size={20} className="sm:hidden" />
      <Plus aria-hidden size={16} className="hidden sm:block" />
      <span className="sr-only sm:not-sr-only">{t('actions.create')}</span>
    </a>
  );

  return (
    <div data-shell-full className="flex w-full flex-col">
      {entry === 'control' ? (
        // The heading block is `min-w-0 flex-1` and the control `shrink-0`: at any width the
        // control keeps its 44px and the heading wraps rather than overlapping it (UI-D-48).
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">{heading}</div>
          {createControl}
        </div>
      ) : (
        <div className="px-4 pt-4 pb-3">{heading}</div>
      )}

      {/* UI-D-706 (b): at the limit the notice stands where the control was; limit 0 shows nothing. */}
      {entry === 'notice' && page?.memberQuota ? (
        <CommunityLimitNotice limit={page.memberQuota.limit} />
      ) : null}

      {showChips ? (
        <nav aria-label={t('list.filter.label')} className="flex gap-2 px-4 pb-3">
          <Chip href="/comunidades" active={status === 'active'}>
            {t('list.filter.active')}
          </Chip>
          <Chip href="/comunidades?status=arquivadas" active={status === 'archived'}>
            {t('list.filter.archived')}
          </Chip>
        </nav>
      ) : null}

      <CommunitiesList
        key={status}
        initialItems={page?.items ?? []}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
        tenantName={bootstrap.tenant.displayName}
        canManage={canManage}
        canCreate={entry === 'control'}
        status={status}
        storeTags={storeTags}
      />
    </div>
  );
}
