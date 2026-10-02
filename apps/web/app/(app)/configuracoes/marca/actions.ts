'use server';

import {
  adminBrandingSchema,
  brandingColorsBodySchema,
  contrastReportSchema,
} from '@rede-social/contracts/branding';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { SaveBrandColorsResult } from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { type BrandingView, toBrandingView } from '@/lib/branding-view';

/**
 * The Marca screen's server actions on the TENANT LANE (ADMIN-01, D-342, UI-D-279, UI-D-284).
 *
 * They feed the platform's `BrandingForm`, unchanged, so they keep its `BrandingActions` signatures
 * — `(tenantId, …)` — and IGNORE that first argument. A server action is a public endpoint: whatever
 * the browser sends as `tenantId` is the browser's word, and the tenant lane never takes a tenant from
 * the browser (RESEARCH anti-pattern, T-08-31). The API paths carry no tenant id at all; the API acts
 * on the caller's membership of record.
 *
 * Same conventions as the platform actions otherwise: the SAME Zod the API runs validates BEFORE any
 * request, typed results (never a throw for an expected refusal), and `revalidatePath('/', 'layout')`
 * after every successful write, so the next navigation re-renders the shell from a fresh bootstrap.
 * Refusals never go through the platform panel's redirect helper: session and membership refusals
 * follow the shipped `(app)` mapping (`bootstrapRedirectPath`), and a 403 `FORBIDDEN` (the permission
 * was lost in another tab, UI-D-284) leaves the screen for Configurações with the "no permission"
 * toast — the unchanged form has no outcome for it, and the Marca page would answer `notFound()`.
 * Every navigation happens OUTSIDE the try/catch (Next 16: `redirect()` throws).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

/** Where a 403 `FORBIDDEN` lands: Configurações, which toasts `admin.errors.forbidden`. */
const FORBIDDEN_PATH = '/configuracoes?erro=sem-permissao';

type Envelope = {
  error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
};

async function readEnvelope(res: Response): Promise<Envelope['error'] | null> {
  try {
    const body = (await res.json()) as Envelope;
    return body?.error && typeof body.error.code === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** The navigation a 401/403 answer maps to on the tenant lane, `null` for anything else. */
function refusalPath(status: number, envelope: Envelope['error'] | null): string | null {
  if (status !== 401 && status !== 403) return null;
  const error = new ApiClientError(
    status,
    envelope?.code ?? 'HTTP_ERROR',
    envelope?.details,
    envelope?.requestId,
  );
  const path = bootstrapRedirectPath(error);
  if (path) return path;
  return status === 403 && error.code === 'FORBIDDEN' ? FORBIDDEN_PATH : null;
}

async function parseView(res: Response): Promise<BrandingView> {
  return toBrandingView(adminBrandingSchema.parse(await res.json()));
}

/** Every successful brand write: the next navigation renders the shell from a fresh bootstrap. */
function revalidateShell(): void {
  revalidatePath('/', 'layout');
}

/**
 * `PUT /v1/admin/branding/colors` — the same contrast gate as the platform lane: a 400 carrying
 * `confirmLowContrast: 'required'` hands the API's report back to the form, which re-arms "Salvar
 * mesmo assim". The action NEVER retries with the flag on its own. `_tenantId` is ignored (above).
 */
export async function saveBrandColorsAction(
  _tenantId: string,
  input: { primary: string; secondary: string; confirmLowContrast?: boolean },
): Promise<SaveBrandColorsResult> {
  const body = brandingColorsBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: 'hexInvalid' };

  let refusal: string | null = null;
  let result: SaveBrandColorsResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch('/v1/admin/branding/colors', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidateShell();
    } else {
      const envelope = await readEnvelope(res);
      const details = envelope?.details;
      if (res.status === 400 && details?.confirmLowContrast === 'required') {
        const report = contrastReportSchema.safeParse(details.contrastReport);
        result = report.success
          ? { ok: false, code: 'confirmLowContrast', contrastReport: report.data }
          : { ok: false, code: 'generic' };
      } else if (res.status === 400) {
        result = { ok: false, code: 'hexInvalid' };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('admin.branding.colors_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('admin.branding.colors_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * A fresh read of the caller's brand (no mutation, no revalidation): the form polls it every 3 s
 * while the worker derives the icons for a new `iconVersion` (D-28). `_tenantId` is ignored.
 */
export async function getBrandingStatusAction(
  _tenantId: string,
): Promise<{ ok: true; view: BrandingView } | { ok: false }> {
  let refusal: string | null = null;
  let view: BrandingView | null = null;
  try {
    const res = await apiFetch('/v1/admin/branding');
    if (res.ok) view = await parseView(res);
    else {
      const envelope = await readEnvelope(res);
      refusal = refusalPath(res.status, envelope);
      if (!refusal) {
        console.error('admin.branding.status_failed', { status: res.status, code: envelope?.code });
      }
    }
  } catch (error) {
    console.error('admin.branding.status_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return view ? { ok: true, view } : { ok: false };
}
