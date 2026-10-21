'use server';

import {
  type AccessProduct,
  accessProductBodySchema,
  accessProductPatchSchema,
  gateBodySchema,
  saveIntegrationBodySchema,
} from '@rede-social/module-payments/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import {
  createAccessProduct,
  PaymentsApiError,
  previewGate,
  removeAccessProduct,
  saveIntegration,
  setGate,
  updateAccessProduct,
} from '@/lib/payments';

/**
 * The Pagamentos screen's server actions (09.1-13, D-491, D-501, D-502, PAY-04), in the
 * `membros/actions.ts` conventions:
 *
 * - the SAME Zod the API validates with runs BEFORE the request (a server action is a public
 *   endpoint), so a malformed value is refused here and never reaches the API;
 * - a 401/403 refusal the bootstrap knows becomes a navigation OUTSIDE the try/catch (Next 16:
 *   `redirect()` throws);
 * - every other refusal is a code from a CLOSED set that the client maps to catalog copy;
 * - logs carry the shape only (status and code). **The webhook token is never returned, echoed or
 *   logged** (D-486, T-09.1-60): it enters `saveIntegrationAction` once and leaves in the request body.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

/** Why an action did not do its job: a code the client maps to catalog copy. */
export type PaymentsFailureCode =
  | 'token_required'
  | 'name_required'
  | 'product_id_required'
  | 'gateway_product_taken'
  | 'link_invalid'
  | 'last_access_product'
  | 'gate_requires_setup'
  | 'forbidden'
  | 'generic';

export type SaveIntegrationOutcome = { ok: true } | { ok: false; code: PaymentsFailureCode };

/** The refusals of the API that have a screen line; every other issue reads as `generic`. */
const ISSUE_CODES: Partial<Record<string, PaymentsFailureCode>> = {
  token_required: 'token_required',
  name_required: 'name_required',
  product_id_required: 'product_id_required',
  // A store mapping's twin of the same field error; the access sheet reads it the same way.
  gateway_product_id_required: 'product_id_required',
  gateway_product_taken: 'gateway_product_taken',
  link_invalid: 'link_invalid',
  last_access_product: 'last_access_product',
  gate_requires_setup: 'gate_requires_setup',
};

/**
 * The ONE mapping of a failed call: either a navigation the caller performs OUTSIDE its try/catch
 * (a session or membership refusal), or the closed code. Anything unrecognised is `generic` and is
 * logged by shape only.
 */
function failureOf(
  error: unknown,
  label: string,
): { navigate: string } | { code: PaymentsFailureCode } {
  if (error instanceof ApiClientError) {
    const path = bootstrapRedirectPath(error);
    if (path) return { navigate: path };
  }
  if (error instanceof PaymentsApiError) {
    const code = ISSUE_CODES[error.issue ?? ''];
    if (code) return { code };
    if (error.status === 403 && error.code === 'FORBIDDEN') return { code: 'forbidden' };
  }
  console.error(`payments.${label}_failed`, {
    ...(error instanceof PaymentsApiError || error instanceof ApiClientError
      ? { status: error.status, code: error.code }
      : { error: error instanceof Error ? error.name : 'unknown' }),
  });
  return { code: 'generic' };
}

/**
 * `PUT /v1/payments/integration { token }`. The token is validated with `saveIntegrationBodySchema`
 * (trimmed, 1 to 512 characters) before any request; an empty one is the field error. The answer
 * carries NO token and no connection detail: the client already knows it is connected.
 */
export async function saveIntegrationAction(token: string): Promise<SaveIntegrationOutcome> {
  const body = saveIntegrationBodySchema.safeParse({ token });
  if (!body.success) {
    const empty = body.error.issues.some((issue) => issue.message === 'token_required');
    return { ok: false, code: empty ? 'token_required' : 'generic' };
  }

  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    await saveIntegration(body.data);
    return { ok: true };
  } catch (error) {
    mapped = failureOf(error, 'save_integration');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}

/** What the access product actions answer: the product the server returned, or a closed code. */
export type AccessProductOutcome =
  | { ok: true; product: AccessProduct }
  | { ok: false; code: PaymentsFailureCode };

export type RemoveAccessProductOutcome =
  | { ok: true; id: string }
  | { ok: false; code: PaymentsFailureCode };

const productIdSchema = z.uuid();

/** The first Zod message the screen has a line for, else `generic` (a too-long value cannot be typed). */
function validationCode(error: z.ZodError): PaymentsFailureCode {
  for (const issue of error.issues) {
    const code = ISSUE_CODES[issue.message];
    if (code) return code;
  }
  return 'generic';
}

/**
 * `POST /v1/payments/access-products` (D-494, D-502). The SAME Zod the API validates with runs first:
 * an empty name, an empty ID or a link that is not `https:` is refused here and never leaves the
 * server action. A held gateway ID is the API's 409 `gateway_product_taken` (the body names no tenant).
 */
export async function createAccessProductAction(input: {
  name: string;
  externalProductId: string;
  checkoutUrl: string;
}): Promise<AccessProductOutcome> {
  const body = accessProductBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: validationCode(body.error) };

  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    return { ok: true, product: await createAccessProduct(body.data) };
  } catch (error) {
    mapped = failureOf(error, 'create_product');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}

/** `PATCH /v1/payments/access-products/{id}`: only the keys the sheet changed are sent. */
export async function updateAccessProductAction(
  id: string,
  patch: { name?: string; externalProductId?: string; checkoutUrl?: string },
): Promise<AccessProductOutcome> {
  const target = productIdSchema.safeParse(id);
  const body = accessProductPatchSchema.safeParse(patch);
  if (!target.success) return { ok: false, code: 'generic' };
  if (!body.success) return { ok: false, code: validationCode(body.error) };

  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    return { ok: true, product: await updateAccessProduct(target.data, body.data) };
  } catch (error) {
    mapped = failureOf(error, 'update_product');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}

/**
 * `DELETE /v1/payments/access-products/{id}`. The API refuses the last product while the gate is on
 * (409 `last_access_product`, T-09.1-61); a product that is already gone (the bare 404) is the
 * outcome the admin asked for, so it answers `ok` and the row leaves the list.
 */
export async function removeAccessProductAction(id: string): Promise<RemoveAccessProductOutcome> {
  const target = productIdSchema.safeParse(id);
  if (!target.success) return { ok: false, code: 'generic' };

  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    await removeAccessProduct(target.data);
    return { ok: true, id: target.data };
  } catch (error) {
    if (error instanceof PaymentsApiError && error.status === 404 && error.issue === null) {
      if (error.code !== 'MODULE_DISABLED') return { ok: true, id: target.data };
    }
    mapped = failureOf(error, 'remove_product');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}

/** What the preview answers: the members this tenant would cut, staff excluded (D-492). */
export type PreviewGateOutcome =
  | { ok: true; count: number }
  | { ok: false; code: PaymentsFailureCode };

/** What the gate write answers: the switch as stored and the rows the server released itself. */
export type SetGateOutcome =
  | { ok: true; required: boolean; released: number }
  | { ok: false; code: PaymentsFailureCode };

/**
 * `GET /v1/payments/gate/preview` (PAY-31, D-492): how many members of this tenant, staff excluded,
 * have no usable access and would be cut by switching the gate on. A snapshot: the write that follows
 * releases whoever has no access WHEN IT RUNS, so the toast reports the write's figure, never this one.
 * A failed read is a failed preview: the screen saves nothing without an answer.
 */
export async function previewGateAction(): Promise<PreviewGateOutcome> {
  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    const { count } = await previewGate();
    return { ok: true, count };
  } catch (error) {
    mapped = failureOf(error, 'preview_gate');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}

/**
 * `PUT /v1/payments/gate { required, releaseExisting? }` (D-491, PAY-08, PAY-31). The flip and the
 * release are ONE write on the server, so a failure releases nothing. The API re-enforces the gate's
 * preconditions (409 `gate_requires_setup`, T-09.1-61); this action only carries the admin's intent.
 */
export async function setGateAction(input: {
  required: boolean;
  releaseExisting?: boolean;
}): Promise<SetGateOutcome> {
  const body = gateBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: 'generic' };

  let mapped: { navigate: string } | { code: PaymentsFailureCode };
  try {
    const result = await setGate(body.data);
    return { ok: true, required: result.required, released: result.released };
  } catch (error) {
    mapped = failureOf(error, 'set_gate');
  }
  if ('navigate' in mapped) redirect(mapped.navigate);
  return { ok: false, code: mapped.code };
}
