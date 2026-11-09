import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { buttonClasses, cn, MemberSkin } from '@rede-social/ui';
import { CircleAlert, ShoppingBag } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { readHomePromoChoice } from '@/lib/home-promo-cookie';
import { STORE_SCREENS, type StoreScreen } from '@/lib/store-area';
import {
  type StoreQuery,
  storeCategoryTiles,
  storeFrontView,
  storeItems,
  storeListingView,
} from '@/lib/store-front-view';
import {
  type StoreAssignments,
  type StoreCategoryView,
  storeCategoryList,
} from '@/lib/store-setup';
import { readStoreSetup } from '@/lib/store-setup-cookie';
import { productCardView } from '@/lib/store-view';
import { CatalogueSearch } from '../cursos/CatalogueSearch';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from '../cursos/MemberEmptyCard';
import { ScreenHeader } from '../cursos/ScreenHeader';
import { readFirstProductPage, readStoreCatalog } from './first-page';
import { ProductGrid } from './ProductGrid';
import { StoreFront } from './StoreFront';
import { StoreBackLink, StoreListing } from './StoreListing';
import { ProductGridSkeleton, StoreFrontSkeleton } from './StoreSkeletons';
import { STORE_SCREEN_TITLE_ID } from './store-styles';

/** "Tentar novamente": the `outline sm` look as a LINK back to the storefront (44px hit area). */
const RETRY_LINK = buttonClasses({ variant: 'outline', size: 'sm', hitArea: true });

/** The storefront with no category and no search. */
const PLAIN_QUERY: StoreQuery = { categoria: null, busca: null, ordem: 'recentes' };

/**
 * 2026-10-24 — Produtos (`/loja`) and Comprados (`/loja/comprados`), the "· Loja" menu's browse
 * screens (the store redesign on the "área de membros"), drawn the way a member sees them FOR
 * EVERYONE. A manager browses here as a member does; the store's management is "Gerenciar".
 *
 * **2026-10-27 (the product owner: "repense a loja ... estilo comercial ... cards maiores, destaque
 * em itens, esquema de prateleiras de itens, categorias ... monte esse sistema de loja completo").**
 * Produtos is a storefront on the member area's base: the header with the store's search, then
 * (`StoreFront`) "Em destaque" (the featured product large, the next two beside it), the categories
 * and a shelf per category; a category's page (`?categoria=`) and the search (`?busca=`) list their
 * products with the three orders (`?ordem=`, `StoreListing`). The whole active catalogue is read on
 * the server and grouped there (`storeFrontView`); the featured product is the "Destaque da loja"
 * of Início (the newest, or the administrator's pick on his device). Comprados keeps the paged grid
 * (`ProductGrid`). The module gate lives in `layout.tsx`.
 *
 * 2026-10-28 — the categories, each product's category and "Em destaque" are the ones Gerenciar
 * keeps (`lib/store-setup.ts`, on this device until the API keeps them); without a featured list
 * there, the "Destaque da loja" of Início leads the hero as before.
 */
export async function StoreBrowseScreen({
  screen,
  query = PLAIN_QUERY,
}: {
  screen: StoreScreen;
  query?: StoreQuery;
}) {
  const [bootstrap, t, store] = await Promise.all([
    requireBootstrap(),
    getTranslations(),
    readStoreSetup(),
  ]);
  const tenantName = bootstrap.tenant.displayName;
  const categories = storeCategoryList(store.setup, t);
  const listing = screen === 'produtos' && (query.categoria !== null || query.busca !== null);

  let header: { title: string; subtitle: string | null };
  if (screen === 'comprados') {
    header = {
      title: t('store.screens.owned.title'),
      subtitle: t('store.screens.owned.subtitle', { tenant: tenantName }),
    };
  } else if (query.categoria) {
    header = {
      title: categories.find((category) => category.id === query.categoria)?.name ?? '',
      subtitle: null,
    };
  } else if (query.busca) {
    header = { title: t('store.front.search.title'), subtitle: null };
  } else {
    header = {
      title: t('store.list.title'),
      subtitle: t('store.list.subtitle', { tenant: tenantName }),
    };
  }

  const search =
    screen === 'produtos' ? (
      <CatalogueSearch
        action="/loja"
        query={query.busca}
        preview={false}
        label={t('store.front.search.label')}
        placeholder={t('store.front.search.placeholder')}
        submitLabel={t('store.front.search.submit')}
        className="md:max-w-sm"
        testId="store-search"
      />
    ) : null;

  return (
    <MemberSkin>
      <div
        data-testid="store-screen"
        data-screen={screen}
        data-shell-full
        className="mx-auto flex w-full flex-col"
      >
        <ScreenHeader
          title={header.title}
          subtitle={header.subtitle}
          titleId={STORE_SCREEN_TITLE_ID}
          action={search}
          actionWide
          back={
            listing ? (
              <StoreBackLink label={t('store.front.back')} ariaLabel={t('store.front.backAria')} />
            ) : null
          }
        />
        <Suspense
          key={`${screen}:${query.categoria ?? ''}:${query.busca ?? ''}:${query.ordem}`}
          fallback={
            screen === 'produtos' && !listing ? (
              <StoreFrontSkeleton />
            ) : (
              <div className="pt-1 pb-6">
                <ProductGridSkeleton rows={2} />
              </div>
            )
          }
        >
          {screen === 'produtos' ? (
            <StoreFrontBody
              query={query}
              tenantName={tenantName}
              canManage={bootstrap.permissions.includes(STORE_PERMISSIONS.manage)}
              categories={categories}
              assignments={store.assignments}
              featured={store.setup.featured}
            />
          ) : (
            <StoreBrowseBody screen={screen} tenantName={tenantName} />
          )}
        </Suspense>
      </div>
    </MemberSkin>
  );
}

/**
 * Produtos' body: the whole catalogue read once, then the storefront, or a category's page, or the
 * search. An unreadable catalogue is the error card; an empty store the store's empty card.
 */
async function StoreFrontBody({
  query,
  tenantName,
  canManage,
  categories,
  assignments,
  featured,
}: {
  query: StoreQuery;
  tenantName: string;
  canManage: boolean;
  categories: readonly StoreCategoryView[];
  assignments: StoreAssignments;
  featured: readonly string[];
}) {
  const [products, t, promoId] = await Promise.all([
    readStoreCatalog(),
    getTranslations(),
    canManage && featured.length === 0 ? readHomePromoChoice() : Promise.resolve(null),
  ]);

  if (products === null) {
    return (
      <MemberEmptyCard
        icon={CircleAlert}
        tone="error"
        data-testid="store-front-error"
        className={cn('mx-4 my-2', MEMBER_EMPTY_WIDE)}
        title={t('store.errors.title')}
        body={t('store.errors.list')}
        action={
          <a href="/loja" className={RETRY_LINK}>
            {t('store.errors.retry')}
          </a>
        }
      />
    );
  }

  const items = storeItems(products, t, { categories, assignments });
  if (items.length === 0) {
    return (
      <MemberEmptyCard
        icon={ShoppingBag}
        data-testid="store-front-empty"
        className={cn('mx-4 my-2', MEMBER_EMPTY_WIDE)}
        title={t('store.list.empty.title')}
        body={t('store.list.empty.body', { tenant: tenantName })}
      />
    );
  }

  if (query.categoria !== null || query.busca !== null) {
    return (
      <StoreListing
        view={storeListingView(items, query, t, categories)}
        showTags={query.busca !== null}
        chips={storeCategoryTiles(items, query.categoria, t, categories)}
        labels={{
          all: t('store.categories.all'),
          categories: t('store.categories.title'),
          sort: t('store.front.sort.label'),
        }}
        empty={
          query.busca !== null
            ? {
                title: t('store.front.search.empty.title'),
                body: t('store.front.search.empty.body'),
              }
            : {
                title: t('store.front.categoryEmpty.title'),
                body: t('store.front.categoryEmpty.body', { tenant: tenantName }),
              }
        }
      />
    );
  }

  return (
    <StoreFront
      view={storeFrontView(items, t, {
        categories,
        featured: featured.length > 0 ? featured : promoId ? [promoId] : [],
      })}
      labels={{
        hero: {
          title: t('store.front.hero.title'),
          eyebrow: t('store.front.hero.eyebrow'),
          cta: t('store.front.hero.cta'),
        },
        categories: t('store.categories.title'),
      }}
    />
  );
}

/** Comprados: the first page, read on the server and handed to the grid as finished views. */
async function StoreBrowseBody({
  screen,
  tenantName,
}: {
  screen: StoreScreen;
  tenantName: string;
}) {
  const filter = STORE_SCREENS.find((item) => item.key === screen)?.filter ?? 'all';
  const [page, t] = await Promise.all([readFirstProductPage(filter), getTranslations()]);
  // The member's view for everyone: never the archived pill, never the manager's "sem link".
  const items = (page?.items ?? []).map((product) =>
    productCardView(product, t, { managerArchived: false }),
  );

  return (
    <ProductGrid
      key={filter}
      filter={filter}
      tenantName={tenantName}
      initialItems={items}
      initialCursor={page?.nextCursor ?? null}
      initialError={page === null}
    />
  );
}
