'use client';

import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  StatusPill,
  useToast,
} from '@rede-social/ui';
import { CircleAlert, UserMinus, UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { BuyerRowView } from '@/lib/store-view';
import { loadMoreBuyersAction, revokeAccessAction } from './actions';
import { GrantAccessSheet } from './GrantAccessSheet';

export interface BuyersListProps {
  productId: string;
  productName: string;
  /** The product unlocks at least one active community (and the module is on): picks the copy. */
  hasCommunities: boolean;
  /** The tenant's display name, for the grant sheet's member-gone copy. */
  tenantName: string;
  /** Page 1 as the SERVER read and formatted it; the list owns every page after it. */
  initialItems: BuyerRowView[];
  initialCursor: string | null;
  /** The exact count of active holders (`total`), which the toolbar line reads. */
  initialTotal: number;
  /** `true` when the server could not read page 1 at all (UI-D-384 first-load failure). */
  initialError?: boolean;
}

/** The "Conceder acesso" button's DOM id: where focus lands when no row is left to focus. */
export const BUYERS_GRANT_BUTTON_ID = 'store-buyers-grant';

/**
 * `count` rows in the `AttendeeRow` geometry (UI-D-384): a 32px circle, two bars and the trailing
 * tag-and-control shape, so nothing shifts when the real rows swap in. 8 in `loading.tsx`, 3 at the
 * load-more sentinel.
 */
export function BuyersSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="buyers-skeleton" className="flex flex-col px-4">
      {Array.from({ length: count }, (_, index) => index).map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 border-b border-divider py-2">
          <Skeleton variant="circle" className="h-8 w-8" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" className="w-3/5" />
            <Skeleton variant="text" className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          <Skeleton variant="circle" className="h-8 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** The revoke body by source and by whether the product unlocks communities (four variants). */
function revokeBodyKey(
  row: BuyerRowView,
  hasCommunities: boolean,
): 'purchase' | 'purchaseNoCommunity' | 'grant' | 'grantNoCommunity' {
  if (row.source === 'purchase') return hasCommunities ? 'purchase' : 'purchaseNoCommunity';
  return hasCommunities ? 'grant' : 'grantNoCommunity';
}

/**
 * The "Compradores" body (08.2-11, D-359, D-360, UI-D-380): the toolbar (product name, holder count,
 * "Conceder acesso") and the list of ACTIVE holders, newest first, in the API's order (the web never
 * sorts, P21).
 *
 * - **Rows** are the `AttendeeRow` geometry rebuilt here (the store module must not depend on
 *   events): avatar `sm` with the neutral fallback, the name `truncate`, the server-formatted meta
 *   line, and a trailing `shrink-0` group with the source tag ("Comprado" success / "Concedido"
 *   neutral) and the 44px revoke control named for its person, so a long name ellipsises first.
 *   A removed member reads "Membro removido" with the neutral avatar and keeps the revoke control.
 * - **Paging.** `InfiniteScroll` APPENDS keyset pages (deduplicated by entitlement); a load-more
 *   failure is the inline line plus a retry with every loaded row kept; the mobile pull reloads
 *   page 1.
 * - **Revoke.** The danger `ConfirmDialog` names the person and carries the body for the row's source
 *   and the product's communities. `revoked` removes the row, drops the count and toasts; `gone`
 *   (already revoked elsewhere) removes the row with its own toast; a failure keeps the row. After a
 *   removal, focus moves to the next row's revoke control (the previous one at the end of the list),
 *   or to "Conceder acesso" when no row is left (UI-D-386), once the dialog has closed.
 */
export function BuyersList({
  productId,
  productName,
  hasCommunities,
  initialItems,
  initialCursor,
  tenantName,
  initialTotal,
  initialError,
}: BuyersListProps) {
  const t = useTranslations();
  const { show } = useToast();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [total, setTotal] = useState(initialTotal);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);
  const [revoking, setRevoking] = useState<BuyerRowView | null>(null);
  const [granting, setGranting] = useState(false);
  /** Where focus goes once the revoke dialog has closed: a row's id, or the grant button. */
  const [focusAfter, setFocusAfter] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // The SERVER sent a different first page (a navigation back to this screen): re-seed, never merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setTotal(initialTotal);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  // Runs after the dialog's own focus trap has handed focus back (its opener left with the row).
  useEffect(() => {
    if (focusAfter === null || revoking !== null) return;
    // `Button` takes no ref: the grant button is found by its id.
    const grant = document.getElementById(BUYERS_GRANT_BUTTON_ID);
    const target =
      focusAfter === BUYERS_GRANT_BUTTON_ID
        ? grant
        : (listRef.current?.querySelector<HTMLButtonElement>(
            `[data-buyer-revoke="${CSS.escape(focusAfter)}"]`,
          ) ?? grant);
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter, revoking]);

  /** Page 1 again; the rows never become skeletons (brand loader only). */
  const refresh = useCallback(async () => {
    try {
      const page = await loadMoreBuyersAction(productId, null);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setTotal(page.total);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('store.buyers_refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [items.length, productId]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreBuyersAction(productId, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => {
        const held = new Set(previous.map((row) => row.id));
        return [...previous, ...page.items.filter((row) => !held.has(row.id))];
      });
      setCursor(page.nextCursor);
      setTotal(page.total);
    } catch (error) {
      console.error('store.buyers_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, productId]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => {
    setPageFailed(false);
  }, []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  /** Takes the row out, drops the count, and decides where focus goes once the dialog closes. */
  const removeRow = (row: BuyerRowView) => {
    const index = items.findIndex((item) => item.id === row.id);
    const neighbour = index === -1 ? undefined : (items[index + 1] ?? items[index - 1]);
    setItems((previous) => previous.filter((item) => item.id !== row.id));
    setTotal((previous) => Math.max(0, previous - 1));
    setFocusAfter(neighbour ? neighbour.id : BUYERS_GRANT_BUTTON_ID);
  };

  /** The sheet closed without a grant: focus goes back to "Conceder acesso" (UI-D-386). */
  const closeGrant = useCallback(() => {
    setGranting(false);
    setFocusAfter(BUYERS_GRANT_BUTTON_ID);
  }, []);

  /** A grant wrote a new entitlement: the row goes on top tagged "Concedido" and the count rises. */
  const onGranted = useCallback((row: BuyerRowView) => {
    setItems((previous) => [row, ...previous.filter((item) => item.id !== row.id)]);
    setTotal((previous) => previous + 1);
    setFirstLoadFailed(false);
    setGranting(false);
    setFocusAfter(BUYERS_GRANT_BUTTON_ID);
  }, []);

  const confirmRevoke = async () => {
    const row = revoking;
    if (!row) return;
    let status: 'revoked' | 'gone' | 'error' = 'error';
    try {
      ({ status } = await revokeAccessAction(productId, row.id));
    } catch (error) {
      console.error('store.revoke_action_failed', { error: String(error) });
    }
    if (status === 'revoked') {
      removeRow(row);
      show({ tone: 'success', message: t('store.buyers.revoke.done', { name: row.name }) });
    } else if (status === 'gone') {
      removeRow(row);
      show({ tone: 'info', message: t('store.buyers.errors.revokeGone') });
    } else {
      show({ tone: 'error', message: t('store.buyers.errors.revoke') });
    }
  };

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="buyers-error"
          title={t('store.errors.title')}
          body={t('store.errors.buyers')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('store.errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={Users}
          data-testid="buyers-empty"
          title={t('store.buyers.empty.title')}
          body={t('store.buyers.empty.body')}
        />
      </div>
    );
  } else {
    body = (
      <>
        <ul
          aria-label={t('store.buyers.region', { product: productName })}
          className="flex flex-col px-4"
        >
          {items.map((row) => (
            <li
              key={row.id}
              data-buyer-row={row.id}
              data-source={row.source}
              data-removed={row.removed ? 'true' : undefined}
              className="flex min-h-14 items-center gap-3 border-b border-divider py-2"
            >
              <Avatar src={row.removed ? null : row.avatarUrl} alt={row.name} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col">
                <p
                  data-buyer-name
                  className={
                    row.removed
                      ? 'truncate text-sm font-normal text-text-tertiary'
                      : 'truncate text-sm font-bold text-text'
                  }
                >
                  {row.name}
                </p>
                <p className="truncate text-xs font-normal tabular-nums text-text-tertiary">
                  {row.meta}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StatusPill tone={row.tag.tone} data-buyer-tag={row.source}>
                  {row.tag.label}
                </StatusPill>
                <IconButton
                  icon={UserMinus}
                  size={20}
                  label={row.revokeLabel}
                  data-buyer-revoke={row.id}
                  onClick={() => setRevoking(row)}
                />
              </div>
            </li>
          ))}
        </ul>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<BuyersSkeleton count={3} />}
          className="mt-2"
        />

        {pageFailed ? (
          <div
            data-buyers-page-error
            className="mt-4 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('store.errors.loadMoreBuyers')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('store.errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div data-buyers-toolbar className="flex items-center justify-between gap-3 px-4 pt-3 pb-3">
        <div className="flex min-w-0 flex-col">
          <p data-buyers-product className="truncate text-sm font-bold text-text">
            {productName}
          </p>
          <p data-buyers-count className="text-xs font-normal tabular-nums text-text-tertiary">
            {t('store.buyers.count', { count: total })}
          </p>
        </div>
        <Button
          id={BUYERS_GRANT_BUTTON_ID}
          variant="brand"
          size="sm"
          className="shrink-0"
          aria-haspopup="dialog"
          onClick={() => setGranting(true)}
        >
          <UserPlus aria-hidden size={16} />
          {t('store.buyers.grant')}
        </Button>
      </div>

      <PullToRefresh onRefresh={refresh}>
        <div ref={listRef} data-buyers className="flex flex-col pb-6">
          {body}
        </div>
      </PullToRefresh>

      <GrantAccessSheet
        open={granting}
        onClose={closeGrant}
        productId={productId}
        productName={productName}
        hasCommunities={hasCommunities}
        tenantName={tenantName}
        onGranted={onGranted}
      />

      <ConfirmDialog
        open={revoking !== null}
        tone="danger"
        icon={UserMinus}
        title={revoking ? t('store.buyers.revoke.title', { name: revoking.name }) : ''}
        body={
          revoking
            ? t(`store.buyers.revoke.${revokeBodyKey(revoking, hasCommunities)}`, {
                name: revoking.name,
                product: productName,
              })
            : undefined
        }
        confirmLabel={t('store.buyers.revoke.confirm')}
        cancelLabel={t('store.buyers.revoke.cancel')}
        onConfirm={confirmRevoke}
        onClose={() => setRevoking(null)}
      />
    </>
  );
}
