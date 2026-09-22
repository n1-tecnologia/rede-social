'use client';

import type { MemberProfile } from '@tria/contracts/profiles';
import {
  Button,
  Card,
  EmptyState,
  PullToRefresh,
  SearchBar,
  Skeleton,
  useDebounce,
} from '@tria/ui';
import { CircleAlert, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState, useTransition } from 'react';
import { MemberRow } from '@/components/profile/MemberRow';
import { loadMoreMembersAction } from './actions';

export interface MembersListProps {
  /** The first page the SERVER rendered for the URL's `?q=` — the list is seeded from it. */
  initialItems: MemberProfile[];
  initialCursor: string | null;
  /** The URL's `?q=`, normalised by the page. The URL is the source of truth, not this component. */
  q: string;
  /** `true` when the server could not read the first page at all (UI-SPEC E4/error). */
  initialError?: boolean;
}

/** Eight rows: the loading shape of the directory on the first load and on every query change (E4/loading). */
const SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index);

/** The 8-row skeleton, shared with `loading.tsx` so both loads look identical. */
export function MembersSkeleton() {
  return (
    <div aria-busy data-testid="members-skeleton" className="flex flex-col">
      {SKELETON_ROWS.map((index) => (
        <div
          key={index}
          className="flex min-h-14 items-center gap-3 border-b border-divider px-4 py-3 last:border-0"
        >
          <Skeleton variant="circle" className="h-10 w-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="45%" className="h-3.5" />
            <Skeleton variant="text" width="70%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function listUrl(q: string): string {
  return q ? `/membros?q=${encodeURIComponent(q)}` : '/membros';
}

/**
 * The member directory's body (PROF-03, UI-SPEC §Member directory).
 *
 * **The URL is the source of truth.** The field is debounced 300 ms and written to `?q=` with
 * `router.replace` inside a transition, so back/forward restore the query and the pending state of
 * that navigation is what renders the eight skeletons. The server answers with a fresh first page;
 * a query change therefore RESETS the list and the cursor and can never append across queries.
 *
 * **Pagination is keyset** (R-11): "Carregar mais" renders exactly while the API returned a non-null
 * `nextCursor`, appends the next page without re-ordering or replacing anything already rendered,
 * and keeps the existing rows visible while it is pending. There is no infinite scroll.
 *
 * Matching is the API's — accent- and case-insensitive substring (R-10). Nothing here filters,
 * re-sorts or highlights: `goncal` finding `João Gonçalves` is a property of
 * `app.imm_unaccent(lower(display_name))`, and the UI makes no promise of highlighting.
 */
export function MembersList({ initialItems, initialCursor, q, initialError }: MembersListProps) {
  const t = useTranslations('members');
  const router = useRouter();

  const [value, setValue] = useState(q);
  const debounced = useDebounce(value, 300);
  const [navigating, startNavigation] = useTransition();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(Boolean(initialError));
  const [loadingMore, startLoadMore] = useTransition();

  // The server answered a NEW query: re-seed from its page rather than merging into the old one.
  // Adjusting state during render (React's documented alternative to an effect) keeps the list and
  // the URL in lockstep without a paint of the previous query's rows.
  const [renderedQuery, setRenderedQuery] = useState(q);
  const [renderedItems, setRenderedItems] = useState(initialItems);
  if (renderedQuery !== q || renderedItems !== initialItems) {
    setRenderedQuery(q);
    setRenderedItems(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFailed(Boolean(initialError));
  }

  useEffect(() => {
    const next = debounced.trim();
    if (next === q) return;
    startNavigation(() => {
      router.replace(listUrl(next));
    });
  }, [debounced, q, router]);

  const loadMore = () => {
    if (!cursor) return;
    const from = cursor;
    startLoadMore(async () => {
      try {
        const page = await loadMoreMembersAction(from, q || undefined);
        if (!page.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        // APPEND: the rows already on screen keep their order and their DOM position.
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      } catch (error) {
        console.error('members.load_more_failed', { error: String(error) });
        setFailed(true);
      }
    });
  };

  const refresh = () => {
    startNavigation(() => {
      router.refresh();
    });
  };

  const retry = () => {
    setFailed(false);
    if (cursor) {
      loadMore();
      return;
    }
    startNavigation(() => {
      router.refresh();
    });
  };

  const searching = q.length > 0;
  const busy = navigating;

  /** Singular and plural are two catalog entries, never one string with a condition — E4/zero-one-many. */
  let resultAnnouncement = '';
  if (searching && !busy && !failed) {
    resultAnnouncement =
      items.length === 1 ? t('results.one') : t('results.other', { count: items.length });
  }

  const errorState = (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={t('errors.title')}
      body={t('errors.generic')}
      action={
        <Button variant="outline" onClick={retry}>
          {t('errors.retry')}
        </Button>
      }
    />
  );

  let body: ReactNode;
  if (busy) {
    body = <MembersSkeleton />;
  } else if (failed && items.length === 0) {
    body = errorState;
  } else if (items.length === 0) {
    body = searching ? (
      <EmptyState
        variant="card"
        icon={Users}
        title={t('searchEmpty.title')}
        body={t('searchEmpty.body')}
      />
    ) : (
      <EmptyState variant="card" icon={Users} title={t('empty.title')} body={t('empty.body')} />
    );
  } else {
    body = (
      <>
        <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
          <ul className="flex flex-col">
            {items.map((member, index) => (
              <li
                key={member.membershipId}
                className={index === items.length - 1 ? undefined : 'border-b border-divider'}
              >
                <MemberRow
                  membershipId={member.membershipId}
                  displayName={member.displayName}
                  avatarAssetId={member.avatarAssetId}
                  bio={member.bio}
                />
              </li>
            ))}
          </ul>
        </Card>

        {failed ? <div className="mt-4">{errorState}</div> : null}

        {!failed && cursor !== null ? (
          <div className="mt-4 px-4 md:px-0">
            <Button variant="outline" fullWidth loading={loadingMore} onClick={loadMore}>
              {loadingMore ? t('loadingMore') : t('loadMore')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="flex flex-col">
        {/* Sticky UNDER the `PageHeader`, not beside it. The page pins the header at the scroll
            container's padding edge (`stickyTop="0px"`), and the header is 52px tall (a 44px control
            plus `py-1`), so the pill pins exactly 3.25rem lower — which is also its natural offset,
            so nothing moves until the list is actually scrolled. Pinning both at the same offset, as
            a literal reading of the UI-SPEC's `top-[calc(var(--safe-top)+3rem)]` would, puts the
            z-40 header ON TOP of the field and "Limpar busca" stops being tappable. On `md:` the
            header is static, so the pill owns the top of the column. */}
        <div className="sticky top-[3.25rem] z-30 bg-bg/95 px-4 pt-2 pb-3 backdrop-blur-sm md:top-0">
          <SearchBar
            id="members-search"
            value={value}
            onChange={setValue}
            ariaLabel={t('search.label')}
            placeholder={t('search.placeholder')}
            clearLabel={t('search.clear')}
          />
        </div>

        {/* Announced only once the debounced query has settled and the server has answered — never
            on every keystroke (UI-SPEC §Motion & Accessibility, E4/zero-one-many). */}
        <p aria-live="polite" data-testid="members-count" className="sr-only">
          {resultAnnouncement}
        </p>

        {body}
      </div>
    </PullToRefresh>
  );
}
