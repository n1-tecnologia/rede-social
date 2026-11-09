import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { cn } from '@rede-social/ui';
import { Plus } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import {
  STORE_MANAGE_LISTS,
  storeManageFilter,
  storeManageHref,
  storeManageListFromParam,
} from '@/lib/store-area';
import { storeItems } from '@/lib/store-front-view';
import { builtInCategories, storeCategoryList } from '@/lib/store-setup';
import { readStoreSetup } from '@/lib/store-setup-cookie';
import { productManageView } from '@/lib/store-view';
import { CREATE_LINK } from '../cursos/admin-styles';
import { FilterMenu, type FilterOption } from '../cursos/FilterMenu';
import { ScreenHeader } from '../cursos/ScreenHeader';
import { readFirstProductPage, readStoreCatalog } from './first-page';
import { ProductsManageList } from './ProductsManageList';
import { StoreSetupPanel } from './StoreSetupPanel';
import { ProductRowsSkeleton } from './StoreSkeletons';
import { STORE_SCREEN_TITLE_ID } from './store-styles';

/** The catalog keys of Gerenciar's two lists in the filter menu. */
const LIST_LABEL_KEY = {
  active: 'store.screens.manage.filter.active',
  archived: 'store.list.filter.archived',
} as const;

/**
 * 2026-10-24 — "Gerenciar" (`/loja/gerenciar`), the "· Loja" menu's last row for a manager (the
 * store redesign on the "área de membros", the courses admin lists' `AdminListScreen` pattern). What
 * the old one-screen `/loja` held only in its manager branch lives here now:
 *
 *  - `store-screen` with `data-screen="gerenciar"` and `data-shell-wide`;
 *  - the `ScreenHeader` "Gerenciar" and, on the right, the filter (`FilterMenu`: Ativos, Arquivados,
 *    links bound to `?filtro=`, read here on the server) and "Novo produto" (`data-store-create`, the
 *    screen's ONE brand fill, icon-only below 360px so the title keeps whole words). Both sit in the
 *    header OUTSIDE the `Suspense`, so a switch never blanks the header;
 *  - the products as management ROWS (`ProductsManageList`) in their own `Suspense` keyed by the
 *    list, entering with the area's swap: the catalogue's state (archived, no payment link), never the
 *    manager's own holding (`productManageView`).
 *
 * 2026-10-28 (the product owner: "na tela de gerenciar da parte de loja quero que tenha como
 * gerenciar as categorias e o destaque"): over the products, the store's setup (`StoreSetupPanel`):
 * "Em destaque" and "Categorias", each with its sheet, in a `Suspense` of their own (they read the
 * whole active catalogue).
 *
 * The page gates the permission; this re-checks it (a server component must not trust its caller).
 */
export async function StoreManageScreen({ filtro }: { filtro: string | string[] | undefined }) {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations()]);
  if (!bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) notFound();
  const tenantName = bootstrap.tenant.displayName;
  const list = storeManageListFromParam(filtro);

  const options: FilterOption[] = STORE_MANAGE_LISTS.map((key) => ({
    key,
    label: t(LIST_LABEL_KEY[key]),
    href: storeManageHref(key),
    active: key === list,
  }));
  const current = options.find((option) => option.active) ?? options[0];
  const filterLabel = t('store.list.filter.label');

  return (
    <div
      data-testid="store-screen"
      data-screen="gerenciar"
      data-shell-wide
      className="mx-auto flex w-full flex-col"
    >
      <ScreenHeader
        title={t('store.screens.manage.title')}
        subtitle={t('store.screens.manage.subtitle', { tenant: tenantName })}
        titleId={STORE_SCREEN_TITLE_ID}
        action={
          <div className="flex items-center gap-2">
            <FilterMenu
              label={filterLabel}
              buttonLabel={t('store.screens.manage.filter.button', {
                label: filterLabel,
                current: current?.label ?? '',
              })}
              options={options}
              testId="store-manage-filters"
            />
            <a
              href="/loja/novo"
              data-store-create
              className={cn(CREATE_LINK, 'w-11 px-0 min-[360px]:w-auto min-[360px]:px-4')}
            >
              <Plus aria-hidden size={16} />
              <span className="sr-only min-[360px]:not-sr-only">{t('store.list.create')}</span>
            </a>
          </div>
        }
      />

      <Suspense fallback={null}>
        <StoreSetupBody />
      </Suspense>

      <Suspense key={`gerenciar:${list}`} fallback={<ManageRowsFallback />}>
        <div className="animate-swap-in motion-reduce:animate-none">
          <StoreManageBody archived={list === 'archived'} tenantName={tenantName} />
        </div>
      </Suspense>
    </div>
  );
}

function ManageRowsFallback() {
  return (
    <div className="px-4 pb-6">
      <ProductRowsSkeleton count={6} />
    </div>
  );
}

/** A product's 40×50 thumb in the featured picker: its image, or the brand gradient. */
function productThumb(imageAssetId: string | null): ReactNode {
  return imageAssetId ? (
    <MediaImage
      assetId={imageAssetId}
      widths={PURPOSE_WIDTHS.cover}
      alt=""
      sizes="40px"
      ratio=""
      className="h-full w-full"
    />
  ) : (
    <span className="block h-full w-full" style={{ backgroundImage: 'var(--brand-gradient)' }} />
  );
}

/**
 * The store's setup over the products (`StoreSetupPanel`): the active catalogue, each category's
 * count and the featured products still on sale. An unreadable catalogue draws no panel.
 */
async function StoreSetupBody() {
  const [products, t, store] = await Promise.all([
    readStoreCatalog(),
    getTranslations(),
    readStoreSetup(),
  ]);
  if (products === null) return null;
  const builtIn = builtInCategories(t);
  const categories = storeCategoryList(store.setup, t);
  const items = storeItems(products, t, { categories, assignments: store.assignments });
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.category !== null) counts[item.category] = (counts[item.category] ?? 0) + 1;
  }
  const onSale = new Set(items.map((item) => item.id));

  return (
    <StoreSetupPanel
      products={items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.priceLabel,
        thumb: productThumb(item.imageAssetId),
      }))}
      categories={categories.map(({ id, name, icon }) => ({ id, name, icon }))}
      builtIn={builtIn}
      custom={store.setup.categories !== null}
      counts={counts}
      featured={store.setup.featured.filter((id) => onSale.has(id))}
    />
  );
}

/** The list's first page, read on the server and handed to the rows as finished views. */
async function StoreManageBody({
  archived,
  tenantName,
}: {
  archived: boolean;
  tenantName: string;
}) {
  const filter = storeManageFilter(archived ? 'archived' : 'active');
  const [page, t] = await Promise.all([readFirstProductPage(filter), getTranslations()]);
  const items = (page?.items ?? []).map((product) =>
    productManageView(product, t, { archived, canManage: true }),
  );

  return (
    <section aria-labelledby={STORE_SCREEN_TITLE_ID} className="flex flex-col px-4">
      <ProductsManageList
        key={filter}
        filter={filter}
        tenantName={tenantName}
        initialItems={items}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </section>
  );
}
