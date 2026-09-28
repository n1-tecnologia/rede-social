'use client';

import { Button, Card, EmptyState, Skeleton, StatusPill } from '@rede-social/ui';
import { Building2, ChevronRight, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import type { TenantRowView } from '@/lib/platform';

export type TenantListQuery = { q?: string; status?: 'active' | 'suspended'; limit: number };

export interface TenantTableLabels {
  colTenant: string;
  colPrimaryHost: string;
  colModules: string;
  colStatus: string;
  colCreatedAt: string;
  noHost: string;
  active: string;
  suspended: string;
  loadMore: string;
  loadingMore: string;
  emptyTitle: string;
  emptyBody: string;
  searchEmptyTitle: string;
  searchEmptyBody: string;
  new: string;
}

export interface TenantTableProps {
  rows: TenantRowView[];
  nextCursor: string | null;
  query: TenantListQuery;
  labels: TenantTableLabels;
  /** `loadMoreTenantsAction` — appends the next page while the API answers `nextCursor` (02-12 Task 2). */
  loadMoreAction?: (
    query: TenantListQuery & { cursor: string },
  ) => Promise<{ rows: TenantRowView[]; nextCursor: string | null }>;
}

const rowLink =
  'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand';

function statusTone(status: TenantRowView['status']): 'success' | 'danger' {
  return status === 'active' ? 'success' : 'danger';
}

/**
 * The tenant list body (D-33 `tenant-list`): a table in a Card on desktop, one Card per tenant below
 * `md` (no horizontal scroll). The WHOLE row is a link — a stretched `next/link` in the first cell
 * whose accessible name is "display name (slug)" so two tenants with the same name stay
 * distinguishable (edge ROLE-05/adjacency) — and every row links BY ID, never by name or slug.
 * Cell content is React text only (T-02-63); dates and plurals arrive pre-rendered from the server.
 */
export function TenantTable({
  rows: initialRows,
  nextCursor: initialCursor,
  query,
  labels,
  loadMoreAction,
}: TenantTableProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, startTransition] = useTransition();

  const loadMore = () => {
    if (!loadMoreAction || !cursor) return;
    const next = cursor;
    startTransition(async () => {
      const page = await loadMoreAction({ ...query, cursor: next });
      setRows((prev) => [...prev, ...page.rows]);
      setCursor(page.nextCursor);
    });
  };

  if (rows.length === 0) {
    const filtered = Boolean(query.q) || Boolean(query.status);
    return filtered ? (
      <EmptyState
        variant="card"
        icon={SearchX}
        title={labels.searchEmptyTitle}
        body={labels.searchEmptyBody}
      />
    ) : (
      <EmptyState
        variant="card"
        icon={Building2}
        title={labels.emptyTitle}
        body={labels.emptyBody}
        action={
          <LinkButton href="/plataforma/novo" variant="brand">
            <Plus aria-hidden size={18} />
            {labels.new}
          </LinkButton>
        }
      />
    );
  }

  return (
    <>
      <Card className="hidden md:block">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-[30%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colTenant}
              </th>
              <th
                scope="col"
                className="w-[28%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colPrimaryHost}
              </th>
              <th
                scope="col"
                className="w-[14%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colModules}
              </th>
              <th
                scope="col"
                className="w-[14%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colStatus}
              </th>
              <th
                scope="col"
                className="w-[14%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colCreatedAt}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="relative min-h-14 border-b border-divider transition-colors last:border-0 hover:bg-card-hover"
              >
                <td className="px-4 py-3 align-middle">
                  <Link
                    href={`/plataforma/tenants/${row.id}`}
                    aria-label={`${row.displayName} (${row.slug})`}
                    className={`block min-w-0 ${rowLink}`}
                  >
                    <span
                      className="block truncate text-sm font-bold text-text"
                      title={row.displayName}
                    >
                      {row.displayName}
                    </span>
                    <span className="block truncate text-xs text-text-tertiary" title={row.slug}>
                      {row.slug}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 align-middle text-sm text-text">
                  {row.primaryHost ? (
                    <span className="block truncate" title={row.primaryHost}>
                      {row.primaryHost}
                    </span>
                  ) : (
                    <StatusPill tone="warning">{labels.noHost}</StatusPill>
                  )}
                </td>
                <td className="px-4 py-3 align-middle text-sm tabular-nums text-text">
                  {row.modulesLabel}
                </td>
                <td className="px-4 py-3 align-middle">
                  <StatusPill tone={statusTone(row.status)}>
                    {row.status === 'active' ? labels.active : labels.suspended}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 align-middle text-xs tabular-nums text-text-secondary">
                  {row.createdAtLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <Card className="relative flex min-h-14 items-center gap-3 p-4 transition-colors hover:bg-card-hover">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/plataforma/tenants/${row.id}`}
                    aria-label={`${row.displayName} (${row.slug})`}
                    className={`line-clamp-2 min-w-0 text-sm font-bold text-text ${rowLink}`}
                  >
                    {row.displayName}
                  </Link>
                  <StatusPill tone={statusTone(row.status)}>
                    {row.status === 'active' ? labels.active : labels.suspended}
                  </StatusPill>
                </div>
                <div className="flex min-w-0 items-center gap-1 text-xs text-text-tertiary">
                  <span className="truncate" title={row.slug}>
                    {row.slug}
                  </span>
                  <span aria-hidden>·</span>
                  {row.primaryHost ? (
                    <span className="truncate" title={row.primaryHost}>
                      {row.primaryHost}
                    </span>
                  ) : (
                    <span className="text-warning">{labels.noHost}</span>
                  )}
                </div>
              </div>
              <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
            </Card>
          </li>
        ))}
      </ul>

      {cursor !== null && loadMoreAction ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" loading={pending} onClick={loadMore}>
            {pending ? labels.loadingMore : labels.loadMore}
          </Button>
        </div>
      ) : null}
    </>
  );
}

const SKELETON_ROWS = [0, 1, 2, 3, 4] as const;

/** Five placeholder rows with the table's geometry (E10/loading); Card rows below `md`. */
export function TenantTableSkeleton() {
  return (
    <>
      <Card className="hidden md:block">
        <div className="flex h-10 items-center border-b border-border px-4">
          <Skeleton width="40%" />
        </div>
        {SKELETON_ROWS.map((i) => (
          <div
            key={i}
            className="flex min-h-14 items-center gap-4 border-b border-divider px-4 last:border-0"
          >
            <div className="flex w-[30%] flex-col gap-2">
              <Skeleton width="70%" />
              <Skeleton width="45%" className="h-3" />
            </div>
            <Skeleton width="20%" />
            <Skeleton width="10%" />
            <Skeleton width="10%" className="rounded-full" />
            <Skeleton width="10%" />
          </div>
        ))}
      </Card>
      <ul className="flex flex-col gap-3 md:hidden">
        {SKELETON_ROWS.map((i) => (
          <li key={i}>
            <Card className="flex min-h-14 flex-col gap-2 p-4">
              <Skeleton width="60%" />
              <Skeleton width="40%" className="h-3" />
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
