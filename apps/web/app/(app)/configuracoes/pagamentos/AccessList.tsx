'use client';

import { PAYMENTS_MAX_QUERY } from '@rede-social/contracts/payments';
import type { AccessItem } from '@rede-social/module-payments/contracts';
import { AccessRow, AccessRowSkeleton } from '@rede-social/module-payments/ui';
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
import { CircleAlert, Mail, UserPlus } from 'lucide-react';
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
import {
  ACCESS_FILTERS,
  type AccessFilter,
  type AccessViewCtx,
  accessListHref,
  accessRowView,
  accessSheetView,
  type PaymentsTranslator,
} from '@/lib/payments-view';
import { type AccessSettled, AccessSheet } from './AccessSheet';
import { loadMoreAccessesAction } from './actions';
import { ReleaseEmailSheet, type ReleaseSettled } from './ReleaseEmailSheet';

export interface AccessListProps {
  /** Page 1 for the URL's `?q=` and `?status=`, read on the server. */
  initialItems: AccessItem[];
  initialCursor: string | null;
  /** The API's own clock for page 1: "Atualizado {when}" never reads the browser's. */
  serverNow: string;
  /** The URL's `?q=`, trimmed and capped by the page. The URL is the source of truth. */
  q: string;
  /** The URL's `?status=`, normalised by the page: an unknown value is `all`. */
  status: AccessFilter;
  /** `true` when the server could not read page 1 at all (the first-load failure). */
  initialError?: boolean;
  /** The adapter's display name: the source word of every gateway row. */
  gatewayName: string;
  /** The tenant's display name, for the dialog bodies. */
  tenantName: string;
  /** The tenant's IANA zone: every date is written in it. */
  timeZone: string;
  /** The gate is on (from the overview): the sheet's note about a block (Task 2). */
  gateRequired: boolean;
}

/** Catalog key of each filter chip: the contract value is snake_case, the catalog key is not. */
const FILTER_KEY: Record<AccessFilter, string> = {
  all: 'all',
  active: 'active',
  subscription_pending: 'pending',
  blocked: 'blocked',
};

/** The success toast of each change an access sheet can settle. */
const CHANGE_TOAST = {
  block: 'payments.toasts.blocked',
  unblock: 'payments.toasts.unblocked',
  removeRelease: 'payments.toasts.releaseRemoved',
} as const;

/**
 * How long the info toast of a release the gateway has cut stays up. The line is longer than the
 * default duration and nothing was admitted, so the admin needs time to read it (A-G4).
 */
const NOTICE_TOAST_MS = 6000;

/**
 * The Acessos list (09.1-14, PAY-22, UI-D-517, D-487, D-489, D-504): one row per e-mail, each opening
 * the access sheet. It is the `AdminMembersList` machine copied for a different row, not shared with it
 * (planning decision 1): the two screens change for different reasons.
 *
 * - **The URL is the query.** The search field is debounced 300 ms into `?q=` and the chip row is bound
 *   to `?status=`, both through `router.replace` inside a transition, so back/forward restore both.
 *   While that navigation is pending the list shows 8 row skeletons. The server renders page 1 for the
 *   new URL and this component RE-SEEDS from it during render (React's documented alternative to an
 *   effect), so the previous query's rows never paint under the new one.
 * - **Keyset paging through `InfiniteScroll`.** A page APPENDS, dropping any row already held; a
 *   GENERATION guard drops a page that started before a query change or a refresh replaced the list.
 * - **States.** First-load failure: the card `EmptyState` with a retry. Load-more failure: an inline
 *   line plus a retry with every loaded row kept. Empty: one set of words per situation.
 * - **The server settles every row.** The web never decides who has access: the pill, the source and
 *   the actions are renderings of the server's `state`, `source`, `hasAccount` and `validUntil`, and a
 *   block or an unblock updates ONLY that row, in place, from the server's answer.
 */
export function AccessList({
  initialItems,
  initialCursor,
  serverNow,
  q,
  status,
  initialError,
  gatewayName,
  tenantName,
  timeZone,
  gateRequired,
}: AccessListProps) {
  const t = useTranslations();
  const tView = t as unknown as PaymentsTranslator;
  const router = useRouter();
  const toast = useToast();
  const [navigating, startNavigation] = useTransition();

  const [value, setValue] = useState(q);
  const debounced = useDebounce(value, 300);

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [clock, setClock] = useState(serverNow);
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
    setClock(serverNow);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
    // Back/forward changed the URL under the field: the field follows the URL. A URL the field itself
    // just wrote is left alone, so a trailing space being typed is never eaten.
    if (seeded.q !== q && value.trim().slice(0, PAYMENTS_MAX_QUERY) !== q) setValue(q);
  }

  // The debounced field drives `?q=`, capped like the contract so it never widens the request. It fires
  // only when the FIELD settled on a new value: a back/forward that changed `q` under it must not push
  // the field's stale value back onto the URL while the field catches up.
  const lastDebounced = useRef(debounced);
  useEffect(() => {
    if (lastDebounced.current === debounced) return;
    lastDebounced.current = debounced;
    const next = debounced.trim().slice(0, PAYMENTS_MAX_QUERY);
    if (next === q) return;
    startNavigation(() => {
      router.replace(accessListHref(next, status), { scroll: false });
    });
  }, [debounced, q, status, router]);

  const choose = (next: AccessFilter) => {
    if (next === status) return;
    startNavigation(() => {
      router.replace(accessListHref(q, next), { scroll: false });
    });
  };

  const forbidden = useCallback(() => {
    toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
    router.refresh();
  }, [router, t, toast]);

  const apiStatus = status === 'all' ? null : status;

  const loadMore = useCallback(async () => {
    if (cursor === null) return;
    const mine = generation;
    const stale = () => committedGeneration.current !== mine;
    try {
      const page = await loadMoreAccessesAction(cursor, q || null, apiStatus);
      if (stale()) return;
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setPageFailed(true);
        return;
      }
      setItems((previous) => {
        const held = new Set(previous.map((row) => row.id));
        return [...previous, ...page.items.filter((row) => !held.has(row.id))];
      });
      setCursor(page.nextCursor);
      setClock(page.serverNow);
      setPageFailed(false);
    } catch (error) {
      if (stale()) return;
      console.error('payments.access.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [apiStatus, cursor, forbidden, generation, q]);

  /** Page 1 again for the current URL: what the pull and the first-load retry call. */
  const refresh = useCallback(async () => {
    try {
      const page = await loadMoreAccessesAction(null, q || null, apiStatus);
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setGeneration((current) => current + 1);
      setItems(page.items);
      setCursor(page.nextCursor);
      setClock(page.serverNow);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('payments.access.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [apiStatus, forbidden, items.length, q]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);
  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  /* ── The sheet ─────────────────────────────────────────────────────────────────────────────── */

  const [selected, setSelected] = useState<AccessItem | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const ctx: AccessViewCtx = { gatewayName, timeZone, serverNow: clock, gateRequired };

  /* ── "Liberar e-mail" ──────────────────────────────────────────────────────────────────────── */

  const [releaseOpen, setReleaseOpen] = useState(false);
  /** A new key per opening: the sheet remounts, so every opening starts with an empty field. */
  const [releaseKey, setReleaseKey] = useState(0);
  const openRelease = useCallback(() => {
    setReleaseKey((current) => current + 1);
    setReleaseOpen(true);
  }, []);
  const closeRelease = useCallback(() => setReleaseOpen(false), []);

  const onSettled = useCallback(
    (outcome: AccessSettled) => {
      setOpen(false);
      if (outcome.kind === 'changed') {
        setClock(outcome.serverNow);
        const updated = outcome.access;
        if (updated === null) {
          setItems((rows) => rows.filter((row) => row.email !== outcome.email));
        } else {
          setItems((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
          setSelected(updated);
        }
        toast.show({
          tone: 'success',
          message: t(CHANGE_TOAST[outcome.change], { email: outcome.email }),
        });
        return;
      }
      if (outcome.kind === 'gone') {
        setItems((rows) => rows.filter((row) => row.email !== outcome.email));
        toast.show({ tone: 'error', message: t('payments.toasts.accessGone') });
      } else {
        toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
      }
      router.refresh();
    },
    [router, t, toast],
  );

  const onReleaseSettled = useCallback(
    (outcome: ReleaseSettled) => {
      setReleaseOpen(false);
      if (outcome.kind === 'released') {
        setClock(outcome.serverNow);
        const created = outcome.access;
        // The row goes to the TOP from the server's answer; an address the list already holds moves
        // there instead of repeating.
        if (created !== null) {
          setItems((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
          setFirstLoadFailed(false);
        }
        // The toast follows the state the SERVER gave back, never the fact that the request answered
        // 200 (D-489, A-P9 confirmed, A-G1): a gateway cut outranks a manual release, so the address
        // may still be without access, and a block that landed first must not read as a success.
        const state = outcome.access?.state;
        if (state === 'subscription_pending') {
          toast.show({
            tone: 'info',
            message: t('payments.toasts.releasedStaysCut', { email: outcome.email }),
            durationMs: NOTICE_TOAST_MS,
          });
        } else if (state === 'blocked') {
          toast.show({ tone: 'error', message: t('payments.errors.emailBlocked') });
        } else {
          toast.show({
            tone: 'success',
            message: t('payments.toasts.released', { email: outcome.email }),
          });
        }
        if (created === null) router.refresh();
        return;
      }
      if (outcome.kind === 'gone') {
        toast.show({ tone: 'error', message: t('payments.toasts.accessGone') });
      } else {
        toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
      }
      router.refresh();
    },
    [router, t, toast],
  );

  /* ── Render ────────────────────────────────────────────────────────────────────────────────── */

  const shell =
    'rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]';

  let body: ReactNode;
  if (navigating) {
    body = (
      <Card className={shell}>
        <AccessRowSkeleton count={8} />
      </Card>
    );
  } else if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          title={t('payments.errors.title')}
          body={t('payments.errors.access')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('payments.errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    let empty: 'empty' | 'searchEmpty' | 'activeEmpty' | 'pendingEmpty' | 'blockedEmpty' = 'empty';
    if (q) empty = 'searchEmpty';
    else if (status === 'active') empty = 'activeEmpty';
    else if (status === 'subscription_pending') empty = 'pendingEmpty';
    else if (status === 'blocked') empty = 'blockedEmpty';
    body = (
      <div className="px-4 md:px-0" data-access-empty={empty}>
        <EmptyState
          variant="card"
          icon={Mail}
          title={t(`payments.access.${empty}.title`)}
          body={t(`payments.access.${empty}.body`)}
          action={
            empty === 'empty' ? (
              <Button variant="outline" onClick={openRelease}>
                {t('payments.access.empty.action')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <Card className={shell}>
        <ul aria-label={t('payments.access.listLabel')} data-access-list>
          {items.map((item) => {
            const row = accessRowView(item, tView, ctx);
            return (
              <li key={item.id} className="border-b border-divider last:border-0">
                <AccessRow
                  email={row.email}
                  state={row.state}
                  stateLabel={row.stateLabel}
                  sourceLabel={row.sourceLabel}
                  hasAccount={row.hasAccount}
                  noAccountLabel={row.noAccountLabel}
                  validityLabel={row.validityLabel}
                  onOpen={() => {
                    setSelected(item);
                    setOpen(true);
                  }}
                />
              </li>
            );
          })}
        </ul>
        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<AccessRowSkeleton count={3} />}
        />
        {pageFailed ? (
          <div
            data-access-page-error
            className="flex flex-col items-center gap-3 px-4 py-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('payments.errors.loadMoreAccess')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('payments.errors.retry')}
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div data-testid="payments-access" className="flex flex-col gap-2 pb-6">
          {/* Sticky UNDER the `PageHeader` exactly as the Membros toolbar is (`top-[2.75rem]`, 24px of
              scroll after the header pins); on `md:` the header is static, so the toolbar owns the top. */}
          <div
            data-access-toolbar
            className="sticky top-[2.75rem] z-30 bg-bg/95 px-4 pt-2 pb-3 backdrop-blur-sm md:top-0 md:px-0"
          >
            {/* UI-D-517: the "Liberar e-mail" button sits beside the field from 360px up and wraps
                under it at full width below that. */}
            <div className="flex flex-wrap items-center gap-2">
              <SearchBar
                id="payments-access-search"
                value={value}
                onChange={(next) => setValue(next.slice(0, PAYMENTS_MAX_QUERY))}
                ariaLabel={t('payments.access.search')}
                placeholder={t('payments.access.search')}
                clearLabel={t('payments.access.clear')}
                className="min-w-0 basis-full min-[360px]:basis-0 min-[360px]:flex-1"
              />
              <Button
                data-access-release
                variant="outline"
                size="sm"
                hitArea
                onClick={openRelease}
                className="w-full min-[360px]:w-auto min-[360px]:shrink-0"
              >
                <UserPlus aria-hidden size={16} />
                {t('payments.access.release')}
              </Button>
            </div>
            {/* UI-D-517: four chips that scroll sideways at 320px and never wrap, with no scrollbar. */}
            <div
              data-access-filters
              className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {ACCESS_FILTERS.map((filter) => (
                <Chip
                  key={filter}
                  active={filter === status}
                  onClick={() => choose(filter)}
                  className="shrink-0"
                >
                  {t(`payments.access.filters.${FILTER_KEY[filter]}`)}
                </Chip>
              ))}
            </div>
          </div>
          {body}
        </div>
      </PullToRefresh>
      <ReleaseEmailSheet
        key={releaseKey}
        open={releaseOpen}
        onClose={closeRelease}
        onSettled={onReleaseSettled}
      />
      <AccessSheet
        open={open}
        view={selected ? accessSheetView(selected, tView, ctx) : null}
        tenantName={tenantName}
        onClose={close}
        onSettled={onSettled}
      />
    </>
  );
}
