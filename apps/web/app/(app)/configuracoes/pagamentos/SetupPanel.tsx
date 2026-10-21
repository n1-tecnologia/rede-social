'use client';

import { useState } from 'react';
import type { AccessProductView, SetupView } from '@/lib/payments-view';
import { AccessProductsCard } from './AccessProductsCard';
import { IntegrationCard } from './IntegrationCard';

export interface SetupPanelProps {
  view: SetupView;
}

/**
 * The Configuração tab's body (09.1-13, UI-D-513): three sections in the order an admin does the
 * setup, Integração, Produtos de acesso, Quem pode entrar, under the shipped body rhythm
 * `flex flex-col gap-6 px-4 pb-6` (`md:px-0`).
 *
 * The panel owns what the sections share: the product list (the gate row derives from it whether a
 * door exists) and the gate flag (the products card refuses to drop the last product while it is on).
 * Both are seeded from the server's overview and changed only from the server's answers.
 */
export function SetupPanel({ view }: SetupPanelProps) {
  const [products, setProducts] = useState<AccessProductView[]>(view.products);
  const gateRequired = view.gate.required;

  return (
    <div data-testid="payments-setup" className="flex flex-col gap-6 px-4 pb-6 md:px-0">
      <IntegrationCard view={view.integration} />
      <AccessProductsCard
        gatewayName={view.integration.gatewayName}
        tenantName={view.tenantName}
        products={products}
        gateRequired={gateRequired}
        onProductsChange={setProducts}
      />
    </div>
  );
}
