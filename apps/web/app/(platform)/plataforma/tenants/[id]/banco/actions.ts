'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { platformRedirectPath } from '@/lib/platform';
import { revalidateTenantViews } from '@/lib/revalidate-tenant';

/**
 * Server actions of the Banco tab (09.2-19, UI-D-536..538) over 09.2-14's
 * `/v1/platform/tenants/{id}/database/*`. Conventions of the Domínios tab: every id through
 * `z.uuid()` before any request, the API decides (it re-authorises with `requireSuperAdmin()`),
 * 401/403 navigate through `platformRedirectPath` with `redirect()` called AFTER the try/catch (the
 * Next 16 rule), and every answer that may have changed a row revalidates the tenant views.
 *
 * Nothing here ever returns a value the operator typed or the API sealed: the answers are
 * `{ ok }` records and catalog keys, never copy, never a credential (D-539, UI-D-548).
 */

const uuid = z.uuid();

type Envelope = {
  error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
};

async function readEnvelope(res: Response): Promise<ApiClientError> {
  const body = (await res.json().catch(() => null)) as Envelope | null;
  return new ApiClientError(
    res.status,
    body?.error?.code ?? 'HTTP_ERROR',
    body?.error?.details,
    body?.error?.requestId,
  );
}

function databasePath(tenantId: string, suffix = ''): string {
  return `/v1/platform/tenants/${encodeURIComponent(tenantId)}/database${suffix}`;
}

/** What "Verificar agora" hands back to the button: the toast it shows is chosen from this. */
export type VerifyDatabaseResult = { ok: true } | { ok: false };

/**
 * "Verificar agora" - `POST …/database/verify` (D-543): one read-only health check now, then the fresh
 * overview, which the revalidation puts on screen. 409 (the project is still being prepared) and any
 * other refusal answer `{ ok: false }`; a 401/403 navigates.
 */
export async function verifyDatabaseAction(tenantId: string): Promise<VerifyDatabaseResult> {
  if (!uuid.safeParse(tenantId).success) return { ok: false };

  let refusal: string | null = null;
  let outcome: VerifyDatabaseResult;
  try {
    const res = await apiFetch(databasePath(tenantId, '/verify'), { method: 'POST' });
    if (res.ok) {
      revalidateTenantViews(tenantId);
      outcome = { ok: true };
    } else {
      const err = await readEnvelope(res);
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(err);
        outcome = { ok: false };
      } else {
        if (res.status >= 500) {
          console.error('platform.database.verify_failed', { status: res.status, code: err.code });
        }
        outcome = { ok: false };
      }
    }
  } catch (error) {
    console.error('platform.database.verify_failed', { error: String(error) });
    outcome = { ok: false };
  }

  if (refusal) redirect(refusal);
  return outcome;
}
