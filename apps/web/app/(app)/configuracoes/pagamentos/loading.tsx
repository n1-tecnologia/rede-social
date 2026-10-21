import { PaymentsSkeleton } from '@rede-social/module-payments/ui';

/**
 * `/configuracoes/pagamentos/loading.tsx` (09.1-13, UI-D-528, E01 loading): ROLE-NEUTRAL, the
 * `PageHeader` bar and the tab row first, so the frame never waits on a body, then the Configuração
 * skeleton (the integration card, a three-row list card and the gate card in their own geometry).
 * No words: the skeleton says nothing about the page it waits for.
 */
export default function PaymentsLoading() {
  return <PaymentsSkeleton variant="setup" />;
}
