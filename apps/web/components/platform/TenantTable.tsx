'use client';

import type { DatabaseState, TokenState } from '@rede-social/contracts/projects';
import { Button, Card, EmptyState, Skeleton, StatusPill } from '@rede-social/ui';
import { Building2, ChevronRight, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { DatabasePill } from '@/components/platform/DatabasePill';
import { TokenPill, tokenNeedsAttention } from '@/components/platform/TokenPill';
import type { TenantRowView } from '@/lib/platform';

export type TenantListQuery = {
  q?: string;
  status?: 'active' | 'suspended';
  /** `?banco=problema` (09.2-20, UI-D-540): mutually exclusive with `status`. */
  banco?: 'problema';
  limit: number;
};

export interface TenantTableLabels {
  colTenant: string;
  colPrimaryHost: string;
  colModules: string;
  colStatus: string;
  colDatabase: string;
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
  databaseEmptyTitle: string;
  databaseEmptyBody: string;
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

/** The states whose list cell carries no schema line (UI-D-540): nothing is applied yet, or a move holds it. */
const NO_SCHEMA_LINE: readonly DatabaseState[] = ['preparing', 'preparation_failed', 'moving'];

/** The token state of a row when it earns a pill (`database.token` is absent or null for a platform row). */
function tokenAttention(database: TenantRowView['database']): TokenState | null {
  const state = database?.token?.state;
  return state && tokenNeedsAttention(state) ? state : null;
}

/** The "Token: {state}" pill of a row, or nothing (the mobile card's pills line). */
function RowTokenPill({ database }: { database: TenantRowView['database'] }) {
  const state = tokenAttention(database);
  return state ? <TokenPill state={state} prefixed data-testid="row-token-pill" /> : null;
}

/**
 * The Banco cell of a row (UI-D-540): the shared `DatabasePill` (UI-D-539, its words and tones come
 * from `databasePillProps`, never from here) and, under it, the schema line
 * "Esquema 147" or "Esquema 144 de 147". A row without the fact reads "Não verificado" (P103) and
 * the line stays out whenever a count is unknown, so nothing is invented. The list keeps the API's
 * order whatever the pill says (P102): this component only renders.
 *
 * 09.4-16 (UI-D-560, CTK-41): a customer project whose token needs attention gets a second pill, "Token:
 * {state}", under the Banco pill and the schema line (`mt-1`); a platform row and a Válido or Não verificado
 * token show none.
 */
function DatabaseCell({ database }: { database: TenantRowView['database'] }) {
  const t = useTranslations('platform.list');
  const state: DatabaseState = database?.state ?? 'unchecked';
  const tokenState = tokenAttention(database);
  const applied = database?.schema.applied ?? null;
  const required = database?.schema.required ?? null;
  const line =
    NO_SCHEMA_LINE.includes(state) || applied === null
      ? null
      : required !== null && applied < required
        ? t('schemaBehind', { applied, required })
        : t('schema', { applied });
  return (
    <>
      <DatabasePill state={state} />
      {line ? (
        <p
          className="mt-1 text-xs font-normal tabular-nums text-text-tertiary"
          data-testid="schema-line"
        >
          {line}
        </p>
      ) : null}
      {tokenState ? (
        <div className="mt-1">
          <RowTokenPill database={database} />
        </div>
      ) : null}
    </>
  );
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
    if (query.banco) {
      return (
        <EmptyState
          variant="card"
          icon={SearchX}
          title={labels.databaseEmptyTitle}
          body={labels.databaseEmptyBody}
        />
      );
    }
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
                className="w-[24%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colTenant}
              </th>
              <th
                scope="col"
                className="w-[22%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colPrimaryHost}
              </th>
              <th
                scope="col"
                className="w-[12%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colModules}
              </th>
              <th
                scope="col"
                className="w-[12%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colStatus}
              </th>
              <th
                scope="col"
                className="w-[18%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
              >
                {labels.colDatabase}
              </th>
              <th
                scope="col"
                className="w-[12%] px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-tertiary"
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
                <td className="px-4 py-3 align-middle">
                  <DatabaseCell database={row.database} />
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
                <div className="mt-1 flex flex-wrap gap-1">
                  <DatabasePill state={row.database?.state ?? 'unchecked'} />
                  <RowTokenPill database={row.database} />
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
            <div className="flex w-[24%] flex-col gap-2">
              <Skeleton width="70%" />
              <Skeleton width="45%" className="h-3" />
            </div>
            <Skeleton width="20%" />
            <Skeleton width="10%" />
            <Skeleton width="10%" className="rounded-full" />
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
