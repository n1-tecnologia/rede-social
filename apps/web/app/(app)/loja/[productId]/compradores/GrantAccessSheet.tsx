'use client';

import { ADMIN_MEMBERS_MAX_QUERY_LENGTH } from '@rede-social/contracts/moderation';
import { avatarUrlFor } from '@rede-social/contracts/profiles';
import {
  Avatar,
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  InfiniteScroll,
  SearchBar,
  Skeleton,
  useDebounce,
  useMediaQuery,
  useToast,
} from '@rede-social/ui';
import { SearchX, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { type BuyerRowView, grantedRowView } from '@/lib/store-view';
import { type GrantCandidate, grantAccessAction, searchMembersAction } from './actions';

export interface GrantAccessSheetProps {
  open: boolean;
  /** Backdrop, Escape or drag: the host closes the sheet and returns focus to its button. */
  onClose: () => void;
  productId: string;
  productName: string;
  hasCommunities: boolean;
  tenantName: string;
  /**
   * A grant that WROTE a new entitlement: the host prepends the row, raises the count and closes the
   * sheet. Called once the confirm dialog has closed, so focus can land on the host's button.
   */
  onGranted: (row: BuyerRowView) => void;
}

/** `count` member-row skeletons in the admin member row's geometry (4 while a query is pending). */
function CandidateSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="grant-skeleton" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 border-b border-divider py-2">
          <Skeleton variant="circle" className="h-8 w-8" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" className="w-1/2" />
            <Skeleton variant="text" className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Search =
  | { state: 'idle' }
  | {
      state: 'done';
      q: string;
      items: GrantCandidate[];
      nextCursor: string | null;
      pageFailed: boolean;
    }
  | { state: 'error'; q: string };

/**
 * "Conceder acesso" (08.2-11, D-360, UI-D-381): the shipped `BottomSheet` (a centred card from `md`,
 * `scroll="content"`, focus on the search field) with the shipped `SearchBar` debounced 300 ms into
 * the Membros admin search over ACTIVE members.
 *
 * - **States.** Before typing: the hint. While a query is pending (debounce or request): 4 row
 *   skeletons. Results: `<button>` rows in the admin member row look (avatar, name and e-mail both
 *   `truncate`), page 1 of 20 plus `InfiniteScroll` inside the sheet's own scroll area. No match:
 *   `EmptyState variant="plain"`. A failed search: an inline line plus a retry.
 * - **Grant.** A row opens the brand `ConfirmDialog` naming the person (a confirm before every grant
 *   guards against a mis-tap on a near-identical name, T-08.2-49). `granted` hands the new
 *   "Concedido" row to the host and toasts; `already_active` toasts and keeps the sheet;
 *   `gone` (the bare 404: a membership that left, or another tenant's id) toasts the member-gone
 *   copy, never a success; a failure toasts and keeps the sheet.
 * - **Freshness.** A response that answers a query the field no longer holds is dropped, so an
 *   older, slower request can never paint over a newer one.
 */
export function GrantAccessSheet({
  open,
  onClose,
  productId,
  productName,
  hasCommunities,
  tenantName,
  onGranted,
}: GrantAccessSheetProps) {
  const t = useTranslations();
  const { show } = useToast();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [value, setValue] = useState('');
  const debounced = useDebounce(value, 300);
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [target, setTarget] = useState<GrantCandidate | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  /** The row a grant just wrote, handed to the host once the confirm dialog has closed. */
  const granted = useRef<BuyerRowView | null>(null);
  /** The query the latest request was for; any other answer is stale and dropped. */
  const latest = useRef('');

  const query = value.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH);
  const settled = debounced.trim().slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH);

  // Every opening starts from an empty field and the hint.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setValue('');
      setSearch({ state: 'idle' });
      setTarget(null);
    }
  }

  const runSearch = useCallback(async (q: string) => {
    latest.current = q;
    try {
      const page = await searchMembersAction(q, null);
      if (latest.current !== q) return;
      setSearch(
        page.ok
          ? { state: 'done', q, items: page.items, nextCursor: page.nextCursor, pageFailed: false }
          : { state: 'error', q },
      );
    } catch (error) {
      if (latest.current !== q) return;
      console.error('store.grant_search_failed', { error: String(error) });
      setSearch({ state: 'error', q });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (settled === '') {
      latest.current = '';
      setSearch({ state: 'idle' });
      return;
    }
    void runSearch(settled);
  }, [open, settled, runSearch]);

  const loadMore = useCallback(async () => {
    if (search.state !== 'done' || search.nextCursor === null) return;
    const { q, nextCursor } = search;
    try {
      const page = await searchMembersAction(q, nextCursor);
      if (latest.current !== q) return;
      setSearch((current) => {
        if (current.state !== 'done' || current.q !== q) return current;
        if (!page.ok) return { ...current, pageFailed: true };
        const held = new Set(current.items.map((item) => item.membershipId));
        return {
          ...current,
          items: [...current.items, ...page.items.filter((item) => !held.has(item.membershipId))],
          nextCursor: page.nextCursor,
          pageFailed: false,
        };
      });
    } catch (error) {
      console.error('store.grant_search_more_failed', { error: String(error) });
      setSearch((current) =>
        current.state === 'done' && current.q === q ? { ...current, pageFailed: true } : current,
      );
    }
  }, [search]);

  const confirmGrant = async () => {
    const member = target;
    if (!member) return;
    let result: Awaited<ReturnType<typeof grantAccessAction>> = { status: 'error' };
    try {
      result = await grantAccessAction(productId, member.membershipId);
    } catch (error) {
      console.error('store.grant_action_failed', { error: String(error) });
    }
    if (result.status === 'granted') {
      granted.current = grantedRowView(
        {
          entitlementId: result.entitlementId,
          membershipId: member.membershipId,
          name: member.name,
          avatarAssetId: member.avatarAssetId,
          meta: result.meta,
        },
        t,
      );
      show({ tone: 'success', message: t('store.grant.done', { name: member.name }) });
    } else if (result.status === 'already_active') {
      show({ tone: 'info', message: t('store.grant.already', { name: member.name }) });
    } else if (result.status === 'gone') {
      show({ tone: 'error', message: t('store.grant.errors.gone', { tenant: tenantName }) });
    } else {
      show({ tone: 'error', message: t('store.grant.errors.failed') });
    }
  };

  /** The dialog has settled: a written grant closes the sheet in the SAME update. */
  const closeConfirm = () => {
    setTarget(null);
    const row = granted.current;
    if (row) {
      granted.current = null;
      onGranted(row);
    }
  };

  const pending = query !== '' && (search.state === 'idle' || search.q !== query);

  let body: ReactNode;
  if (query === '') {
    body = (
      <p data-grant-hint className="px-4 py-6 text-center text-sm font-normal text-text-tertiary">
        {t('store.grant.hint')}
      </p>
    );
  } else if (pending) {
    body = <CandidateSkeleton count={4} />;
  } else if (search.state === 'error') {
    body = (
      <div data-grant-error className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <p className="text-sm font-normal text-danger">{t('store.grant.errors.search')}</p>
        <Button variant="outline" onClick={() => void runSearch(search.q)}>
          {t('store.errors.retry')}
        </Button>
      </div>
    );
  } else if (search.state === 'done' && search.items.length === 0) {
    body = (
      <EmptyState
        variant="plain"
        icon={SearchX}
        data-testid="grant-no-match"
        title={t('store.grant.noMatch.title')}
        body={t('store.grant.noMatch.body')}
      />
    );
  } else if (search.state === 'done') {
    body = (
      <>
        <ul data-grant-results className="flex flex-col">
          {search.items.map((member) => (
            <li key={member.membershipId} className="border-b border-divider last:border-0">
              <button
                type="button"
                data-grant-candidate={member.membershipId}
                aria-label={t('store.grant.row', { name: member.name })}
                onClick={() => setTarget(member)}
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <Avatar src={avatarUrlFor(member.avatarAssetId)} alt={member.name} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span data-grant-name className="truncate text-sm font-bold text-text">
                    {member.name}
                  </span>
                  <span
                    data-grant-email
                    className="truncate text-xs font-normal text-text-tertiary"
                  >
                    {member.email}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <InfiniteScroll
          hasMore={search.nextCursor !== null}
          enabled={!search.pageFailed}
          onLoadMore={loadMore}
          root={scrollRoot}
          skeleton={<CandidateSkeleton count={3} />}
        />
        {search.pageFailed ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm font-normal text-danger">{t('store.grant.errors.search')}</p>
            <Button
              variant="outline"
              onClick={() =>
                setSearch((current) =>
                  current.state === 'done' ? { ...current, pageFailed: false } : current,
                )
              }
            >
              {t('store.errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={t('store.grant.title')}
        desktopCard={desktop}
        scroll="content"
        initialFocus="first"
      >
        <div data-grant-sheet className="flex shrink-0 flex-col gap-3 px-4 pb-3">
          <p className="text-sm font-normal text-text-secondary">
            {hasCommunities
              ? t('store.grant.helper', { product: productName })
              : t('store.grant.helperNoCommunity', { product: productName })}
          </p>
          <SearchBar
            id="grant-access-search"
            value={value}
            onChange={(next) => setValue(next.slice(0, ADMIN_MEMBERS_MAX_QUERY_LENGTH))}
            ariaLabel={t('store.grant.search')}
            placeholder={t('store.grant.search')}
            clearLabel={t('store.grant.clear')}
          />
        </div>
        <div
          ref={setScrollRoot}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
        >
          {body}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={target !== null}
        tone="brand"
        icon={UserPlus}
        title={target ? t('store.grant.confirm.title', { name: target.name }) : ''}
        body={
          target
            ? hasCommunities
              ? t('store.grant.confirm.body', { name: target.name, product: productName })
              : t('store.grant.confirm.bodyNoCommunity', {
                  name: target.name,
                  product: productName,
                })
            : undefined
        }
        confirmLabel={t('store.grant.confirm.confirm')}
        cancelLabel={t('store.grant.confirm.cancel')}
        onConfirm={confirmGrant}
        onClose={closeConfirm}
      />
    </>
  );
}
