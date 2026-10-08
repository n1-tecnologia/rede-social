'use server';

import { type ProductStatus, productStatusBodySchema } from '@rede-social/module-store/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { setProductStatus } from '@/lib/store';

/**
 * The product page's write action (08.2-07): archive or reactivate (`PUT …/status`, idempotent; it
 * touches no link and no entitlement, so nobody loses access). Kept apart from the grid's read
 * actions in `actions.ts`.
 *
 * The body is validated with the API's own schema before any request, and the id must look like a
 * uuid (a server action is a public endpoint). A refusal the bootstrap knows navigates OUTSIDE the
 * try/catch; anything else answers a code the client maps to a toast.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductStatusResult = { ok: true } | { ok: false; code: 'not_found' | 'generic' };

export async function setProductStatusAction(
  productId: string,
  status: ProductStatus,
): Promise<ProductStatusResult> {
  const body = productStatusBodySchema.safeParse({ status });
  if (!body.success || typeof productId !== 'string' || !UUID.test(productId)) {
    return { ok: false, code: 'generic' };
  }

  let refusal: string | null = null;
  let result: ProductStatusResult = { ok: false, code: 'generic' };
  try {
    await setProductStatus(productId, body.data.status);
    result = { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 404) result = { ok: false, code: 'not_found' };
    }
    if (!refusal) {
      console.error('store.status_failed', {
        ...(error instanceof ApiClientError
          ? { status: error.status, code: error.code }
          : { error: String(error) }),
      });
    }
  }

  if (refusal) redirect(refusal);
  if (result.ok) {
    revalidatePath('/loja');
    revalidatePath(`/loja/${productId}`);
  }
  return result;
}
