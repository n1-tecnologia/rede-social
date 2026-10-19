import type { ReactNode } from 'react';
import type { OwnerFinanceView } from '@/lib/owner-finance-view';
import type { FinanceScreenProps } from './OwnerFinance';

export interface OwnerFinanceProductDetailProps extends FinanceScreenProps {
  view: OwnerFinanceView & { productId: string };
  /** The level above (Produtos, or Visão geral): a product the API does not know falls back to it. */
  fallback: ReactNode;
}

/**
 * Inert until 08.7-10 Task 2 (it reads `GET …/finance/products/{productId}` there): it renders the
 * level above, so no fixture product is ever shown.
 */
export async function OwnerFinanceProductDetail({
  fallback,
}: OwnerFinanceProductDetailProps): Promise<ReactNode> {
  return fallback;
}

/** Inert until 08.7-10 Task 2's GREEN. */
export function OwnerFinanceProductDetailView(_props: unknown): ReactNode {
  return null;
}
