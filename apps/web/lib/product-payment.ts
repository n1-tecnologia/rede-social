import { getOverview, getStoreMapping } from '@/lib/payments';
import { type ProductFormPayment, productFormPayment } from '@/lib/store-view';

/**
 * The product form's "Pagamento" block data, read on the server (09.1-17, PAY-20, D-502, UI-D-524). The
 * pages call it only while the `payments` module is on and the viewer holds `payments.manage`; this
 * function reads the gateway's name and connection from the overview and, on an edit, the saved mapping
 * of the product, in one `Promise.all`.
 *
 * **Absent rather than wrong.** Any failed read (the overview throws, the mapping answers a refusal)
 * gives `null`, so the form renders WITHOUT the block and sends no mapping call: a form that showed
 * empty fields over a mapping it could not read would let the admin overwrite it blindly. The failure is
 * logged by shape only (an error name), never an id or a link.
 */
export async function loadProductFormPayment(
  productId: string | null,
): Promise<ProductFormPayment | null> {
  try {
    const [overview, mapping] = await Promise.all([
      getOverview(),
      productId === null ? Promise.resolve(null) : getStoreMapping(productId),
    ]);
    if (mapping !== null && !mapping.ok) return null;
    return productFormPayment(overview.integration, mapping?.mapping ?? null);
  } catch (error) {
    console.error('store.payment_block_unavailable', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}
