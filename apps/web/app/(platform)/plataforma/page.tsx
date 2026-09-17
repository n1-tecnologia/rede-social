import { Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { z } from 'zod';
import { LinkButton } from '@/app/(auth)/LinkButton';
import { TenantTable, TenantTableSkeleton } from '@/components/platform/TenantTable';
import { PANEL_PAGE_SIZE, requirePlatformTenants, toTenantRow } from '@/lib/platform';

type SearchParams = Record<string, string | string[] | undefined>;

const qSchema = z.string().trim().min(1).max(60);
const statusSchema = z.enum(['active', 'suspended']);
const limitSchema = z.coerce.number().int().min(1).max(100);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Each parameter is parsed on its own; an invalid one is dropped, never a 500 (T-02-67). */
function parseQuery(sp: SearchParams): {
  q?: string;
  status?: 'active' | 'suspended';
  limit: number;
} {
  const q = qSchema.safeParse(first(sp.q));
  const status = statusSchema.safeParse(first(sp.status));
  const limit = limitSchema.safeParse(first(sp.limit));
  return {
    q: q.success ? q.data : undefined,
    status: status.success ? status.data : undefined,
    limit: limit.success ? limit.data : PANEL_PAGE_SIZE,
  };
}

async function TenantList({ query }: { query: ReturnType<typeof parseQuery> }) {
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
      query={query}
      labels={{
        colTenant: t('list.colTenant'),
        colPrimaryHost: t('list.colPrimaryHost'),
        colModules: t('list.colModules'),
        colStatus: t('list.colStatus'),
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
        new: t('list.new'),
      }}
    />
  );
}

/**
 * `/plataforma` — the tenant list (ROLE-05, D-33 `tenant-list`): the title row with the screen's
 * single brand-filled element ("Novo tenant"), then the table streamed behind a Suspense boundary
 * (5 Skeleton rows meanwhile). `q`, `status` and `limit` are forwarded to the API contract — the
 * browser never filters.
 */
export default async function PlatformTenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [t, sp] = await Promise.all([getTranslations('platform'), searchParams]);
  const query = parseQuery(sp);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-text">{t('list.title')}</h1>
        <LinkButton href="/plataforma/novo" variant="brand" className="w-full md:w-auto">
          <Plus aria-hidden size={18} />
          {t('list.new')}
        </LinkButton>
      </div>

      <div className="mt-6">
        <Suspense
          key={`${query.q ?? ''}|${query.status ?? ''}|${query.limit}`}
          fallback={<TenantTableSkeleton />}
        >
          <TenantList query={query} />
        </Suspense>
      </div>
    </div>
  );
}
