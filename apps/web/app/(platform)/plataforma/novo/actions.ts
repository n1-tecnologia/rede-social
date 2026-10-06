'use server';

import {
  attachDomainBodySchema,
  type BrandingLookBody,
  createTenantBodySchema,
  platformTenantDetailSchema,
  slugSchema,
} from '@rede-social/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import {
  buildTenantsQuery,
  getPlatformTenantDetail,
  getPlatformTenants,
  platformRedirectPath,
} from '@/lib/platform';

/**
 * Server actions of the new-tenant wizard. The wizard holds the whole draft in the browser and
 * sends NOTHING to the API until the summary's confirmation: the two `validate*` actions only run
 * the SAME Zod schemas the API validates with, here in the web tier (no request, no record), and
 * `createTenantFromDraftAction` is the one write, called by the confirmation dialog. It answers the
 * new id instead of redirecting, so the dialog can go on with the uploads and the domain (existing
 * actions, on the new id) before it moves to the invite step. `findCreatedTenantAction` only reads,
 * and only for that dialog's retry after an answer that never came.
 */

export type DraftField = 'displayName' | 'slug' | 'primary' | 'secondary' | 'adminEmail';
export type DraftFieldError =
  | 'displayNameRequired'
  | 'slugInvalid'
  | 'slugTaken'
  | 'hexInvalid'
  | 'emailInvalid'
  | 'emailInUse';
export type DraftFieldErrors = Partial<Record<DraftField, DraftFieldError>>;

/** What the wizard collects (the API body, in the form's shape). */
export type TenantDraftInput = {
  displayName: string;
  slug: string;
  primary: string;
  secondary: string;
  adminEmail: string;
  modules: string[];
  /**
   * The look beyond the pair (2026-10-03), already checked by the dialog (`lookBodyOf`); validated
   * again here with the API's own strict schema. Absent for the Dados step's own check.
   */
  look?: BrandingLookBody;
};

/** `fieldErrors` empty: a failure no field owns (a module key outside the allow-list). */
export type DraftValidation = { ok: true } | { ok: false; fieldErrors: DraftFieldErrors };

export type CreateTenantResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: DraftFieldErrors }
  | { ok: false; error: 'generic' };

function fieldErrorFor(path: string): [DraftField, DraftFieldError] | null {
  if (path === 'displayName') return ['displayName', 'displayNameRequired'];
  if (path === 'slug') return ['slug', 'slugInvalid'];
  if (path === 'colors.primary') return ['primary', 'hexInvalid'];
  if (path === 'colors.secondary') return ['secondary', 'hexInvalid'];
  if (path === 'adminEmail') return ['adminEmail', 'emailInvalid'];
  return null;
}

function mapIssues(issues: { path: string }[]): DraftFieldErrors {
  const fieldErrors: DraftFieldErrors = {};
  for (const issue of issues) {
    const mapped = fieldErrorFor(issue.path);
    if (mapped && !fieldErrors[mapped[0]]) fieldErrors[mapped[0]] = mapped[1];
  }
  return fieldErrors;
}

function parseDraft(input: TenantDraftInput) {
  return createTenantBodySchema.safeParse({
    displayName: input.displayName,
    slug: input.slug,
    colors: { primary: input.primary, secondary: input.secondary },
    modules: input.modules,
    adminEmail: input.adminEmail,
    ...(input.look === undefined ? {} : { look: input.look }),
  });
}

/**
 * The Dados step's "Continuar": the API's own schema, run here, so a bad field is caught on the
 * step that owns it. Sends nothing to the API; what only the API can know (a slug or an e-mail
 * already in use) is answered at the confirmation, which sends the user back here to fix it.
 */
export async function validateTenantDraftAction(input: TenantDraftInput): Promise<DraftValidation> {
  const parsed = parseDraft(input);
  if (parsed.success) return { ok: true };
  const fieldErrors = mapIssues(
    parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') })),
  );
  return { ok: false, fieldErrors };
}

/** The Domínio step's "Continuar": the attach schema (normalises the host), no request. */
export async function validateDomainHostAction(
  host: string,
): Promise<{ ok: true; host: string } | { ok: false }> {
  const parsed = attachDomainBodySchema.safeParse({ host });
  return parsed.success ? { ok: true, host: parsed.data.host } : { ok: false };
}

/**
 * `POST /v1/platform/tenants` (D-31), the wizard's one write, after the summary's confirmation, with
 * the pair, the modules and (2026-10-03) the look, so "Criar tenant" keeps the grounds, the dark
 * colours, the buttons, the title font and the inks the summary listed. A look no field owns that
 * fails the schema (only a tampered draft can: the dialog sends `lookBodyOf`) is a generic failure.
 * Validation first (`createTenantBodySchema.safeParse`), so a bad draft never becomes a request; the
 * API's 400 `VALIDATION_FAILED` maps the same way: `details.slug === 'taken'` is the duplicate slug,
 * `details.adminEmail === 'in_use'` an e-mail that already has an identity on the platform (WR-03,
 * 02-19), `details.issues[]` a schema failure it caught that we did not. A 401/403 navigates like
 * every platform read (`redirect` after the try/catch, the Next 16 rule).
 */
export async function createTenantFromDraftAction(
  input: TenantDraftInput,
): Promise<CreateTenantResult> {
  const parsed = parseDraft(input);
  if (!parsed.success) {
    const fieldErrors = mapIssues(
      parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') })),
    );
    return Object.keys(fieldErrors).length > 0
      ? { ok: false, fieldErrors }
      : { ok: false, error: 'generic' };
  }

  let refusal: string | null = null;
  let result: CreateTenantResult = { ok: false, error: 'generic' };
  try {
    const res = await apiFetch('/v1/platform/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (res.ok) {
      const detail = platformTenantDetailSchema.parse(await res.json());
      result = { ok: true, id: detail.tenant.id };
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      } | null;
      const code = body?.error?.code ?? 'HTTP_ERROR';
      const details = body?.error?.details;
      if (res.status === 400 && code === 'VALIDATION_FAILED') {
        const fieldErrors: DraftFieldErrors = {};
        if (details?.slug === 'taken') fieldErrors.slug = 'slugTaken';
        if (details?.adminEmail === 'in_use') fieldErrors.adminEmail = 'emailInUse';
        if (Array.isArray(details?.issues)) {
          for (const [field, key] of Object.entries(
            mapIssues(details.issues as { path: string }[]),
          )) {
            const name = field as DraftField;
            if (key && !fieldErrors[name]) fieldErrors[name] = key;
          }
        }
        if (Object.keys(fieldErrors).length > 0) result = { ok: false, fieldErrors };
      } else if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(
          new ApiClientError(res.status, code, details, body?.error?.requestId),
        );
      } else {
        console.error('platform.tenants.create_failed', { status: res.status, code });
      }
    }
  } catch (error) {
    console.error('platform.tenants.create_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return result;
}

/** How recent a tenant must be to count as "just created by this confirmation". */
const JUST_CREATED_MS = 15 * 60_000;

/**
 * Read-only recovery for a creation whose answer was lost: the request reached the API (the tenant
 * exists) but the page never heard back, then the confirmation asked again and the API answered
 * "slug taken". That happens with no retry of ours too: Next replays a server action whose fetch
 * failed (its offline handling assumes the request never left). Before the dialog calls that a
 * refusal, it asks here whether the slug is THE tenant this draft created: the exact slug, the same
 * display name, an invite for the same first admin, and (unless an earlier attempt of the draft is
 * known to have gone unanswered, `recentOnly: false`) created within the last minutes, so an older
 * tenant is never taken over. Two reads (`GET /v1/platform/tenants?q=` and the detail), no write;
 * any failure answers `null`, and the dialog falls back to the field error.
 */
export async function findCreatedTenantAction(input: {
  slug: string;
  displayName: string;
  adminEmail: string;
  recentOnly: boolean;
}): Promise<{ id: string } | null> {
  const slug = input.slug.trim();
  const displayName = input.displayName.trim();
  const email = input.adminEmail.trim().toLowerCase();
  if (!slugSchema.safeParse(slug).success || !displayName || !email) return null;
  try {
    const list = await getPlatformTenants(buildTenantsQuery({ q: slug, limit: 100 }));
    const row = list.tenants.find((tenant) => tenant.slug === slug);
    if (!row || row.displayName.trim() !== displayName) return null;
    if (input.recentOnly && !(Date.now() - Date.parse(row.createdAt) <= JUST_CREATED_MS)) {
      return null;
    }
    const detail = await getPlatformTenantDetail(row.id);
    const invited = detail.invites.some((invite) => invite.email.trim().toLowerCase() === email);
    return invited ? { id: row.id } : null;
  } catch (error) {
    console.error('platform.tenants.lookup_failed', { error: String(error) });
    return null;
  }
}
