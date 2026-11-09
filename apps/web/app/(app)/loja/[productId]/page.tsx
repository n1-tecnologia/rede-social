import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { MEMBER_CARD, OVERLINE, POSTER_FRAME } from '@rede-social/module-courses/ui';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { UnlockThumb } from '@rede-social/module-store/ui';
import { Card, cn, MemberSkin, PageHeader, StatusPill } from '@rede-social/ui';
import {
  Archive,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Lock,
  Pencil,
  Users,
  Zap,
} from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';
import { getProduct } from '@/lib/store';
import { relatedItems, storeHref, storeItems } from '@/lib/store-front-view';
import { categoryOf, storeCategoryList } from '@/lib/store-setup';
import { readStoreSetup } from '@/lib/store-setup-cookie';
import {
  type ProductUnlockRow,
  productPageView,
  purchaseConfirmView,
  STORE_OWNED_BLOCK_ID,
} from '@/lib/store-view';
import { LIST_CARD, OUTLINE_LINK } from '../../cursos/admin-styles';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from '../../cursos/MemberEmptyCard';
import { MemberSectionHeader } from '../../cursos/MemberSection';
import { readStoreCatalog } from '../first-page';
import { StoreShelf } from '../StoreFront';
import { GatewayPurchase } from './GatewayPurchase';
import { PurchaseControl } from './PurchaseControl';
import { ReactivateProduct } from './ReactivateProduct';

/**
 * `/loja/[productId]` (08.2-07, STORE-06, D-351..D-353, D-362, UI-D-369): one product, what it costs,
 * the one thing to act on, what it says and what it unlocks; for managers, "Gerenciar produto".
 *
 * **2026-10-24 (the Loja redesign on the "área de membros", the user's "Imagem ao lado").** A WIDE
 * page (since 2026-10-27 at the member area's full width, `data-shell-full`), the e-commerce layout: from `lg` two columns, the 4:5 image on the LEFT,
 * sticky while the right column scrolls (from `xl` its column is capped by the screen's height, so
 * the pinned image always fits whole), and on the right, top to bottom:
 *
 *  - the overline "Produto" with the state pill beside it ("Comprado", "Arquivado" or the manager's
 *    "Sem link de pagamento", each with its glyph), the name as the page's ONE h1 (the header keeps
 *    the truncated name as a plain line, `titleAs="p"`), the price and the action zone;
 *  - "Sobre o produto" (the whole description, line breaks kept; no "Ler mais");
 *  - "Libera o acesso a" with its count, the rows in one outlined card;
 *  - for managers, "Gerenciar produto": Compradores (with the holder count) and Editar produto.
 *
 * On a phone it is one column in the same order: the image first, then everything else. Section
 * titles are the area's `MemberSectionHeader` (h2).
 *
 * **Misses.** An unknown, another tenant's or an archived product for a non-holder is ONE bare 404
 * from the API, rendered by the store's `not-found.tsx` (D-23, no existence oracle). The store being
 * off is caught by `layout.tsx` before this page runs (UI-D-387). A read failure is the product
 * error card with a retry.
 *
 * **What the action zone holds here.** Held → the success-tinted owned block (`tabIndex={-1}` so the
 * purchase dialog can return focus to it); a manager on an archived product → the archived note and
 * "Reativar produto"; an active product the viewer does not hold → `PurchaseControl` ("Comprar",
 * "Obter" at R$ 0, 08.2-08), which opens the purchase dialog. The control gets the SAME
 * `priceCents` the price label is formatted from (P26), so the amount it sends as
 * `expectedAmountCents` is always the number on screen, and the page's `?comunidade=` for the
 * return path (D-358), honoured only when the purchase answer lists that community.
 *
 * **Gateway mode** (09.1-17, PAY-24, PAY-26, PAY-34, D-505, D-506, D-508): when the product read says
 * the tenant sells through its payment page, an unheld active product gets `GatewayPurchase` (a link
 * to the stored `https:` checkout, or the disabled unavailable button) and NEVER `PurchaseControl`;
 * `productPageView` decided which, once, here on the server. The whole action zone, the buy control
 * AND the owned block it turns into, sits inside ONE `aria-live="polite"` wrapper that exists before
 * and after the unlock, because a live region created together with its content announces nothing. A
 * simulated product gets no wrapper: its markup is unchanged.
 *
 * **"Libera o acesso a"** (08.5-12, UI-D-439, D-425): the active communities, then the published
 * courses, then the non-cancelled lives the product unlocks (courses and lives only while the
 * `courses` module is on), each row with its kind's thumb box, its name and its kind meta
 * ("Comunidade", "Curso", "Live · {date}, {time}" in the tenant's timezone); a static row with a
 * padlock until held, then a link. `?curso=` / `?live=` (the course and live pages' "Comprar para
 * liberar") change the back control only when the product unlocks that course or live.
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
  searchParams: Promise<{
    comunidade?: string | string[];
    curso?: string | string[];
    live?: string | string[];
  }>;
}) {
  const [{ productId }, query] = await Promise.all([params, searchParams]);
  const [t, bootstrap, result, catalog, store] = await Promise.all([
    getTranslations(),
    requireBootstrap(),
    getProduct(productId),
    // "Você também pode gostar" (2026-10-27): the storefront's catalogue, read beside the product.
    readStoreCatalog(),
    // 2026-10-28: the store's categories and each product's, as Gerenciar keeps them.
    readStoreSetup(),
  ]);

  if (result.status === 'redirect') redirect(result.path);
  // `disabled` is a flag flip between the bootstrap and this read; the layout gates the steady state.
  if (result.status === 'not-found' || result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <MemberSkin>
        <div data-shell-full className="mx-auto flex w-full flex-col px-4 pt-4">
          <MemberEmptyCard
            icon={CircleAlert}
            tone="error"
            data-testid="store-product-error"
            className={MEMBER_EMPTY_WIDE}
            title={t('store.errors.title')}
            body={t('store.errors.product')}
            action={
              <a href={`/loja/${encodeURIComponent(productId)}`} className={OUTLINE_LINK}>
                {t('store.errors.retry')}
              </a>
            }
          />
        </div>
      </MemberSkin>
    );
  }

  const product = result.product;
  // The storefront's category (2026-10-27): its chip over the name and the shelf under the page.
  // 2026-10-28: the store's own (Gerenciar), so a product may have none (then no chip).
  const categories = storeCategoryList(store.setup, t);
  const categoryId = categoryOf(product, categories, store.assignments);
  const category = categories.find((entry) => entry.id === categoryId) ?? null;
  const related = catalog
    ? relatedItems(
        storeItems(catalog, t, { categories, assignments: store.assignments }),
        product.id,
        categoryId,
        RELATED_MAX,
      )
    : [];
  const canManage = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const coursesOn = bootstrap.modules.some((module) => module.key === 'courses');
  const view = productPageView(product, t, {
    canManage,
    communitiesOn,
    coursesOn,
    timeZone: bootstrap.tenant.timezone,
    fromCommunity: query.comunidade,
    fromCourse: query.curso,
    fromLive: query.live,
  });
  const imageAlt = t('store.card.imageAlt', { product: product.name });
  const PillIcon = view.headerPill ? PILL_ICON[view.headerPill.tone] : null;

  // The action zone, built once so a gateway product can wrap it in ONE persistent live region.
  const action = (
    <>
      {view.action === 'buy' && view.buyMode === 'simulated' ? (
        <PurchaseControl
          productId={product.id}
          priceCents={product.priceCents}
          productName={product.name}
          confirm={purchaseConfirmView(product, t)}
          fromCommunity={typeof query.comunidade === 'string' ? query.comunidade : undefined}
          fromCourse={typeof query.curso === 'string' ? query.curso : undefined}
          fromLive={typeof query.live === 'string' ? query.live : undefined}
          timeZone={bootstrap.tenant.timezone}
        />
      ) : null}
      {view.action === 'buy' && view.buyMode !== 'simulated' ? (
        <GatewayPurchase
          checkoutHref={view.checkoutHref}
          tenantId={bootstrap.tenant.id}
          userId={bootstrap.user.id}
          labels={{
            buy: t('store.purchase.gateway.buy'),
            newTab: t('store.purchase.gateway.newTab'),
            helper: t('store.purchase.gateway.helper'),
            unavailable: t('store.purchase.gateway.unavailable'),
            unavailableNote: t('store.purchase.gateway.unavailableNote'),
          }}
        />
      ) : null}
      {view.action === 'owned' ? (
        <div
          id={STORE_OWNED_BLOCK_ID}
          data-testid="store-product-owned"
          tabIndex={-1}
          className="flex items-center gap-3 rounded-2xl border border-success/20 bg-success/10 px-4 py-3.5 focus:outline-none"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-white"
          >
            <CircleCheck size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">{t('store.product.owned.title')}</p>
            <p className="text-xs font-normal text-text-secondary">
              {t('store.product.owned.body')}
            </p>
          </div>
        </div>
      ) : null}
      {view.action === 'archived' ? (
        <div
          data-testid="store-product-archived"
          className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-bg-secondary px-4 py-3.5"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary"
            >
              <Archive size={18} />
            </span>
            <p className="min-w-0 pt-2 text-sm font-normal text-text-secondary">
              {t('store.product.archived.note')}
            </p>
          </div>
          <ReactivateProduct productId={product.id} />
        </div>
      ) : null}
    </>
  );

  return (
    <MemberSkin>
      <div
        data-testid="store-product-page"
        data-shell-full
        className="mx-auto flex w-full flex-col pb-6"
      >
        <PageHeader
          backHref={view.back.href}
          backLabel={view.back.label}
          title={view.title}
          titleAs="p"
          className="md:px-0"
        />

        <div style={IMAGE_COLUMN} className={LAYOUT}>
          {/* The 4:5 image: the top of the page on a phone, the sticky left column from `lg`. */}
          <div className="px-4 pt-4 lg:sticky lg:top-6 lg:px-0 lg:pt-0">
            {product.imageAssetId ? (
              <div
                data-testid="store-product-image"
                className={cn(POSTER_FRAME, IMAGE_BOX, 'ms-hero rounded-3xl')}
              >
                <MediaImage
                  assetId={product.imageAssetId}
                  widths={PURPOSE_WIDTHS.cover}
                  alt={imageAlt}
                  sizes={IMAGE_SIZES}
                  eager
                  ratio=""
                  className="h-full w-full"
                />
              </div>
            ) : (
              <div
                data-testid="store-product-fallback"
                aria-hidden
                className={cn(POSTER_FRAME, IMAGE_BOX, 'ms-hero rounded-3xl')}
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            )}
          </div>

          {/* At the member area's full width (2026-10-27) the column keeps a shop's measure: the buy
              box, the text and the manager's card never stretch past 760px. */}
          <div className="flex min-w-0 flex-col gap-7 pt-5 lg:pt-1 xl:max-w-[760px]">
            {/* 2026-10-24 (the user, on the phone: "refaça isso, muito feio"): below `lg` no box, a
              chip for "Produto", the larger name, a hairline, then the price whole on one line (no
              raised cents) over the button. From `lg` the buy box of before, unchanged. */}
            <div className={cn(GUTTER, 'flex flex-col gap-5 lg:gap-4')}>
              <div className="flex flex-col gap-2.5 lg:gap-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  {category ? (
                    <a
                      href={storeHref({ categoria: category.id })}
                      data-testid="store-product-category"
                      className={cn(OVERLINE, OVERLINE_CHIP, 'transition-colors hover:bg-brand/15')}
                    >
                      {category.tag}
                    </a>
                  ) : null}
                  {view.headerPill && PillIcon ? (
                    <StatusPill
                      data-testid="store-product-pill"
                      tone={view.headerPill.tone}
                      className="shrink-0"
                    >
                      <PillIcon aria-hidden size={12} strokeWidth={2.5} />
                      {view.headerPill.label}
                    </StatusPill>
                  ) : null}
                </div>
                <h1
                  data-brand-title
                  data-testid="store-product-name"
                  className="ms-title-page text-[26px] font-extrabold leading-[1.15] tracking-tight text-text [overflow-wrap:anywhere] lg:text-[28px] lg:leading-tight"
                >
                  {view.title}
                </h1>
              </div>
              {/* The buy zone (2026-10-28, the user: "mude o design disso, está muito feio"): on the
                phone a hairline above the price and the action; from `lg` the glass box. The price
                is whole on one line, the currency small and quiet, the cents at the amount's size
                (never raised). With a buy action and room for it (`@container`, 480px) the price
                and the pill button sit side by side, a checkout bar; the owned and archived blocks
                stay under the price. "Grátis" in the success tone. */}
              <div data-testid="store-product-buybox" className={cn(BUYBOX, '@container')}>
                <div className={cn('flex flex-col gap-4', view.action === 'buy' && BUY_ROW)}>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p
                      data-testid="store-product-price"
                      className={cn(
                        'flex items-baseline whitespace-nowrap text-[30px] font-extrabold leading-none tracking-tight tabular-nums lg:text-[34px]',
                        view.free ? 'text-success' : 'text-text',
                      )}
                    >
                      {view.priceParts ? (
                        <>
                          <span className="mr-0.5 text-[0.5em] font-semibold tracking-normal text-text-secondary">
                            {view.priceParts.lead}
                          </span>
                          <span>{view.priceParts.main}</span>
                          <span>{view.priceParts.tail}</span>
                        </>
                      ) : (
                        view.priceLabel
                      )}
                    </p>
                    {view.action === 'buy' && view.buyMode === 'simulated' ? (
                      <p
                        data-testid="store-product-buy-note"
                        className="flex items-center gap-1.5 text-xs font-normal text-text-secondary"
                      >
                        <Zap aria-hidden size={13} className="shrink-0 text-brand" />
                        {t('store.product.buyNote')}
                      </p>
                    ) : null}
                  </div>
                  {view.gatewayZone ? (
                    <div
                      aria-live="polite"
                      data-testid="store-product-action-zone"
                      className={cn('flex flex-col', view.action === 'buy' && BUY_ACTION)}
                    >
                      {action}
                    </div>
                  ) : (
                    <div className={cn('flex flex-col', view.action === 'buy' && BUY_ACTION)}>
                      {action}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {view.description !== null ? (
              <section aria-labelledby="store-about-title" className="flex flex-col">
                <MemberSectionHeader
                  id="store-about-title"
                  title={t('store.product.about')}
                  className="lg:px-0"
                />
                <div className={GUTTER}>
                  <p
                    data-testid="store-product-description"
                    className="whitespace-pre-line text-sm font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]"
                  >
                    {view.description}
                  </p>
                </div>
              </section>
            ) : null}

            {view.unlocks.length > 0 ? (
              <section
                aria-labelledby="store-unlocks-title"
                data-testid="store-product-unlocks"
                className="flex flex-col"
              >
                <MemberSectionHeader
                  id="store-unlocks-title"
                  title={t('store.product.unlocks.title')}
                  count={view.unlocksCount}
                  countTestId="store-unlocks-count"
                  className="lg:px-0"
                />
                <div className={GUTTER}>
                  <Card className={cn(MEMBER_CARD, 'ms-panel ms-solid rounded-2xl')}>
                    <ul className="divide-y divide-divider">
                      {view.unlocks.map((row) => (
                        <UnlockRow key={`${row.kind}:${row.id}`} row={row} />
                      ))}
                    </ul>
                  </Card>
                </div>
              </section>
            ) : null}

            {view.manage ? (
              <section
                aria-labelledby="store-manage-title"
                data-testid="store-product-manage"
                className="flex flex-col"
              >
                <MemberSectionHeader
                  id="store-manage-title"
                  title={t('store.product.manage.title')}
                  className="lg:px-0"
                />
                <div className={GUTTER}>
                  <div className={cn(LIST_CARD, 'ms-panel ms-solid divide-y divide-divider')}>
                    <a
                      href={`/loja/${encodeURIComponent(product.id)}/compradores`}
                      data-store-manage-buyers
                      className={MANAGE_ROW}
                    >
                      <span aria-hidden className={MANAGE_DISC}>
                        <Users size={18} />
                      </span>
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
                      className={MANAGE_ROW}
                    >
                      <span aria-hidden className={MANAGE_DISC}>
                        <Pencil size={18} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold">
                        {t('store.product.manage.edit')}
                      </span>
                      <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                    </a>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>

        {related.length > 0 ? (
          <div data-testid="store-product-related" className="mt-12 lg:mt-16">
            <StoreShelf
              showTags
              shelf={{
                key: category?.id ?? 'related',
                title: t('store.front.related'),
                sub: '',
                seeAll: {
                  href: storeHref({ categoria: category?.id ?? null }),
                  label: t('store.front.shelf.seeAll'),
                  ariaLabel: t('store.front.shelf.seeAllAria', {
                    category: category?.name ?? t('store.list.title'),
                  }),
                },
                items: related,
              }}
            />
          </div>
        ) : null}
      </div>
    </MemberSkin>
  );
}

/** "Você também pode gostar": one row at the full width (four to six columns, `StoreShelf`). */
const RELATED_MAX = 6;

/**
 * The image column's width from `xl`: at most 560px, and never taller than the screen once pinned
 * (the 4:5 box is 1.25× its width; 8rem leave room for the header and the gutters).
 */
const IMAGE_COLUMN = {
  '--product-image-col': 'min(560px, calc((var(--screen-h) - 8rem) * 0.8))',
} as CSSProperties;

/** One column on a phone; from `lg` the image and the info side by side, the image's capped from `xl`. */
const LAYOUT =
  'flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-x-8 lg:px-4 lg:pt-2 xl:grid-cols-[minmax(0,var(--product-image-col))_minmax(0,1fr)] xl:gap-x-12';

/** The 4:5 box: centred up to 440px on a phone, the whole column from `lg`. */
const IMAGE_BOX = 'mx-auto aspect-[4/5] w-full max-w-[440px] lg:max-w-none';

/** The image's `sizes` for each of the layouts above. */
const IMAGE_SIZES =
  '(min-width: 1280px) 560px, (min-width: 1024px) 45vw, (min-width: 472px) 440px, calc(100vw - 32px)';

/** The info column's side gutter: the phone's 16px; the grid owns it from `lg`. */
const GUTTER = 'px-4 lg:px-0';

/**
 * "Produto" as a brand-tinted chip. 2026-10-26 (the member skin): the skin's brand chip at every
 * width (it was the plain overline from `lg`).
 */
const OVERLINE_CHIP = 'ms-chip-brand self-start rounded-full bg-brand/10 px-3 py-1.5 text-brand';

/**
 * The buy zone: on a phone a hairline above the price and the action (the user's 2026-10-24
 * choice); from `lg` the buy box, since 2026-10-26 in the member skin's glass, read straight from
 * its keys (this page always renders inside `MemberSkin`). Static: the purchase dialogs render
 * inside it, so nothing here moves, filters or isolates.
 */
const BUYBOX =
  'flex flex-col border-t border-border pt-5 lg:rounded-3xl lg:border lg:border-[color:var(--ms-edge)] lg:px-6 lg:py-5 lg:[background:linear-gradient(180deg,var(--ms-surface),var(--ms-surface-2))] lg:[box-shadow:var(--ms-shadow),inset_0_1px_0_var(--ms-highlight)]';

/** 2026-10-28: with a buy action and 480px of box, the price and the button share one row. */
const BUY_ROW = '@min-[480px]:flex-row @min-[480px]:items-center @min-[480px]:justify-between';

/** The buy action's column in that row: the pill's own width, never the whole box. */
const BUY_ACTION = '@min-[480px]:w-[232px] @min-[480px]:shrink-0';

/** The state pill's glyph by tone, so the state is never colour alone. */
const PILL_ICON = { success: Check, warning: CircleAlert, neutral: Archive } as const;

/** One row of "Gerenciar produto": the brand disc, the label (and its line), the chevron. */
const MANAGE_ROW =
  'flex min-h-14 items-center gap-3 px-4 py-3 text-text transition-colors hover:bg-card-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset';

const MANAGE_DISC =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand';

/** The name 14/700 over the kind meta 12/400 tertiary, both truncating on one line (UI-D-439). */
function UnlockText({ row }: { row: ProductUnlockRow }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span data-store-unlock-name className="truncate text-sm font-bold text-text">
        {row.name}
      </span>
      <span
        data-store-unlock-meta
        className="truncate text-xs font-normal tabular-nums text-text-tertiary"
      >
        {row.meta}
      </span>
    </span>
  );
}

const UNLOCK_ROW = 'flex min-h-14 items-center gap-3 px-4 py-2.5';

/**
 * One "Libera o acesso a" row: a link once held (D-352), a static row with a padlock otherwise; the
 * thumb at its kind's ratio (UI-D-439).
 */
function UnlockRow({ row }: { row: ProductUnlockRow }) {
  if (row.href !== null) {
    return (
      <li>
        <a
          href={row.href}
          aria-label={row.ariaLabel}
          data-store-unlock-row="open"
          data-store-unlock-kind={row.kind}
          className={cn(
            UNLOCK_ROW,
            'text-text transition-colors hover:bg-card-hover active:bg-bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
          )}
        >
          <UnlockThumb assetId={row.coverAssetId} ratio={row.thumbRatio} />
          <UnlockText row={row} />
          <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
        </a>
      </li>
    );
  }
  return (
    <li
      aria-label={row.ariaLabel}
      data-store-unlock-row="locked"
      data-store-unlock-kind={row.kind}
      className={UNLOCK_ROW}
    >
      <UnlockThumb assetId={row.coverAssetId} ratio={row.thumbRatio} />
      <UnlockText row={row} />
      <Lock aria-hidden size={16} className="shrink-0 text-text-tertiary" />
    </li>
  );
}
