import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getProduct } from '@/lib/store';
import { listBuyers } from '@/lib/store-admin';
import { buyerRowView } from '@/lib/store-view';
import { BuyersList } from './BuyersList';

/**
 * `/loja/[productId]/compradores` (08.2-11, D-359, D-360, STORE-09, STORE-10, UI-D-380): who holds
 * this product, purchase told apart from grant, with a revoke on every row and "Conceder acesso".
 * The Participantes page shape.
 *
 * **Permission first, then the reads.** Without `store.product.manage` in `bootstrap.permissions`
 * (the composed permission, never a role comparison) the page is `notFound()` and nothing is
 * requested (T-08.2-47); the store being off is caught by `loja/layout.tsx` before this runs. The
 * API's own guard on every buyers route and the definers' admin re-check are the independent second
 * gate (08.2-06).
 *
 * The product (its name, and whether it unlocks communities, which picks the revoke and grant copy)
 * and the first buyers page load in parallel. Every miss is the store's one not-found, including a
 * permission lost since the bootstrap; a product read failure is the error card with a retry, and a
 * buyers read failure is the list's own first-load error (the toolbar stays). Every row is built
 * HERE, its date in the TENANT's timezone (UI-D-380): the client list formats nothing.
 */
export default async function BuyersPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations()]);
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!storeOn || !bootstrap.permissions.includes(STORE_PERMISSIONS.manage)) notFound();

  const [product, buyers] = await Promise.all([getProduct(productId), listBuyers(productId)]);
  if (product.status === 'redirect') redirect(product.path);
  if (buyers.status === 'redirect') redirect(buyers.path);
  if (product.status === 'not-found' || product.status === 'disabled') notFound();
  if (buyers.status === 'not-found' || buyers.status === 'forbidden') notFound();

  const productHref = `/loja/${encodeURIComponent(productId)}`;
  const header = (
    <PageHeader
      backHref={productHref}
      backLabel={t('store.buyers.back')}
      title={t('store.buyers.title')}
    />
  );

  if (product.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-[680px] pb-6">
        {header}
        <div className="px-4 pt-4">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="buyers-error"
            title={t('store.errors.title')}
            body={t('store.errors.buyers')}
            action={
              <a
                href={`${productHref}/compradores`}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {t('store.errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  const communitiesOn = bootstrap.modules.some((module) => module.key === 'communities');
  const hasCommunities = communitiesOn && product.product.communities.length > 0;
  const timezone = bootstrap.tenant.timezone;
  const page = buyers.status === 'ok' ? buyers.page : null;

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6" data-store-buyers>
      {header}
      <BuyersList
        productId={product.product.id}
        productName={product.product.name}
        hasCommunities={hasCommunities}
        tenantName={bootstrap.tenant.displayName}
        initialItems={(page?.items ?? []).map((buyer) => buyerRowView(buyer, { timezone }, t))}
        initialCursor={page?.nextCursor ?? null}
        initialTotal={page?.total ?? 0}
        initialError={page === null}
      />
    </div>
  );
}
