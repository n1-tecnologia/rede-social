'use server';

import {
  type LockPreview,
  lockPreviewBodySchema,
  type ProductStatus,
  productInputSchema,
  productPatchSchema,
  productStatusBodySchema,
  STORE_ISSUE_SET,
  type StoreIssue,
} from '@rede-social/module-store/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ZodError } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import {
  createProduct,
  getProduct,
  lockPreview,
  type ProductWriteOutcome,
  setProductStatus,
  updateProduct,
} from '@/lib/store';

/**
 * The product writes: the product page's (and the product form's) archive or reactivate (`PUT …/status`, idempotent; it
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

/* ── 08.2-10: the product form's writes (D-362, D-363, D-364) ───────────────────────────────── */

/**
 * What a product save answers. Every refusal is a CODE the client maps to copy (nothing
 * server-controlled reaches the DOM): the API's closed `StoreIssue` vocabulary (field errors drawn
 * under their field), `not_found` (the product vanished under the admin), or `generic`.
 */
export type ProductWriteResult =
  | { ok: true; productId: string }
  | { ok: false; code: StoreIssue | 'not_found' | 'generic' };

/** The first closed store issue a local parse refused with, else `generic`. */
function parseRefusal(error: ZodError): ProductWriteResult {
  const issue = error.issues
    .map((problem) => problem.message)
    .find((message) => STORE_ISSUE_SET.has(message));
  return { ok: false, code: (issue as StoreIssue | undefined) ?? 'generic' };
}

/**
 * Maps `lib/store.ts`'s outcome to the form's codes. A bare 404 on a write that carried an image is
 * told apart the way the community form tells its cover apart (05-09): the API answers ONE
 * indistinguishable 404 for an unknown product and an unknown or foreign image asset (D-23), so the
 * BFF decides by a fact: on a create there is no product to miss, so it was the image; on an edit
 * the product is re-read, and if it still reads back the 404 was the image.
 */
async function writeResult(
  outcome: ProductWriteOutcome,
  sentImage: boolean,
  productId: string | null,
): Promise<{ result: ProductWriteResult; refusal: string | null }> {
  switch (outcome.status) {
    case 'ok':
      return { result: { ok: true, productId: outcome.product.id }, refusal: null };
    case 'issue':
      return { result: { ok: false, code: outcome.issue }, refusal: null };
    case 'redirect':
      return { result: { ok: false, code: 'generic' }, refusal: outcome.path };
    case 'gone': {
      if (!sentImage) return { result: { ok: false, code: 'not_found' }, refusal: null };
      if (productId === null)
        return { result: { ok: false, code: 'image_invalid' }, refusal: null };
      const product = await getProduct(productId);
      if (product.status === 'redirect') {
        return { result: { ok: false, code: 'generic' }, refusal: product.path };
      }
      return {
        result: { ok: false, code: product.status === 'ok' ? 'image_invalid' : 'not_found' },
        refusal: null,
      };
    }
    default:
      return { result: { ok: false, code: 'generic' }, refusal: null };
  }
}

/**
 * `POST /v1/store/products` (D-362, STORE-02). The SAME `productInputSchema` the route validates
 * with runs BEFORE the request (a server action is a public endpoint), a refusal is a code, and
 * `redirect()` runs outside any try/catch (Next 16: it throws).
 */
export async function createProductAction(input: unknown): Promise<ProductWriteResult> {
  const body = productInputSchema.safeParse(input);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = await writeResult(
    await createProduct(body.data),
    body.data.imageAssetId !== null,
    null,
  );

  if (refusal) redirect(refusal);
  if (result.ok) {
    revalidatePath('/loja');
    revalidatePath(`/loja/${result.productId}`);
  }
  return result;
}

/**
 * `PATCH /v1/store/products/{productId}` (D-363): only the keys the admin changed, parsed with the
 * patch contract (no defaults: an omitted key is left alone). `communityIds`, when sent, replaces the
 * whole link set; this form is the one place links are written.
 */
export async function updateProductAction(
  productId: string,
  patch: unknown,
): Promise<ProductWriteResult> {
  if (typeof productId !== 'string' || !UUID.test(productId)) return { ok: false, code: 'generic' };
  const body = productPatchSchema.safeParse(patch);
  if (!body.success) return parseRefusal(body.error);

  const { result, refusal } = await writeResult(
    await updateProduct(productId, body.data),
    typeof body.data.imageAssetId === 'string',
    productId,
  );

  if (refusal) redirect(refusal);
  if (result.ok) {
    revalidatePath('/loja');
    revalidatePath(`/loja/${productId}`);
  }
  return result;
}

/** The lock preview's answer to the form: the rows, or a failure that must abort the save. */
export type LockPreviewResult = { ok: true; items: LockPreview['items'] } | { ok: false };

/**
 * `POST /v1/store/products/lock-preview` (D-364, STORE-04): asked BEFORE a save whose selection adds
 * a community that is not among the product's saved links. Any failure is `{ ok: false }` and the
 * form saves nothing (the prohibition: a community never locks without the admin seeing who loses
 * access). A read: nothing is revalidated.
 */
export async function lockPreviewAction(input: unknown): Promise<LockPreviewResult> {
  const body = lockPreviewBodySchema.safeParse(input);
  if (!body.success) return { ok: false };

  const outcome = await lockPreview(body.data);
  if (outcome.status === 'redirect') redirect(outcome.path);
  return outcome.status === 'ok' ? { ok: true, items: outcome.preview.items } : { ok: false };
}
