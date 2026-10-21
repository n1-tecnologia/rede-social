'use client';

import { PaymentsSkeleton } from '@rede-social/module-payments/ui';
import { useSearchParams } from 'next/navigation';
import { paymentsTabFromParam } from './tabs';

/**
 * `/configuracoes/pagamentos/loading.tsx` (09.1-13, 09.1-14, UI-D-528, E01/E05 loading): ROLE-NEUTRAL,
 * the `PageHeader` bar and the tab row first, so the frame never waits on a body, then the skeleton of
 * the tab the URL asks for: Configuração (the integration card, a three-row list card and the gate
 * card) or Acessos (the toolbar's shape and 8 access rows). It reads `?aba=` with the SAME parser the
 * page uses, so the two always agree on the tab. No words: the skeleton says nothing about the page it
 * waits for.
 */
export default function PaymentsLoading() {
  const tab = paymentsTabFromParam(useSearchParams().get('aba') ?? undefined);
  return <PaymentsSkeleton variant={tab === 'access' ? 'access' : 'setup'} />;
}
