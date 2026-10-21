'use client';

import type { AccessProduct } from '@rede-social/module-payments/contracts';
import { Button, Card, EmptyState, SectionTitle, StatusPill } from '@rede-social/ui';
import { ChevronRight, CreditCard, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState } from 'react';
import {
  type AccessProductView,
  accessProductView,
  type PaymentsTranslator,
  withFeedsMark,
} from '@/lib/payments-view';
import { AccessProductSheet } from './AccessProductSheet';

export interface AccessProductsCardProps {
  /** The adapter's display name, the `{gateway}` of the empty state and the sheet labels. */
  gatewayName: string;
  tenantName: string;
  /** Creation order, oldest first. Owned by the host, which derives the gate's `canEnable` from it. */
  products: readonly AccessProductView[];
  /** The gate is on: the last product cannot be removed (409 `last_access_product`). */
  gateRequired: boolean;
  onProductsChange: (products: AccessProductView[]) => void;
}

/** Which product the sheet is open on: a new one, or one by id. */
type SheetTarget = { kind: 'create' } | { kind: 'edit'; id: string };

/**
 * Produtos de acesso (09.1-13, UI-D-515, D-488, D-494, D-502, A-UI-1, A-UI-7): what the admin registers
 * so that a purchase at the gateway opens the community. Either the card `EmptyState` with its outline
 * action, or one row per product in creation order and the outline add button below.
 *
 * **The list is changed from the server's answers, never optimistically**: a create appends the row
 * the API returned, an edit replaces it, a removal drops it. After each change exactly one row, the
 * first with a link, carries "Usado no botão Assinar" (`withFeedsMark`, the rule the API applies on
 * every read), since one write answers only the row it touched.
 *
 * A row is a button that opens the edit sheet. The name and the ID are `truncate` inside
 * `min-w-0 flex-1`, so a 120-character name never pushes the pills or the chevron off a 320px row. The
 * checkout link is never drawn here (T-09.1-62).
 */
export function AccessProductsCard({
  gatewayName,
  tenantName,
  products,
  gateRequired,
  onProductsChange,
}: AccessProductsCardProps) {
  const t = useTranslations();
  const tView = t as unknown as PaymentsTranslator;
  const titleId = useId();
  const [target, setTarget] = useState<SheetTarget | null>(null);

  const closeSheet = useCallback(() => setTarget(null), []);
  const editing =
    target?.kind === 'edit' ? (products.find((product) => product.id === target.id) ?? null) : null;

  function saved(product: AccessProduct) {
    const view = accessProductView(product, tView);
    const exists = products.some((current) => current.id === view.id);
    onProductsChange(
      withFeedsMark(
        exists
          ? products.map((current) => (current.id === view.id ? view : current))
          : [...products, view],
      ),
    );
    setTarget(null);
  }

  function removed(id: string) {
    onProductsChange(withFeedsMark(products.filter((product) => product.id !== id)));
    setTarget(null);
  }

  const add = (
    <Button variant="outline" size="sm" hitArea onClick={() => setTarget({ kind: 'create' })}>
      <Plus aria-hidden size={16} />
      {t('payments.products.add')}
    </Button>
  );

  return (
    <section className="flex flex-col gap-2">
      <div>
        <SectionTitle id={titleId}>{t('payments.products.title')}</SectionTitle>
        <p className="mt-1 text-sm font-normal text-text-secondary">
          {t('payments.products.helper', { tenant: tenantName })}
        </p>
      </div>

      {products.length === 0 ? (
        <EmptyState
          variant="card"
          icon={CreditCard}
          title={t('payments.products.empty.title')}
          body={t('payments.products.empty.body', { gateway: gatewayName })}
          action={
            <Button variant="outline" onClick={() => setTarget({ kind: 'create' })}>
              {t('payments.products.empty.action')}
            </Button>
          }
        />
      ) : (
        <>
          <Card className="p-0">
            <ul aria-labelledby={titleId} className="divide-y divide-divider">
              {products.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => setTarget({ kind: 'edit', id: product.id })}
                    className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-tertiary">
                      <CreditCard aria-hidden size={20} className="text-text-secondary" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-bold text-text">{product.name}</span>
                      <span className="truncate text-xs font-normal tabular-nums text-text-tertiary">
                        {product.idMeta}
                      </span>
                      {!product.hasLink || product.feedsButton ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {product.hasLink ? null : (
                            <StatusPill tone="warning">{t('payments.products.noLink')}</StatusPill>
                          )}
                          {product.feedsButton ? (
                            <StatusPill tone="neutral">
                              {t('payments.products.feedsButton')}
                            </StatusPill>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight aria-hidden size={18} className="shrink-0 text-text-tertiary" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="mt-1">{add}</div>
        </>
      )}

      <AccessProductSheet
        key={target === null ? 'closed' : target.kind === 'edit' ? target.id : 'new'}
        open={target !== null && (target.kind === 'create' || editing !== null)}
        product={editing}
        gatewayName={gatewayName}
        removalBlocked={gateRequired && products.length === 1}
        onClose={closeSheet}
        onSaved={saved}
        onRemoved={removed}
      />
    </section>
  );
}
