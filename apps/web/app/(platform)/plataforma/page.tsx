import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { TenantTable, TenantTableSkeleton } from '@/components/platform/TenantTable';
import { TenantToolbar } from '@/components/platform/TenantToolbar';
import { parseTenantListQuery, requirePlatformTenants, toTenantRow } from '@/lib/platform';
import { loadMoreTenantsAction } from './actions';

type SearchParams = Record<string, string | string[] | undefined>;

async function TenantList({ query }: { query: ReturnType<typeof parseTenantListQuery> }) {
  const [t, page] = await Promise.all([
    getTranslations('platform'),
    // Re-proves the authorisation for this segment (D-23) and fetches the first page.
    requirePlatformTenants(query),
  ]);
  const rows = page.tenants.map((item) =>
    toTenantRow(item, (count) => t('modulesCount', { count })),
  );
  return (
    <TenantTable
      rows={rows}
      nextCursor={page.nextCursor}
      query={{ q: query.q, status: query.status, banco: query.banco, limit: query.limit }}
      loadMoreAction={loadMoreTenantsAction}
      labels={{
        colTenant: t('list.colTenant'),
        colPrimaryHost: t('list.colPrimaryHost'),
        colModules: t('list.colModules'),
        colStatus: t('list.colStatus'),
        colDatabase: t('list.colDatabase'),
        colCreatedAt: t('list.colCreatedAt'),
        noHost: t('list.noHost'),
        active: t('tenantStatus.active'),
        suspended: t('tenantStatus.suspended'),
        loadMore: t('list.loadMore'),
        loadingMore: t('list.loadingMore'),
        emptyTitle: t('list.emptyTitle'),
        emptyBody: t('list.emptyBody'),
        searchEmptyTitle: t('list.searchEmptyTitle'),
        searchEmptyBody: t('list.searchEmptyBody'),
        databaseEmptyTitle: t('list.databaseEmpty.title'),
        databaseEmptyBody: t('list.databaseEmpty.body'),
        new: t('list.new'),
      }}
    />
  );
}

/**
 * `/plataforma` — the tenant list (ROLE-05, D-33 `tenant-list`): the title row with the screen's
 * single brand-filled element ("Novo tenant"), then the table streamed behind a Suspense boundary
 * (5 Skeleton rows meanwhile). `q`, `status` and `limit` are forwarded to the API contract — the
 * browser never filters. `status` and `banco` ("Banco com problema") are one single-select chip row,
 * so the page forwards at most one of them (`banco` wins in a hand-typed URL).
 */
export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [t, sp] = await Promise.all([getTranslations('platform'), searchParams]);
  const query = parseTenantListQuery(sp);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-text">{t('list.title')}</h1>
        <LinkButton href="/plataforma/novo" variant="brand" className="w-full md:w-auto">
          <Plus aria-hidden size={18} />
          {t('list.new')}
        </LinkButton>
      </div>

      <TenantToolbar
        q={query.q}
        status={query.status}
        banco={query.banco}
        limit={query.explicitLimit ? query.limit : undefined}
      />

      <div className="mt-4">
        <Suspense
          key={`${query.q ?? ''}|${query.status ?? ''}|${query.banco ?? ''}|${query.limit}`}
          fallback={<TenantTableSkeleton />}
        >
          <TenantList query={query} />
        </Suspense>
      </div>
    </div>
  );
}
