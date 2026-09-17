'use server';

import { platformTenantDetailSchema } from '@tria/contracts';
import {
  BRANDING_UPLOAD_ISSUES,
  type BrandingUploadIssue,
  brandingColorsBodySchema,
  brandingUploadBodySchema,
  brandingUploadIdSchema,
  brandingUploadSchema,
  type ContrastReport,
  contrastReportSchema,
} from '@tria/contracts/branding';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { type BrandingView, toBrandingView } from '@/lib/branding-view';
import { getPlatformTenantDetail, platformRedirectPath } from '@/lib/platform';

/**
 * Server actions of the Marca tab (02-14, ROLE-03, D-25/D-27/D-28/D-41). Same conventions as
 * `(platform)/plataforma/actions.ts`: validate with the SAME Zod the API runs BEFORE any request,
 * `apiFetch` to the 02-13 branding routes, typed results (never throw for an expected refusal),
 * `revalidatePath(layout)` after every successful mutation, and 401/403 turned into a navigation
 * through `platformRedirectPath` OUTSIDE the try/catch (Next 16: `redirect()` throws).
 *
 * The browser never sends file bytes here (D-27): the actions carry `{ kind, mime, size }` and the
 * `uploadId`; the bytes go straight from the browser to the API-minted signed Storage URL.
 */

const tenantIdSchema = z.uuid();

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

/** The redirect a 401/403 answer maps to, `null` for anything else. */
function refusalPath(status: number, envelope: Envelope['error'] | null): string | null {
  if (status !== 401 && status !== 403) return null;
  return platformRedirectPath(
    new ApiClientError(
      status,
      envelope?.code ?? 'HTTP_ERROR',
      envelope?.details,
      envelope?.requestId,
    ),
  );
}

async function parseView(res: Response): Promise<BrandingView> {
  return toBrandingView(platformTenantDetailSchema.parse(await res.json()));
}

function tenantPath(tenantId: string): string {
  return `/v1/platform/tenants/${encodeURIComponent(tenantId)}`;
}

export type SaveBrandColorsResult =
  | { ok: true; view: BrandingView }
  | { ok: false; code: 'hexInvalid' }
  | { ok: false; code: 'confirmLowContrast'; contrastReport: ContrastReport }
  | { ok: false; code: 'generic' };

/**
 * `PUT /v1/platform/tenants/{id}/branding/colors` (D-25/D-41) — never the 02-05 generic tenant
 * update route: only this endpoint runs the both-modes contrast gate. A 400 carrying
 * `confirmLowContrast: 'required'` hands the API's report back to the form, which re-arms the
 * "Salvar mesmo assim" checkbox — the action NEVER retries with the flag on its own.
 */
export async function saveBrandColorsAction(
  tenantId: string,
  input: { primary: string; secondary: string; confirmLowContrast?: boolean },
): Promise<SaveBrandColorsResult> {
  const id = tenantIdSchema.safeParse(tenantId);
  if (!id.success) return { ok: false, code: 'generic' };
  const body = brandingColorsBodySchema.safeParse(input);
  if (!body.success) return { ok: false, code: 'hexInvalid' };

  let refusal: string | null = null;
  let result: SaveBrandColorsResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(`${tenantPath(id.data)}/branding/colors`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidatePath(`/plataforma/tenants/${id.data}`, 'layout');
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
          console.error('platform.branding.colors_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('platform.branding.colors_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * A fresh read of the tenant's brand (no mutation, no revalidation): the form polls it every 3 s
 * while the worker derives the icons for a new `iconVersion` (D-28, bounded by the form).
 */
export async function getBrandingStatusAction(
  tenantId: string,
): Promise<{ ok: true; view: BrandingView } | { ok: false }> {
  const id = tenantIdSchema.safeParse(tenantId);
  if (!id.success) return { ok: false };

  let refusal: string | null = null;
  let view: BrandingView | null = null;
  try {
    view = toBrandingView(await getPlatformTenantDetail(id.data));
  } catch (error) {
    if (error instanceof ApiClientError) refusal = platformRedirectPath(error);
    if (!refusal) console.error('platform.branding.status_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return view ? { ok: true, view } : { ok: false };
}

export type StartBrandingUploadResult =
  | { ok: true; upload: { uploadId: string; signedUrl: string; maxBytes: number } }
  | { ok: false; code: 'type' | 'size' | 'generic' };

/**
 * `POST /v1/platform/tenants/{id}/branding/uploads` (D-27): only `{ kind, mime, size }` cross here —
 * never file bytes. Answers the signed Storage URL the browser PUTs to (held in component state for
 * the duration of the upload only, T-02-110) and the `uploadId` for `complete`.
 */
export async function startBrandingUploadAction(
  tenantId: string,
  input: { kind: 'logo' | 'icon'; mime: string; size: number },
): Promise<StartBrandingUploadResult> {
  const id = tenantIdSchema.safeParse(tenantId);
  if (!id.success) return { ok: false, code: 'generic' };
  const body = brandingUploadBodySchema.safeParse(input);
  if (!body.success) {
    const paths = body.error.issues.map((issue) => issue.path.map(String).join('.'));
    return { ok: false, code: paths.includes('size') ? 'size' : 'type' };
  }

  let refusal: string | null = null;
  let result: StartBrandingUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(`${tenantPath(id.data)}/branding/uploads`, {
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
          console.error('platform.branding.upload_start_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('platform.branding.upload_start_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

export type CompleteBrandingUploadResult =
  | { ok: true; view: BrandingView }
  | { ok: false; code: BrandingUploadIssue | 'generic' };

/**
 * `POST /v1/platform/tenants/{id}/branding/uploads/{uploadId}/complete` (no body): the API verifies
 * the object (size, content type, image header — 02-13) and records it. A refused object is already
 * removed server-side; its `details.upload` vocabulary maps to the zone's pt-BR copy.
 */
export async function completeBrandingUploadAction(
  tenantId: string,
  uploadId: string,
): Promise<CompleteBrandingUploadResult> {
  const id = tenantIdSchema.safeParse(tenantId);
  const upload = brandingUploadIdSchema.safeParse(uploadId);
  if (!id.success || !upload.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: CompleteBrandingUploadResult = { ok: false, code: 'generic' };
  try {
    const res = await apiFetch(
      `${tenantPath(id.data)}/branding/uploads/${encodeURIComponent(upload.data)}/complete`,
      { method: 'POST' },
    );
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidatePath(`/plataforma/tenants/${id.data}`, 'layout');
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
          console.error('platform.branding.complete_failed', {
            status: res.status,
            code: envelope?.code,
          });
        }
      }
    }
  } catch (error) {
    console.error('platform.branding.complete_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/**
 * `DELETE /v1/platform/tenants/{id}/branding/icon` (D-28): clears the square override; the icons
 * re-derive from the logo in the worker. Sits behind a `ConfirmDialog` in the panel.
 */
export async function removeIconOverrideAction(
  tenantId: string,
): Promise<{ ok: true; view: BrandingView } | { ok: false; code: 'generic' }> {
  const id = tenantIdSchema.safeParse(tenantId);
  if (!id.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: { ok: true; view: BrandingView } | { ok: false; code: 'generic' } = {
    ok: false,
    code: 'generic',
  };
  try {
    const res = await apiFetch(`${tenantPath(id.data)}/branding/icon`, { method: 'DELETE' });
    if (res.ok) {
      result = { ok: true, view: await parseView(res) };
      revalidatePath(`/plataforma/tenants/${id.data}`, 'layout');
    } else {
      const envelope = await readEnvelope(res);
      refusal = refusalPath(res.status, envelope);
      if (!refusal) {
        console.error('platform.branding.icon_remove_failed', {
          status: res.status,
          code: envelope?.code,
        });
      }
    }
  } catch (error) {
    console.error('platform.branding.icon_remove_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}
