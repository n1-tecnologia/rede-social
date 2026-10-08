'use server';

import { setModuleBodySchema, TOGGLEABLE_MODULES } from '@rede-social/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { platformRedirectPath } from '@/lib/platform';

/** What `setModuleAction` hands back to the switch row — a state and a stable code, never copy. */
export type SetModuleResult = { ok: true } | { ok: false; code: string };

const tenantIdSchema = z.uuid();
/**
 * Every toggleable key (D-16; `TOGGLEABLE_MODULES`, `store` included since 08.2-05), the same
 * vocabulary as the API's route param. The reference module is not a key and can never be sent (D-19).
 */
const moduleKeySchema = z.enum(TOGGLEABLE_MODULES);

/**
 * `PUT /v1/platform/tenants/{id}/modules/{key}` (ROLE-04, MOD-04, D-16): flips one module of one
 * tenant. The key is validated against `TOGGLEABLE_MODULES` BEFORE any request (the API's route
 * param enum refuses any other key with 400 as the second layer, T-02-97) and the body
 * against the API's own `setModuleBodySchema`. On 200 the tenant layout is revalidated so the row
 * re-renders from the server (the API upserted `tenant_modules` and invalidated its flags cache —
 * other instances converge within `MODULE_FLAGS_TTL_MS`). 401/403 navigate like every platform read
 * (`redirect()` after the try/catch — Next 16 rule); every other refusal returns its envelope code.
 */
export async function setModuleAction(
  tenantId: string,
  key: string,
  enabled: boolean,
): Promise<SetModuleResult> {
  const id = tenantIdSchema.safeParse(tenantId);
  const parsedKey = moduleKeySchema.safeParse(key);
  const body = setModuleBodySchema.safeParse({ enabled });
  if (!id.success || !parsedKey.success || !body.success) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }

  let refusal: string | null = null;
  let outcome: SetModuleResult;
  try {
    const res = await apiFetch(
      `/v1/platform/tenants/${encodeURIComponent(id.data)}/modules/${parsedKey.data}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.data),
      },
    );
    if (res.ok) {
      revalidatePath(`/plataforma/tenants/${id.data}`, 'layout');
      revalidatePath('/plataforma');
      outcome = { ok: true };
    } else {
      const envelope = (await res.json().catch(() => null)) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      } | null;
      const code = envelope?.error?.code ?? 'HTTP_ERROR';
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(
          new ApiClientError(
            res.status,
            code,
            envelope?.error?.details,
            envelope?.error?.requestId,
          ),
        );
      } else {
        console.error('platform.modules.set_failed', { status: res.status, code });
      }
      outcome = { ok: false, code };
    }
  } catch (error) {
    console.error('platform.modules.set_failed', { error: String(error) });
    outcome = { ok: false, code: 'NETWORK_ERROR' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}
