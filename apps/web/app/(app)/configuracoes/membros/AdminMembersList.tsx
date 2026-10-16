'use client';

import type { TenantRole } from '@rede-social/contracts';
import type { AdminMember, AdminMemberStatusFilter } from '@rede-social/contracts/moderation';
import {
  ADMIN_MEMBER_STATUSES,
  ADMIN_MEMBERS_MAX_QUERY_LENGTH,
} from '@rede-social/contracts/moderation';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  SearchBar,
  useDebounce,
  useToast,
} from '@rede-social/ui';
import { CircleAlert, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { AdminMemberRow, AdminMemberSkeleton, memberName } from '@/components/admin/AdminMemberRow';
import { MemberAdminSheet, type MemberSheetSettled } from '@/components/admin/MemberAdminSheet';
import { ROLE_KEY } from '@/components/admin/RoleOptionList';
import {
  blockMemberAction,
  changeMemberRoleAction,
  loadMoreAdminMembersAction,
  unblockMemberAction,
} from './actions';

export interface AdminMembersListProps {
  /** Page 1 for the URL's `?q=` and `?status=`, read on the server. */
  initialItems: AdminMember[];
  initialCursor: string | null;
  /** The URL's `?q=`, trimmed and capped by the page. The URL is the source of truth. */
  q: string;
  /** The URL's `?status=`, normalised by the page: an unknown value is `all`. */
  status: AdminMemberStatusFilter;
  /** `true` when the server could not read page 1 at all (UI-D-283 first-load failure). */
  initialError?: boolean;
  /** The tenant's display name, for the sheet's bodies and the refusal / gone copy. */
  tenantName: string;
  /** `moderation.manage` in `bootstrap.permissions`: the sheet's access action. */
  canModerate: boolean;
  /** `members.manage` in `bootstrap.permissions`: the sheet's role list (08-05). */
  canManageMembers: boolean;
}

/** The canonical URL for a query — `URLSearchParams`, the `/membros` encoding; `all` is the bare route. */
function listUrl(q: string, status: AdminMemberStatusFilter): string {
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  if (status !== 'all') search.set('status', status);
  const query = search.toString();
  return query ? `/configuracoes/membros?${query}` : '/configuracoes/membros';
}

/**
 * The Membros list (ADMIN-02, D-340, UI-D-271/272/283) — every membership of the tenant, each row
 * opening the ONE member admin sheet.
 *
 * - **The URL is the query.** The search field is debounced 300 ms into `?q=` and the chip row is
 *   bound to `?status=`, both through `router.replace` inside a transition (the `/membros` rule), so
 *   back/forward restore both. While that navigation is pending the list shows 8 row skeletons. The
 *   server renders page 1 for the new URL and this component RE-SEEDS from it during render (React's
 *   documented alternative to an effect), so the previous query's rows never paint under the new one.
 * - **Keyset paging through `InfiniteScroll`.** A page APPENDS; nothing on screen moves. A GENERATION
 *   guard drops a page that started before a query change or a pull-to-refresh replaced the list.
 * - **States.** First-load failure: the card `EmptyState` with a retry. Load-more failure: an inline
 *   line plus a retry, with every loaded row kept. Empty: the search copy when `q` is set, otherwise
 *   the "Bloqueados" / "Convidados" copy (Todos and Ativos always hold the viewer's own row).
 * - **The sheet.** A successful block or unblock updates the row IN PLACE with the server's answer
 *   (no optimistic state), closes the sheet and toasts; a successful role change updates the row and
 *   the open sheet in place and toasts (the sheet stays open, UI-D-273); a vanished member closes the
 *   sheet, toasts and refreshes; a lost permission toasts and refreshes into `notFound()` (UI-D-284).
 */
export function AdminMembersList({
  initialItems,
  initialCursor,
  q,
  status,
  initialError,
  tenantName,
  canModerate,
  canManageMembers,
}: AdminMembersListProps) {
  const t = useTranslations('admin');
  const tm = useTranslations('moderation.member');
  const router = useRouter();
  const { show } = useToast();
  const [navigating, startNavigation] = useTransition();

  const [value, setValue] = useState(q);
  const debounced = useDebounce(value, 300);

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  /**
   * Bumped whenever the list is REPLACED (a new query's page 1, a refresh). A load-more captures the
   * value it started under and drops its page when the committed value has moved on.
   */
  const [generation, setGeneration] = useState(0);
  const committedGeneration = useRef(0);
  useLayoutEffect(() => {
    committedGeneration.current = generation;
  }, [generation]);

  // The server answered a NEW URL (or a refresh): re-seed from its page 1 during render.
  const [seeded, setSeeded] = useState({ q, status, items: initialItems });
  if (seeded.q !== q || seeded.status !== status || seeded.items !== initialItems) {
    setGeneration((current) => current + 1);
    setSeeded({ q, status, items: initialItems });
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
    // Back/forward changed the URL under the field: the field follows the URL. A URL the field itself
    // just wrote is left alone, so a trailing space being typed is never eaten.
    if (seeded.q !== q && value.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH) !== q) setValue(q);
  }

  // The debounced field drives `?q=`, capped like the contract so it never widens the request. It
  // fires only when the FIELD settled on a new value: a back/forward that changed `q` under it must
  // not push the field's stale value back onto the URL while the field catches up.
  const lastDebounced = useRef(debounced);
  useEffect(() => {
    if (lastDebounced.current === debounced) return;
    lastDebounced.current = debounced;
    const next = debounced.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH);
    if (next === q) return;
    startNavigation(() => {
      router.replace(listUrl(next, status), { scroll: false });
    });
  }, [debounced, q, status, router]);

  const choose = (next: AdminMemberStatusFilter) => {
    if (next === status) return;
    startNavigation(() => {
      router.replace(listUrl(q, next), { scroll: false });
    });
  };

  const forbidden = useCallback(() => {
    show({ tone: 'error', message: t('errors.forbidden') });
    router.refresh();
  }, [router, show, t]);

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    const mine = generation;
    const stale = () => committedGeneration.current !== mine;
    try {
      const page = await loadMoreAdminMembersAction(cursor, q || null, status);
      if (stale()) return;
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setPageFailed(true);
        return;
      }
      setItems((previous) => {
        const held = new Set(previous.map((row) => row.membershipId));
        return [...previous, ...page.items.filter((row) => !held.has(row.membershipId))];
      });
      setCursor(page.nextCursor);
      setPageFailed(false);
    } catch (error) {
      if (stale()) return;
      console.error('admin.members.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, forbidden, generation, q, status]);

  /** Page 1 again for the current URL — what the pull and the first-load retry call. */
  const refresh = useCallback(async () => {
    try {
      const page = await loadMoreAdminMembersAction(null, q || null, status);
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setGeneration((current) => current + 1);
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('admin.members.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [forbidden, items.length, q, status]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);
  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  /* ── The sheet ─────────────────────────────────────────────────────────────────────────────── */

  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openSheet = useCallback((member: AdminMember) => {
    setSelected(member);
    setOpen(true);
  }, []);

  const onAccess = useCallback(
    (membershipId: string, kind: 'block' | 'unblock', reason: string | undefined) =>
      kind === 'block'
        ? blockMemberAction(membershipId, reason ?? null)
        : unblockMemberAction(membershipId, reason ?? null),
    [],
  );

  const onRole = useCallback(
    (membershipId: string, role: TenantRole) => changeMemberRoleAction(membershipId, role),
    [],
  );

  const onSettled = useCallback(
    (outcome: MemberSheetSettled) => {
      if (outcome.kind === 'role') {
        // UI-D-273: the sheet stays open on the new role; the row and the pill update in place.
        const updated = outcome.member;
        setItems((rows) =>
          rows.map((row) => (row.membershipId === updated.membershipId ? updated : row)),
        );
        setSelected(updated);
        show({
          tone: 'success',
          message: t('members.toasts.roleChanged', {
            name: memberName(updated),
            role: t(`roles.${ROLE_KEY[updated.role]}`),
          }),
        });
        return;
      }
      setOpen(false);
      if (outcome.kind === 'changed') {
        const updated = outcome.member;
        setItems((rows) =>
          rows.map((row) => (row.membershipId === updated.membershipId ? updated : row)),
        );
        setSelected(updated);
        const name = memberName(updated);
        show({
          tone: 'success',
          message:
            outcome.change === 'block'
              ? tm('toasts.blocked', { name })
              : tm('toasts.unblocked', { name }),
        });
        return;
      }
      if (outcome.kind === 'gone') {
        setItems((rows) => rows.filter((row) => row.membershipId !== outcome.membershipId));
        show({ tone: 'error', message: t('members.errors.gone', { tenant: tenantName }) });
      } else {
        show({ tone: 'error', message: t('errors.forbidden') });
      }
      router.refresh();
    },
    [router, show, t, tm, tenantName],
  );

  /* ── Render ────────────────────────────────────────────────────────────────────────────────── */

  let body: ReactNode;
  if (navigating) {
    body = <AdminMemberSkeleton count={8} />;
  } else if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    let empty: 'searchEmpty' | 'blockedEmpty' | 'invitedEmpty' = 'searchEmpty';
    if (!q && status === 'blocked') empty = 'blockedEmpty';
    if (!q && status === 'invited') empty = 'invitedEmpty';
    body = (
      <div className="px-4 md:px-0" data-admin-members-empty={empty}>
        <EmptyState
          variant="card"
          icon={Users}
          title={t(`members.${empty}.title`)}
          body={t(`members.${empty}.body`)}
        />
      </div>
    );
  } else {
    body = (
      <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
        <ul aria-label={t('members.title')} data-admin-members>
          {items.map((member) => (
            <li key={member.membershipId} className="border-b border-divider last:border-0">
              <AdminMemberRow member={member} onOpen={openSheet} />
            </li>
          ))}
        </ul>
        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<AdminMemberSkeleton count={3} />}
        />
        {pageFailed ? (
          <div
            data-admin-members-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('members.errors.loadMore')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div className="flex flex-col gap-2">
          {/* Sticky UNDER the `PageHeader`, not beside it (the `/membros` geometry). The header pins
              0.5rem above the scroll container's padded content edge (the primitive's default
              `-0.5rem`, flush under the TopBar) and is 52px tall (a 44px control plus `py-1`), so the
              toolbar pins at 2.75rem, right at the pinned header's bottom. Its natural offset is
              4.25rem (the page's `gap-4` sits between the two), so the header pins after 8px of
              scroll, the toolbar after 24px, and the two never overlap. Pinning both at the same
              offset puts the z-40 header ON TOP of the field and "Limpar busca" stops being
              tappable. On `md:` the header is static, so the toolbar owns the top of the column. */}
          <div
            data-admin-members-toolbar
            className="sticky top-[2.75rem] z-30 bg-bg/95 px-4 pt-2 pb-3 backdrop-blur-sm md:top-0 md:px-0"
          >
            <SearchBar
              id="admin-members-search"
              value={value}
              onChange={(next) => setValue(next.slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH))}
              ariaLabel={t('members.search.label')}
              placeholder={t('members.search.label')}
              clearLabel={t('members.search.clear')}
            />
            {/* UI-D-271: four chips that scroll sideways at 320px and never wrap, with no
                scrollbar drawn over them (2026-10-09). */}
            <div
              data-admin-members-filters
              className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {ADMIN_MEMBER_STATUSES.map((filter) => (
                <Chip
                  key={filter}
                  active={filter === status}
                  onClick={() => choose(filter)}
                  className="shrink-0"
                >
                  {t(`members.filters.${filter}`)}
                </Chip>
              ))}
            </div>
          </div>
          {body}
        </div>
      </PullToRefresh>
      <MemberAdminSheet
        member={selected}
        open={open}
        onClose={close}
        tenantName={tenantName}
        canModerate={canModerate}
        canManageMembers={canManageMembers}
        onAccess={onAccess}
        onRole={onRole}
        onSettled={onSettled}
      />
    </>
  );
}
