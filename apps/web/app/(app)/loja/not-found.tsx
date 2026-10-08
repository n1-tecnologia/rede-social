import { EmptyState } from '@rede-social/ui';
import { ShoppingBag } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * "Produto indisponível" (UI-D-384, E04 error): the ONE screen every product miss under `/loja`
 * lands on. Three causes reach it and must stay indistinguishable (an existence oracle over an
 * enumerable uuid space otherwise): an unknown id, another tenant's product, and an archived product
 * for someone who neither holds nor manages it. The API answers one bare 404 for all three.
 *
 * It takes no props and reads no param, so it cannot echo the id. The store being OFF never lands
 * here: `layout.tsx` throws that `notFound()` from the layout, which the parent's (generic) boundary
 * catches (UI-D-387).
 */
export default async function StoreNotFound() {
  const t = await getTranslations('store');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 px-4 pt-4">
      <EmptyState
        variant="card"
        icon={ShoppingBag}
        data-testid="store-not-found"
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <a
            href="/loja"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('notFound.cta')}
          </a>
        }
      />
    </div>
  );
}
