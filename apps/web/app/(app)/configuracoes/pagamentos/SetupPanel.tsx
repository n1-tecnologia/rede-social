'use client';

import type { SetupView } from '@/lib/payments-view';
import { IntegrationCard } from './IntegrationCard';

export interface SetupPanelProps {
  view: SetupView;
}

/**
 * The Configuração tab's body (09.1-13, UI-D-513): three sections in the order an admin does the
 * setup, Integração, Produtos de acesso, Quem pode entrar, under the shipped body rhythm
 * `flex flex-col gap-6 px-4 pb-6` (`md:px-0`). Task 1 mounts the Integração card; the other two
 * sections take their slots in the tasks that follow.
 */
export function SetupPanel({ view }: SetupPanelProps) {
  return (
    <div data-testid="payments-setup" className="flex flex-col gap-6 px-4 pb-6 md:px-0">
      <IntegrationCard view={view.integration} />
    </div>
  );
}
