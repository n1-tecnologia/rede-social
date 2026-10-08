import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { Card, EmptyState, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import { ChevronRight, CircleAlert, CircleCheck, Lock, Pencil, Users } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getProduct } from '@/lib/store';
import { type ProductUnlockRow, productPageView } from '@/lib/store-view';
import { ReactivateProduct } from './ReactivateProduct';

/**
 * `/loja/[productId]` (08.2-07, STORE-06, D-351..D-353, D-362, UI-D-369): the event detail page's
 * "one thing you can act on" shape, top to bottom: the header (name, back, the state pill), the 4:5
 * image (the card's crop and branches, `max-w-[400px]`), the price 24/700 with the action zone right
 * under it (the approved drawing groups them, 12px apart), the description, "Libera o acesso a" and,
 * for managers, "Gerenciar produto".
 *
 * **Misses.** An unknown, another tenant's or an archived product for a non-holder is ONE bare 404
 * from the API, rendered by the store's `not-found.tsx` (D-23, no existence oracle). The store being
 * off is caught by `layout.tsx` before this page runs (UI-D-387). A read failure is the product
 * error card with a retry.
 *
 * **What the action zone holds here.** Held → the success-tinted owned block (`tabIndex={-1}` so the
 * purchase dialog can return focus to it); a manager on an archived product → the archived note and
 * "Reativar produto"; anything else → nothing yet: the "Comprar" / "Obter" control is built in
 * 08.2-08 together with the purchase dialog it opens.
 *
 * **Text safety (P25, T-08.2-31).** The name and description are React text only: no HTML, no
 * linkify; the description keeps its line breaks with `whitespace-pre-line` and wraps long tokens
 * with `[overflow-wrap:anywhere]`.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ comunidade?: string | string[] }>;
}) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const [t, bootstrap, result] = await Promise.all([
    getTranslations(),
    requireBootstrap(),
    getProduct(productId),
  ]);

  if (result.status === 'redirect') redirect(result.path);
  // `disabled` is a flag flip between the bootstrap and this read; the layout gates the steady state.
  if (result.status === 'not-found' || result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="store-product-error"
          title={t('store.errors.title')}
          body={t('store.errors.product')}
          action={
            <a
              href={`/loja/${encodeURIComponent(productId)}`}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t('store.errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  const product = result.product;
  const canManage = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const view = productPageView(product, t, {
    canManage,
    communitiesOn,
    fromCommunity: query.comunidade,
  });
  const imageAlt = t('store.card.imageAlt', { product: product.name });

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6">
      <PageHeader
        backHref={view.back.href}
        backLabel={view.back.label}
        title={view.title}
        trailing={
          view.headerPill ? (
            <StatusPill
              data-testid="store-product-pill"
              tone={view.headerPill.tone}
              className="mr-2 shrink-0"
            >
              {view.headerPill.label}
            </StatusPill>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6 px-4 pt-4">
        {/* The card's 4:5 box and branches; the name is not overprinted here. */}
        {product.imageAssetId ? (
          <div
            data-testid="store-product-image"
            className="relative mx-auto aspect-[4/5] w-full max-w-[400px] overflow-hidden rounded-xl bg-bg-tertiary"
          >
            <MediaImage
              assetId={product.imageAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt={imageAlt}
              sizes="(min-width: 432px) 400px, 100vw"
              eager
              ratio=""
              className="h-full w-full"
            />
          </div>
        ) : (
          <div
            data-testid="store-product-fallback"
            aria-hidden
            className="mx-auto aspect-[4/5] w-full max-w-[400px] rounded-xl"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}

        <div className="flex flex-col gap-3">
          <p
            data-testid="store-product-price"
            className="text-2xl font-bold leading-tight tracking-[-0.02em] tabular-nums text-text"
          >
            {view.priceLabel}
          </p>
          {view.action === 'owned' ? (
            <div
              data-testid="store-product-owned"
              tabIndex={-1}
              className="flex items-center gap-3 rounded-xl bg-success/10 px-3 py-3 focus:outline-none"
            >
              <CircleCheck aria-hidden size={20} className="shrink-0 text-success" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">{t('store.product.owned.title')}</p>
                <p className="text-xs font-normal text-text-tertiary">
                  {t('store.product.owned.body')}
                </p>
              </div>
            </div>
          ) : null}
          {view.action === 'archived' ? (
            <div data-testid="store-product-archived" className="flex flex-col items-start gap-3">
              <p className="text-sm font-normal text-text-secondary">
                {t('store.product.archived.note')}
              </p>
              <ReactivateProduct productId={product.id} />
            </div>
          ) : null}
        </div>

        {view.description !== null ? (
          <p
            data-testid="store-product-description"
            className="whitespace-pre-line text-sm font-normal text-text [overflow-wrap:anywhere]"
          >
            {view.description}
          </p>
        ) : null}

        {view.unlocks.length > 0 ? (
          <section aria-labelledby="store-unlocks-title" data-testid="store-product-unlocks">
            <SectionTitle id="store-unlocks-title" className="mb-2">
              {t('store.product.unlocks.title')}
            </SectionTitle>
            <Card>
              <ul>
                {view.unlocks.map((row) => (
                  <UnlockRow key={row.id} row={row} />
                ))}
              </ul>
            </Card>
          </section>
        ) : null}

        {view.manage ? (
          <section aria-labelledby="store-manage-title" data-testid="store-product-manage">
            <SectionTitle id="store-manage-title" className="mb-2">
              {t('store.product.manage.title')}
            </SectionTitle>
            <Card>
              <a
                href={`/loja/${encodeURIComponent(product.id)}/compradores`}
                data-store-manage-buyers
                className="flex min-h-14 items-center gap-3 px-4 py-2 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              >
                <Users aria-hidden size={20} className="shrink-0 text-text-secondary" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-bold">
                    {t('store.product.manage.buyers')}
                  </span>
                  <span
                    data-store-manage-buyers-sub
                    className="truncate text-xs font-normal tabular-nums text-text-tertiary"
                  >
                    {view.manage.buyersSub}
                  </span>
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
              </a>
              <a
                href={`/loja/${encodeURIComponent(product.id)}/editar`}
                data-store-manage-edit
                className="flex min-h-14 items-center gap-3 border-t border-divider px-4 py-2 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
              >
                <Pencil aria-hidden size={20} className="shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1 truncate text-sm font-bold">
                  {t('store.product.manage.edit')}
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
              </a>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** The 32px community thumb: the cover, or the brand gradient (also when the cover fails). */
function UnlockThumb({ coverAssetId }: { coverAssetId: string | null }) {
  const gradient = (
    <span
      aria-hidden
      className="block h-8 w-8 shrink-0 rounded-lg"
      style={{ backgroundImage: 'var(--brand-gradient)' }}
    />
  );
  if (coverAssetId === null) return gradient;
  return (
    <span aria-hidden className="block h-8 w-8 shrink-0 overflow-hidden rounded-lg">
      <MediaImage
        assetId={coverAssetId}
        widths={PURPOSE_WIDTHS.cover}
        alt=""
        sizes="32px"
        ratio=""
        className="h-full w-full"
        fallback={gradient}
      />
    </span>
  );
}

const ROW = 'flex min-h-14 items-center gap-3 border-b border-divider px-4 py-2 last:border-0';

/** One "Libera o acesso a" row: a link once held (D-352), a static row with a padlock otherwise. */
function UnlockRow({ row }: { row: ProductUnlockRow }) {
  if (row.href !== null) {
    return (
      <li className="border-b border-divider last:border-0">
        <a
          href={row.href}
          aria-label={row.ariaLabel}
          data-store-unlock-row="open"
          className="flex min-h-14 items-center gap-3 px-4 py-2 text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        >
          <UnlockThumb coverAssetId={row.coverAssetId} />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.name}</span>
          <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
        </a>
      </li>
    );
  }
  return (
    <li aria-label={row.ariaLabel} data-store-unlock-row="locked" className={ROW}>
      <UnlockThumb coverAssetId={row.coverAssetId} />
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-text">{row.name}</span>
      <Lock aria-hidden size={16} className="shrink-0 text-text-tertiary" />
    </li>
  );
}
