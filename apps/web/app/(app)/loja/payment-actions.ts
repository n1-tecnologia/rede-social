'use server';

import { storeMappingBodySchema } from '@rede-social/module-payments/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteStoreMapping, putStoreMapping } from '@/lib/payments';

/**
 * The product form's SECOND write (09.1-17, PAY-20, D-502, A-P12, T-09.1-80): the gateway product that
 * sells a store product. The store and payments modules cannot share a transaction (MOD-02), so the
 * form saves the store product first and calls this action after; a failure here leaves the product
 * saved and the form keeps its typed values.
 *
 * - the SAME Zod the API validates with runs BEFORE any request (a server action is a public
 *   endpoint): a link without an ID, a link that is not an `https:` checkout link and an ID past the
 *   cap are refused here and never leave the server;
 * - both fields empty is a DELETE, anything else is a PUT (the PUT replaces, the DELETE of nothing
 *   answers the same, so a retry is safe);
 * - the product id is a uuid and the API decides whether it belongs to this tenant (the bare 404): this
 *   action never decides ownership;
 * - a refusal the bootstrap knows becomes a navigation OUTSIDE any try/catch (Next 16: `redirect()`
 *   throws); every other refusal is a closed code the form maps to a field error or the save toast.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

/** The closed answer the form maps: ok, or one of three field issues, or anything else as `generic`. */
export type PaymentMappingOutcome =
  | { ok: true }
  | { ok: false; issue: 'id_required' | 'id_taken' | 'link_invalid' | 'generic' };

const productIdSchema = z.uuid();

export async function savePaymentMappingAction(
  productId: string,
  input: { externalProductId: string; checkoutUrl: string },
): Promise<PaymentMappingOutcome> {
  const target = productIdSchema.safeParse(productId);
  if (!target.success) return { ok: false, issue: 'generic' };
  const externalProductId =
    typeof input?.externalProductId === 'string' ? input.externalProductId.trim() : '';
  const checkoutUrl = typeof input?.checkoutUrl === 'string' ? input.checkoutUrl.trim() : '';

  let outcome: Awaited<ReturnType<typeof putStoreMapping>>;
  if (externalProductId === '' && checkoutUrl === '') {
    outcome = await deleteStoreMapping(target.data);
  } else {
    const body = storeMappingBodySchema.safeParse({
      externalProductId,
      ...(checkoutUrl === '' ? {} : { checkoutUrl }),
    });
    if (!body.success) {
      const messages = body.error.issues.map((issue) => issue.message);
      if (messages.includes('gateway_product_id_required')) {
        return { ok: false, issue: 'id_required' };
      }
      if (messages.includes('link_invalid')) return { ok: false, issue: 'link_invalid' };
      return { ok: false, issue: 'generic' };
    }
    outcome = await putStoreMapping(target.data, {
      externalProductId: body.data.externalProductId ?? externalProductId,
      ...(body.data.checkoutUrl ? { checkoutUrl: body.data.checkoutUrl } : {}),
    });
  }

  if (outcome.ok) {
    revalidatePath('/loja');
    revalidatePath(`/loja/${target.data}`);
    return { ok: true };
  }
  if (outcome.reason === 'redirect') redirect(outcome.path);
  switch (outcome.reason) {
    case 'id_required':
    case 'id_taken':
    case 'link_invalid':
      return { ok: false, issue: outcome.reason };
    default:
      return { ok: false, issue: 'generic' };
  }
}
