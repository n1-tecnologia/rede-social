'use server';

import { saveIntegrationBodySchema } from '@rede-social/module-payments/contracts';
import { redirect } from 'next/navigation';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { PaymentsApiError, saveIntegration } from '@/lib/payments';

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
export type PaymentsFailureCode = 'token_required' | 'forbidden' | 'generic';

export type SaveIntegrationOutcome = { ok: true } | { ok: false; code: PaymentsFailureCode };

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
    if (error.issue === 'token_required') return { code: 'token_required' };
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
