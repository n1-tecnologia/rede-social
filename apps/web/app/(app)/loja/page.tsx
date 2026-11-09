import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { getStoreFront } from '@/lib/store';
import { legacyStoreFilterRedirect } from '@/lib/store-area';
import { storeCategoryIds } from '@/lib/store-categories';
import { parseStoreQuery } from '@/lib/store-front-view';
import { StoreBrowseScreen } from './StoreBrowseScreen';

/**
 * `/loja` (08.2-07, STORE-05, D-351, D-352, D-362, UI-D-367): the store's front, reached from the
 * Loja TopBar slot (UI-D-366).
 *
 * **2026-10-24 (the Loja area).** "Produtos", the first screen of the "· Loja" menu: the tenant's
 * active products as the member catalogue's poster grid, the same screen for every role
 * (`StoreBrowseScreen`). The old one-screen page's chips became screens of their own: "Comprados"
 * (`/loja/comprados`) and, for a manager, "Gerenciar" (`/loja/gerenciar`, the create control and the
 * archived list). A bookmarked or shared OLD link still lands on its screen: `?filtro=comprados`
 * goes to Comprados, `?filtro=arquivados` to Gerenciar's archived list for a manager and stays here
 * for anyone else (`legacyStoreFilterRedirect`, read BEFORE any API read; a plain `redirect()`, never
 * a permanent one, because the target depends on the role). The module gate lives in `layout.tsx`.
 *
 * 2026-10-27 — the storefront (`StoreBrowseScreen`): `?categoria=` opens a category's page,
 * `?busca=` the search and `?ordem=` orders either (`parseStoreQuery`, lenient: anything unknown is
 * the plain storefront).
 *
 * 12.3-13 (D-699): the categories, "Em destaque" and the promo come from ONE call, `GET
 * /v1/store/front` (`getStoreFront`), read here next to the bootstrap and handed to the screen; a
 * failed call is `null` and the storefront shows the products alone (UI-D-690). An unknown
 * `?categoria=` slug is "all".
 */
export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?: string | string[];
    categoria?: string | string[];
    busca?: string | string[];
    ordem?: string | string[];
  }>;
}) {
  const [bootstrap, params, front] = await Promise.all([
    requireBootstrap(),
    searchParams,
    getStoreFront(),
  ]);
  const to = legacyStoreFilterRedirect(
    params.filtro,
    bootstrap.permissions.includes(STORE_PERMISSIONS.manage),
  );
  if (to) redirect(to);

  return (
    <StoreBrowseScreen
      screen="produtos"
      front={front}
      query={parseStoreQuery(params, storeCategoryIds(front))}
    />
  );
}
