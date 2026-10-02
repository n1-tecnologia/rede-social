'use server';

import {
  adminBrandingSchema,
  adminTenantBodySchema,
  BRANDING_UPLOAD_ISSUES,
  type BrandingUploadIssue,
  brandingColorsBodySchema,
  brandingUploadBodySchema,
  brandingUploadIdSchema,
  brandingUploadSchema,
  contrastReportSchema,
} from '@rede-social/contracts/branding';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type {
  CompleteBrandingUploadResult,
  SaveBrandColorsResult,
  StartBrandingUploadResult,
} from '@/app/(platform)/plataforma/tenants/[id]/marca/actions';
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
 * Leaves for a refusal's destination. Before the 403 `FORBIDDEN` one the router cache is purged too:
 * the Marca screen prefetched Configurações while the caller still held `tenant.manage`, and that
 * copy would show the Marca row again under the "no permission" toast.
 */
function leave(path: string): never {
  if (path === FORBIDDEN_PATH) revalidateShell();
  redirect(path);
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

  if (refusal) leave(refusal);
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

  if (refusal) leave(refusal);
  return view ? { ok: true, view } : { ok: false };
}

/**
 * `POST /v1/admin/branding/uploads` (D-27): only `{ kind, mime, size }` cross here — never file bytes.
 * Answers the signed Storage URL the browser PUTs to and the `uploadId` for `complete`. The API mints
 * the key under the caller's own tenant prefix. `_tenantId` is ignored.
 */
export async function startBrandingUploadAction(
  _tenantId: string,
  input: { kind: 'logo' | 'icon'; mime: string; size: number },
): Promise<StartBrandingUploadResult> {
  const body = brandingUploadBodySchema.safeParse(input);
  if (!body.success) {
    const paths = body.error.issues.map((issue) => issue.path.map(String).join('.'));
    return { ok: false, code: paths.includes('size') ? 'size' : 'type' };
  }

  let refusal: string | null = null;
  let result: StartBrandingUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch('/v1/admin/branding/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      const upload = brandingUploadSchema.parse(await res.json());
      result = {
        ok: true,
        upload: {
          uploadId: upload.uploadId,
          signedUrl: upload.signedUrl,
          maxBytes: upload.maxBytes,
        },
      };
    } else {
      const envelope = await readEnvelope(res);
      const details = envelope?.details;
      const issues = Array.isArray(details?.issues) ? (details.issues as { path?: string }[]) : [];
      if (res.status === 413 || details?.size === 'too_large') {
        result = { ok: false, code: 'size' };
      } else if (res.status === 400 && issues.some((i) => String(i.path ?? '').includes('mime'))) {
        result = { ok: false, code: 'type' };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('admin.branding.upload_start_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('admin.branding.upload_start_failed', { error: String(error) });
  }

  if (refusal) leave(refusal);
  return result;
}

/**
 * `POST /v1/admin/branding/uploads/{uploadId}/complete` (no body): the API verifies the object under
 * the caller's own prefix and records it. A refused object is already removed server-side; its
 * `details.upload` vocabulary maps to the zone's pt-BR copy. `_tenantId` is ignored.
 */
export async function completeBrandingUploadAction(
  _tenantId: string,
  uploadId: string,
): Promise<CompleteBrandingUploadResult> {
  const upload = brandingUploadIdSchema.safeParse(uploadId);
  if (!upload.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CompleteBrandingUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(
      `/v1/admin/branding/uploads/${encodeURIComponent(upload.data)}/complete`,
      { method: 'POST' },
    );
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidateShell();
    } else {
      const envelope = await readEnvelope(res);
      const issue = envelope?.details?.upload;
      if (
        (res.status === 400 || res.status === 404) &&
        typeof issue === 'string' &&
        (BRANDING_UPLOAD_ISSUES as readonly string[]).includes(issue)
      ) {
        result = { ok: false, code: issue as BrandingUploadIssue };
      } else {
        refusal = refusalPath(res.status, envelope);
        if (!refusal) {
          console.error('admin.branding.complete_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('admin.branding.complete_failed', { error: String(error) });
  }

  if (refusal) leave(refusal);
  return result;
}

/**
 * `DELETE /v1/admin/branding/icon` (D-28): clears the square override; the icons re-derive from the
 * logo in the worker. Sits behind the form's `ConfirmDialog`. `_tenantId` is ignored.
 */
export async function removeIconOverrideAction(
  _tenantId: string,
): Promise<{ ok: true; view: BrandingView } | { ok: false; code: 'generic' }> {
  let refusal: string | null = null;
  let result: { ok: true; view: BrandingView } | { ok: false; code: 'generic' } = {
    ok: false,
    code: 'generic',
  };
  try {
    const res = await apiFetch('/v1/admin/branding/icon', { method: 'DELETE' });
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidateShell();
    } else {
      const envelope = await readEnvelope(res);
      refusal = refusalPath(res.status, envelope);
      if (!refusal) {
        console.error('admin.branding.icon_remove_failed', {
          status: res.status,
          code: envelope?.code,
        });
      }
    }
  } catch (error) {
    console.error('admin.branding.icon_remove_failed', { error: String(error) });
  }

  if (refusal) leave(refusal);
  return result;
}

export type SaveDisplayNameResult =
  | { ok: true; view: BrandingView }
  | { ok: false; code: 'required' | 'tooLong' | 'forbidden' | 'failed' };

/**
 * `PATCH /v1/admin/tenant` with `{ displayName }` only (ADMIN-01, UI-D-279). Validated with the SAME
 * strict schema the API runs (the platform's display-name rule) before any request; a refusal comes
 * back as the field error the name card shows. A 403 `FORBIDDEN` is `forbidden`: the card toasts it
 * and refreshes, and the refreshed page answers `notFound()` (UI-D-284). Session and membership
 * refusals are the shipped `(app)` navigation. The name itself never reaches a log line.
 */
export async function saveDisplayNameAction(displayName: string): Promise<SaveDisplayNameResult> {
  const body = adminTenantBodySchema.safeParse({ displayName });
  if (!body.success) {
    const tooLong = body.error.issues.some((issue) => issue.code === 'too_big');
    return { ok: false, code: tooLong ? 'tooLong' : 'required' };
  }

  let refusal: string | null = null;
  let result: SaveDisplayNameResult = { ok: false, code: 'failed' };
  try {
    const res = await apiFetch('/v1/admin/tenant', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidateShell();
    } else {
      const envelope = await readEnvelope(res);
      const reason = envelope?.details?.displayName;
      if (res.status === 400 && reason === 'too_long') result = { ok: false, code: 'tooLong' };
      else if (res.status === 400 && reason === 'required') {
        result = { ok: false, code: 'required' };
      } else if (res.status === 403 && envelope?.code === 'FORBIDDEN') {
        result = { ok: false, code: 'forbidden' };
      } else {
        const error = new ApiClientError(
          res.status,
          envelope?.code ?? 'HTTP_ERROR',
          envelope?.details,
        );
        refusal = res.status === 401 || res.status === 403 ? bootstrapRedirectPath(error) : null;
        if (!refusal) {
          console.error('admin.tenant.rename_failed', { status: res.status, code: envelope?.code });
        }
      }
    }
  } catch (error) {
    console.error('admin.tenant.rename_failed', { error: String(error) });
  }

  if (refusal) leave(refusal);
  return result;
}
