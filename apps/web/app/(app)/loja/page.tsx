import { type ProductPage, STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { Chip } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getProducts, STORE_MODULE_DISABLED } from '@/lib/store';
import { productCardView, storeFilterFromParam, storeFilterHref } from '@/lib/store-view';
import { ProductGrid } from './ProductGrid';

/**
 * `/loja` (08.2-07, STORE-05, D-351, D-352, D-362, UI-D-367): the tenant's products as a two-column
 * grid of 4:5 posters, reached from the Loja TopBar slot (UI-D-366) and, for managers, from the
 * Configurações "Loja" row (UI-D-382). One screen for everyone: the manager's additions (the create
 * control and the "Arquivados" chip) exist only in their branch.
 *
 * The `communities` page shape verbatim: the title row (`min-w-0 flex-1` heading, `shrink-0` create
 * control), then `<nav aria-label>` of `Chip` LINKS bound to `?filtro=`, read HERE on the server so a
 * chip, a refresh, back and a shared link land on the same list. `storeFilterFromParam` maps an
 * unknown value, a repeated one, or `arquivados` without `store.product.manage` to "Todos"
 * (T-08.2-32: the API's 403 is the real control).
 *
 * The first page is server-rendered and handed to `ProductGrid` as FINISHED card views; the grid is
 * keyed by the filter, so switching chips starts from the server's page 1 with no client state
 * carried across lists. The web never sorts (P21). The module gate lives in `layout.tsx`.
 */
export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string | string[] }>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations(),
    searchParams,
  ]);

  const canManage = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const filter = storeFilterFromParam(params.filtro, canManage);
  // The first page. A refusal the bootstrap knows navigates OUTSIDE the try/catch (`redirect()`
  // throws); a flag flip between the bootstrap and this read (`MODULE_DISABLED`) is the store being
  // off (UI-D-387); anything else is the first-load error card (`page` stays null).
  let page: ProductPage | null = null;
  let path: string | null = null;
  let disabled = false;
  try {
    page = await getProducts({ filter });
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 404 && error.code === STORE_MODULE_DISABLED) disabled = true;
      else path = bootstrapRedirectPath(error);
    }
    // Shape only: a product name is tenant content and never reaches a log line.
    if (!disabled && !path) {
      console.error('store.list_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }
  if (path) redirect(path);
  if (disabled) notFound();

  const tenantName = bootstrap.tenant.displayName;
  const items = (page?.items ?? []).map((product) =>
    productCardView(product, t, { managerArchived: filter === 'archived' }),
  );

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* The heading block is `min-w-0 flex-1` and the control `shrink-0`: at any width the control
          keeps its 44px and a long tenant name wraps the subtitle instead (E02 long-text). */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h1
            data-brand-title
            className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
          >
            {t('store.list.title')}
          </h1>
          <p className="mt-1 break-words text-sm font-normal text-text-secondary">
            {t('store.list.subtitle', { tenant: tenantName })}
          </p>
        </div>
        {canManage ? (
          <a
            href="/loja/novo"
            data-store-create
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-button bg-(image:--button-image) text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:px-4"
          >
            <Plus aria-hidden size={20} className="sm:hidden" />
            <Plus aria-hidden size={16} className="hidden sm:block" />
            <span className="sr-only sm:not-sr-only">{t('store.list.create')}</span>
          </a>
        ) : null}
      </div>

      {/* Never wraps: a flex row of `shrink-0` chips; three fit at 320px (E02 overflow). */}
      <nav aria-label={t('store.list.filter.label')} className="flex gap-2 px-4 pb-3">
        <Chip href={storeFilterHref('all')} active={filter === 'all'}>
          {t('store.list.filter.all')}
        </Chip>
        <Chip href={storeFilterHref('owned')} active={filter === 'owned'}>
          {t('store.list.filter.owned')}
        </Chip>
        {canManage ? (
          <Chip href={storeFilterHref('archived')} active={filter === 'archived'}>
            {t('store.list.filter.archived')}
          </Chip>
        ) : null}
      </nav>

      <ProductGrid
        key={filter}
        filter={filter}
        canManage={canManage}
        tenantName={tenantName}
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </div>
  );
}
