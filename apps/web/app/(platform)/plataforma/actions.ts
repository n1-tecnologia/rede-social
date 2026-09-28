'use server';

import {
  createTenantBodySchema,
  platformTenantDetailSchema,
  platformTenantsQuerySchema,
  setTenantStatusBodySchema,
} from '@rede-social/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import {
  buildTenantsQuery,
  getPlatformTenants,
  platformRedirectPath,
  type TenantRowView,
  toTenantRow,
} from '@/lib/platform';
import { createClient } from '@/lib/supabase/server';

/**
 * Server actions of the platform panel (ROLE-03/ROLE-05, D-31/D-32). Every mutation runs the SAME
 * Zod schema the API validates with BEFORE the request, then lets the API decide (it re-validates
 * and re-authorises with `requireSuperAdmin()`); the action only maps the D-09 envelope to catalog
 * KEYS — the client component translates. `redirect()` throws NEXT_REDIRECT, so per the Next 16 rule
 * it is always called AFTER the try/catch, never inside a `try`.
 */

/**
 * "Sair" from the panel rail — D-08, the same device-local sign-out as `(app)/actions.ts` (own copy:
 * route groups never import each other's actions). A rejected sign-out still lands on `/entrar`;
 * proxy.ts sends an authenticated visitor back to the panel anyway.
 */
export async function signOutPlatform(): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch (error) {
    console.error('platform.logout.failed', { error: String(error) });
  }
  redirect('/entrar');
}

type CreateField = 'displayName' | 'slug' | 'primary' | 'secondary' | 'adminEmail';
type CreateFieldError =
  | 'displayNameRequired'
  | 'slugInvalid'
  | 'slugTaken'
  | 'hexInvalid'
  | 'emailInvalid'
  | 'emailInUse';

/** What `createTenantAction` hands back to `useActionState` — catalog keys, never copy. */
export type CreateTenantState = {
  fieldErrors?: Partial<Record<CreateField, CreateFieldError>>;
  error?: 'generic';
  values?: {
    displayName: string;
    slug: string;
    primary: string;
    secondary: string;
    adminEmail: string;
    modules: string[];
  };
};

function fieldErrorFor(path: string): [CreateField, CreateFieldError] | null {
  if (path === 'displayName') return ['displayName', 'displayNameRequired'];
  if (path === 'slug') return ['slug', 'slugInvalid'];
  if (path === 'colors.primary') return ['primary', 'hexInvalid'];
  if (path === 'colors.secondary') return ['secondary', 'hexInvalid'];
  if (path === 'adminEmail') return ['adminEmail', 'emailInvalid'];
  return null;
}

function mapIssues(issues: { path: string }[]): CreateTenantState['fieldErrors'] {
  const fieldErrors: CreateTenantState['fieldErrors'] = {};
  for (const issue of issues) {
    const mapped = fieldErrorFor(issue.path);
    if (mapped && !fieldErrors[mapped[0]]) fieldErrors[mapped[0]] = mapped[1];
  }
  return fieldErrors;
}

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * `POST /v1/platform/tenants` (D-31). Validation first (`createTenantBodySchema.safeParse`), so a bad
 * form never becomes a request; the API's 400 `VALIDATION_FAILED` is mapped the same way — `details.slug
 * === 'taken'` is the duplicate slug, `details.adminEmail` = `'in_use'` an e-mail that already has an
 * identity on the platform (WR-03, 02-19), `details.issues[]` a schema failure it caught that we did
 * not; the three are independent and may arrive together.
 * Every branch echoes `values` so already-valid fields keep what was typed (E11/partial). Success
 * redirects to the tenant's Marca tab with `?toast=created`.
 */
export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const values: NonNullable<CreateTenantState['values']> = {
    displayName: str(formData, 'displayName'),
    slug: str(formData, 'slug'),
    primary: str(formData, 'primary'),
    secondary: str(formData, 'secondary'),
    adminEmail: str(formData, 'adminEmail'),
    modules: formData.getAll('modules').filter((m): m is string => typeof m === 'string'),
  };

  const parsed = createTenantBodySchema.safeParse({
    displayName: values.displayName,
    slug: values.slug,
    colors: { primary: values.primary, secondary: values.secondary },
    modules: values.modules,
    adminEmail: values.adminEmail,
  });
  if (!parsed.success) {
    const fieldErrors = mapIssues(
      parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') })),
    );
    return Object.keys(fieldErrors ?? {}).length > 0
      ? { fieldErrors, values }
      : { error: 'generic', values };
  }

  let createdId: string | null = null;
  let refusal: string | null = null;
  let result: CreateTenantState | null = null;
  try {
    const res = await apiFetch('/v1/platform/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (res.ok) {
      const detail = platformTenantDetailSchema.parse(await res.json());
      createdId = detail.tenant.id;
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      } | null;
      const code = body?.error?.code ?? 'HTTP_ERROR';
      const details = body?.error?.details;
      if (res.status === 400 && code === 'VALIDATION_FAILED') {
        const fieldErrors: NonNullable<CreateTenantState['fieldErrors']> = {};
        if (details?.slug === 'taken') fieldErrors.slug = 'slugTaken';
        if (details?.adminEmail === 'in_use') fieldErrors.adminEmail = 'emailInUse';
        if (Array.isArray(details?.issues)) {
          for (const [field, key] of Object.entries(
            mapIssues(details.issues as { path: string }[]) ?? {},
          )) {
            const name = field as CreateField;
            if (key && !fieldErrors[name]) fieldErrors[name] = key;
          }
        }
        result =
          Object.keys(fieldErrors).length > 0
            ? { fieldErrors, values }
            : { error: 'generic', values };
      } else if (res.status === 401 || res.status === 403) {
        refusal = platformRedirectPath(
          new ApiClientError(res.status, code, details, body?.error?.requestId),
        );
        if (!refusal) result = { error: 'generic', values };
      } else {
        console.error('platform.tenants.create_failed', { status: res.status, code });
        result = { error: 'generic', values };
      }
    }
  } catch (error) {
    console.error('platform.tenants.create_failed', { error: String(error) });
    result = { error: 'generic', values };
  }

  if (createdId) redirect(`/plataforma/tenants/${createdId}/marca?toast=created`);
  if (refusal) redirect(refusal);
  return result ?? { error: 'generic', values };
}

const tenantIdSchema = z.uuid();

/**
 * `POST /v1/platform/tenants/{id}/status` (D-32). On success the tenant layout is revalidated so the
 * header pill flips on the same navigation, and the list so its pill agrees. Returns a result the
 * Status card turns into a toast; 401/403 navigate like every platform read.
 */
export async function setTenantStatusAction(
  tenantId: string,
  status: 'active' | 'suspended',
): Promise<{ ok: true } | { ok: false; code: string }> {
  const id = tenantIdSchema.safeParse(tenantId);
  const body = setTenantStatusBodySchema.safeParse({ status });
  if (!id.success || !body.success) return { ok: false, code: 'VALIDATION_FAILED' };

  let refusal: string | null = null;
  let outcome: { ok: true } | { ok: false; code: string };
  try {
    const res = await apiFetch(`/v1/platform/tenants/${encodeURIComponent(id.data)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    });
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
      }
      outcome = { ok: false, code };
    }
  } catch (error) {
    console.error('platform.tenants.status_failed', { error: String(error) });
    outcome = { ok: false, code: 'NETWORK_ERROR' };
  }

  if (refusal) redirect(refusal);
  return outcome;
}

/**
 * "Carregar mais" (ROLE-05 pagination): the next page of the SAME query from the slug cursor the
 * API answered, mapped to table rows on the server (dates and plurals pre-rendered). Bad input
 * answers an empty page rather than throwing; 401/403 navigate like every platform read.
 */
export async function loadMoreTenantsAction(query: {
  q?: string;
  status?: 'active' | 'suspended';
  limit: number;
  cursor: string;
}): Promise<{ rows: TenantRowView[]; nextCursor: string | null }> {
  const parsed = platformTenantsQuerySchema.safeParse(query);
  if (!parsed.success) return { rows: [], nextCursor: null };

  let refusal: string | null = null;
  let page: { rows: TenantRowView[]; nextCursor: string | null } = { rows: [], nextCursor: null };
  try {
    const [t, result] = await Promise.all([
      getTranslations('platform'),
      getPlatformTenants(buildTenantsQuery(parsed.data)),
    ]);
    page = {
      rows: result.tenants.map((item) =>
        toTenantRow(item, (count) => t('modulesCount', { count })),
      ),
      nextCursor: result.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) refusal = platformRedirectPath(error);
    if (!refusal) console.error('platform.tenants.load_more_failed', { error: String(error) });
  }

  if (refusal) redirect(refusal);
  return page;
}
