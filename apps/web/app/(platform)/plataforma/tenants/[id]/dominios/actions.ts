'use server';

import {
  attachDomainBodySchema,
  tenantDomainSchema,
  tenantDomainsListSchema,
} from '@rede-social/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { DomainActionResult, DomainStatus } from '@/components/platform/DomainCard';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { platformRedirectPath } from '@/lib/platform';
import { mapDomainActionError } from '@/lib/platform-domains';
import { revalidateTenantViews } from '@/lib/revalidate-tenant';

/**
 * Server actions of the Domínios tab (TENANT-07, D-34/D-35/D-36) over 02-09's
 * `/v1/platform/tenants/{id}/domains/*`. Conventions from 02-12's `actions.ts`: every id through
 * `z.uuid()` before any request (T-02-92), the SAME Zod the API validates with runs first, the API
 * decides (it re-authorises with `requireSuperAdmin()`), the D-09 envelope is mapped to catalog
 * KEYS, 401/403 navigate through `platformRedirectPath` with `redirect()` called AFTER the
 * try/catch (Next 16 rule), and every answer that may have changed a row revalidates the tenant
 * layout (header host link + tab body).
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

type DomainRow = { status: DomainStatus; lastError: string | null };

function revalidateTenant(tenantId: string): void {
  revalidateTenantViews(tenantId);
}

function domainPath(tenantId: string, domainId: string, suffix = ''): string {
  return `/v1/platform/tenants/${encodeURIComponent(tenantId)}/domains/${encodeURIComponent(
    domainId,
  )}${suffix}`;
}

/** What `attachDomainAction` hands back to `useActionState` — catalog keys, never copy. */
export type AttachDomainState = {
  fieldError?: 'invalid' | 'taken' | 'platformHost';
  error?: 'generic';
  /** The typed value, kept on every error (E16/error). */
  value?: string;
  /** The normalised host the API stored. */
  added?: string;
  /** Changes on every success so the form can react to re-adding the same host. */
  nonce?: number;
};

/**
 * `POST /v1/platform/tenants/{id}/domains` (D-34). `attachDomainBodySchema` runs BEFORE the request
 * (normalises + refuses a non-registrable host); the API's refusals map to the same field keys:
 * 400 `details.host = platform_host` → `platformHost`, other 400 → `invalid`, 409 `DOMAIN_IN_USE` →
 * `taken` (the envelope names no owner and neither does the panel, T-02-96). Bound with
 * `.bind(null, tenantId)` by the page.
 */
export async function attachDomainAction(
  tenantId: string,
  _prev: AttachDomainState,
  formData: FormData,
): Promise<AttachDomainState> {
  if (!uuid.safeParse(tenantId).success) return { error: 'generic' };
  const rawValue = formData.get('host');
  const raw = typeof rawValue === 'string' ? rawValue : '';

  const parsed = attachDomainBodySchema.safeParse({ host: raw });
  if (!parsed.success) return { fieldError: 'invalid', value: raw };

  let refusal: string | null = null;
  let result: AttachDomainState;
  try {
    const res = await apiFetch(`/v1/platform/tenants/${encodeURIComponent(tenantId)}/domains`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (res.ok) {
      const domain = tenantDomainSchema.parse(await res.json());
      revalidateTenant(tenantId);
      result = { added: domain.host, nonce: Date.now() };
    } else {
      const err = await readEnvelope(res);
      if (res.status === 400) {
        result =
          err.details?.host === 'platform_host'
            ? { fieldError: 'platformHost', value: raw }
            : { fieldError: 'invalid', value: raw };
      } else if (res.status === 409 && err.code === 'DOMAIN_IN_USE') {
        result = { fieldError: 'taken', value: raw };
      } else if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(err);
        result = { error: 'generic', value: raw };
      } else {
        console.error('platform.domains.attach_failed', { status: res.status, code: err.code });
        result = { error: 'generic', value: raw };
      }
    }
  } catch (error) {
    console.error('platform.domains.attach_failed', { error: String(error) });
    result = { error: 'generic', value: raw };
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * Shared body of the four row actions: uuid gate → request → parse the row on 2xx → map the
 * envelope otherwise. `readRow` extracts the row from the answer (a `tenantDomainSchema` object, a
 * `tenantDomainsListSchema` list, or nothing for a 204). The layout is revalidated after EVERY
 * answer but a pure refusal — a 409 `expired` means the check just flipped the row.
 */
async function runDomainAction(
  tenantId: string,
  domainId: string,
  init: RequestInit & { suffix?: string },
  readRow: (res: Response) => Promise<DomainRow>,
  event: string,
): Promise<DomainActionResult> {
  if (!uuid.safeParse(tenantId).success || !uuid.safeParse(domainId).success) {
    return { ok: false, error: 'notFound' };
  }
  const { suffix = '', ...request } = init;

  let refusal: string | null = null;
  let outcome: DomainActionResult;
  try {
    const res = await apiFetch(domainPath(tenantId, domainId, suffix), request);
    if (res.ok) {
      const row = await readRow(res);
      revalidateTenant(tenantId);
      outcome = { ok: true, status: row.status, lastError: row.lastError };
    } else {
      const err = await readEnvelope(res);
      if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(err);
        outcome = { ok: false, error: 'generic' };
      } else {
        if (res.status >= 500) console.error(event, { status: res.status, code: err.code });
        revalidateTenant(tenantId);
        outcome = { ok: false, error: mapDomainActionError(err) };
      }
    }
  } catch (error) {
    console.error(event, { error: String(error) });
    outcome = { ok: false, error: 'generic' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}

async function readDomainRow(res: Response): Promise<DomainRow> {
  const domain = tenantDomainSchema.parse(await res.json());
  return { status: domain.verificationStatus, lastError: domain.lastError };
}

/**
 * "Verificar agora" — `POST …/domains/{domainId}/verify`: one provider check now. 200 answers the
 * fresh row (verified / still pending / already verified); 409 `expired` means THIS check flipped
 * the host to expired, so the layout is revalidated before the mapped error is returned.
 */
export async function verifyDomainAction(
  tenantId: string,
  domainId: string,
): Promise<DomainActionResult> {
  return runDomainAction(
    tenantId,
    domainId,
    { method: 'POST', suffix: '/verify' },
    readDomainRow,
    'platform.domains.verify_failed',
  );
}

/**
 * "Tornar primário" — `POST …/domains/{domainId}/primary` (D-35): only a verified host; the API
 * answers the whole list, from which the promoted row is read back. 409 `not_verified` → `notVerified`.
 */
export async function setPrimaryDomainAction(
  tenantId: string,
  domainId: string,
): Promise<DomainActionResult> {
  return runDomainAction(
    tenantId,
    domainId,
    { method: 'POST', suffix: '/primary' },
    async (res) => {
      const list = tenantDomainsListSchema.parse(await res.json());
      const row = list.domains.find((d) => d.id === domainId);
      return {
        status: row?.verificationStatus ?? 'verified',
        lastError: row?.lastError ?? null,
      };
    },
    'platform.domains.set_primary_failed',
  );
}

/**
 * "Remover" — `DELETE …/domains/{domainId}` (D-35): 204 with no body. The API refuses the primary
 * while aliases exist with 409 `primary_with_aliases` → `removePrimary` — the panel's disabled
 * button is the first layer, the API the authority.
 */
export async function removeDomainAction(
  tenantId: string,
  domainId: string,
): Promise<DomainActionResult> {
  return runDomainAction(
    tenantId,
    domainId,
    { method: 'DELETE' },
    async () => ({ status: 'verified', lastError: null }),
    'platform.domains.remove_failed',
  );
}

/**
 * "Reiniciar verificação" — `POST …/domains/{domainId}/restart` (D-34): an expired host back to
 * pending with a fresh ~7-day window and one check already run. 409 `not_expired` → `notExpired`.
 */
export async function restartDomainAction(
  tenantId: string,
  domainId: string,
): Promise<DomainActionResult> {
  return runDomainAction(
    tenantId,
    domainId,
    { method: 'POST', suffix: '/restart' },
    readDomainRow,
    'platform.domains.restart_failed',
  );
}
