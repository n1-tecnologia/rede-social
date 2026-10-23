'use server';

import { replaceCredentialsBodySchema } from '@rede-social/contracts/projects';
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

/** What "Tentar de novo" hands back: a conflict means nothing is failed any more (a double click). */
export type ResumeBootstrapResult = { ok: true } | { ok: false; error: 'conflict' | 'generic' };

/**
 * "Tentar de novo" - `POST …/database/bootstrap/resume` (D-542): the failed step is queued again and
 * every finished step is kept. The API answers 200 for the first click and 409 `CONFLICT` for a second
 * one (nothing is failed any more, P100), which the button swallows: the click already did what it
 * was for. Both answers revalidate, so the list shows where the run stands.
 */
export async function resumeBootstrapAction(tenantId: string): Promise<ResumeBootstrapResult> {
  if (!uuid.safeParse(tenantId).success) return { ok: false, error: 'generic' };

  let refusal: string | null = null;
  let outcome: ResumeBootstrapResult;
  try {
    const res = await apiFetch(databasePath(tenantId, '/bootstrap/resume'), { method: 'POST' });
    if (res.ok) {
      revalidateTenantViews(tenantId);
      outcome = { ok: true };
    } else {
      const err = await readEnvelope(res);
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(err);
        outcome = { ok: false, error: 'generic' };
      } else if (res.status === 409) {
        revalidateTenantViews(tenantId);
        outcome = { ok: false, error: 'conflict' };
      } else {
        if (res.status >= 500) {
          console.error('platform.database.resume_failed', { status: res.status, code: err.code });
        }
        outcome = { ok: false, error: 'generic' };
      }
    }
  } catch (error) {
    console.error('platform.database.resume_failed', { error: String(error) });
    outcome = { ok: false, error: 'generic' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}

/**
 * The poll's probe (UI-D-544, the E05 assumption): does the overview still answer? The Preparação card
 * refreshes the page every 3 s while the run is in progress, and a failed read in a refresh would swap
 * the whole segment for the error screen, so the card asks THIS first and refreshes only on `true`: an
 * API that is down for a tick leaves the last state on screen and the next tick tries again.
 *
 * It answers a boolean and nothing else, never throws and never redirects (a tick must not navigate
 * an operator away from a run they are watching).
 */
export async function pollDatabaseAction(tenantId: string): Promise<boolean> {
  if (!uuid.safeParse(tenantId).success) return false;
  try {
    const res = await apiFetch(databasePath(tenantId));
    return res.ok;
  } catch {
    return false;
  }
}

/** The values the replace sheet sends: any non-empty subset, trimmed by the sheet. */
export type ReplaceCredentialsValues = {
  databasePassword?: string;
  serviceKey?: string;
  publishableKey?: string;
};

/** What the sheet gets back: a flag and a catalog key. NEVER a value - nothing sealed or typed returns. */
export type ReplaceCredentialsResult = { ok: true } | { ok: false; error: 'access' | 'generic' };

/**
 * "Salvar credenciais" - `PUT …/database/credentials` (D-539, DBT-40, UI-D-538). The same Zod the API
 * validates with runs first (an empty body never leaves), then the API tries every supplied value against
 * the project and replaces them only if they all work: 400 `details.access = 'invalid'` means nothing was
 * changed and maps to `access`; every other refusal is `generic`; 401/403 navigate.
 *
 * The values travel from the sheet to the API once, in this call's body. They are never logged (the only
 * log lines carry a status and a code), never echoed, never put in a URL, a cookie or a revalidation tag,
 * and nothing in the answer holds them.
 */
export async function replaceCredentialsAction(
  tenantId: string,
  values: ReplaceCredentialsValues,
): Promise<ReplaceCredentialsResult> {
  if (!uuid.safeParse(tenantId).success) return { ok: false, error: 'generic' };
  const body = replaceCredentialsBodySchema.safeParse({
    ...(values.databasePassword ? { databasePassword: values.databasePassword } : {}),
    ...(values.serviceKey ? { serviceKey: values.serviceKey } : {}),
    ...(values.publishableKey ? { publishableKey: values.publishableKey } : {}),
  });
  if (!body.success) return { ok: false, error: 'generic' };

  let refusal: string | null = null;
  let outcome: ReplaceCredentialsResult;
  try {
    const res = await apiFetch(databasePath(tenantId, '/credentials'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      revalidateTenantViews(tenantId);
      outcome = { ok: true };
    } else {
      const err = await readEnvelope(res);
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(err);
        outcome = { ok: false, error: 'generic' };
      } else if (res.status === 400 && err.details?.access === 'invalid') {
        outcome = { ok: false, error: 'access' };
      } else {
        if (res.status >= 500) {
          console.error('platform.database.credentials_failed', {
            status: res.status,
            code: err.code,
          });
        }
        outcome = { ok: false, error: 'generic' };
      }
    }
  } catch {
    // The error's own text could quote the request; only the fact is logged.
    console.error('platform.database.credentials_failed', { status: 0, code: 'NETWORK' });
    outcome = { ok: false, error: 'generic' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}
