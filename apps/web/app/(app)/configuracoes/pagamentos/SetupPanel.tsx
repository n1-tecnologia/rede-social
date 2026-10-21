'use client';

import { useState } from 'react';
import type { AccessProductView, SetupView } from '@/lib/payments-view';
import { AccessProductsCard } from './AccessProductsCard';
import { GateSwitchRow } from './GateSwitchRow';
import { IntegrationCard } from './IntegrationCard';

export interface SetupPanelProps {
  view: SetupView;
}

/**
 * The Configuração tab's body (09.1-13, UI-D-513): three sections in the order an admin does the
 * setup, Integração, Produtos de acesso, Quem pode entrar, under the shipped body rhythm
 * `flex flex-col gap-6 px-4 pb-6` (`md:px-0`).
 *
 * The panel owns what the sections share, all seeded from the server's overview and changed only from
 * the server's answers: whether the integration is connected and the product list (together they say
 * whether the gate CAN be switched on, A-UI-2: the API re-enforces it with 409 `gate_requires_setup`),
 * and the gate flag (the products card refuses to drop the last product while it is on).
 */
export function SetupPanel({ view }: SetupPanelProps) {
  const [connected, setConnected] = useState(view.integration.connected);
  const [products, setProducts] = useState<AccessProductView[]>(view.products);
  const [gateRequired, setGateRequired] = useState(view.gate.required);

  return (
    <div data-testid="payments-setup" className="flex flex-col gap-6 px-4 pb-6 md:px-0">
      <IntegrationCard view={view.integration} onConnected={() => setConnected(true)} />
      <AccessProductsCard
        gatewayName={view.integration.gatewayName}
        tenantName={view.tenantName}
        products={products}
        gateRequired={gateRequired}
        onProductsChange={setProducts}
      />
      <GateSwitchRow
        tenantName={view.tenantName}
        required={gateRequired}
        canEnable={connected && products.length > 0}
        onRequiredChange={setGateRequired}
      />
    </div>
  );
}
