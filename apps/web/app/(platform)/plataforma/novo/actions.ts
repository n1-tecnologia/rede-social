'use server';

import {
  attachDomainBodySchema,
  type BrandingLookBody,
  createTenantBodySchema,
  platformTenantDetailSchema,
  slugSchema,
} from '@rede-social/contracts';
import {
  type BootstrapReasonCode,
  type BootstrapStepKey,
  type BootstrapStepStatus,
  type DatabaseState,
  databaseOverviewSchema,
  normalizeProjectRef,
  type PrecheckReason,
  type ProjectAccess,
  precheckAnswerSchema,
  projectRefSchema,
} from '@rede-social/contracts/projects';
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
 * writes NOTHING to the API until the summary's confirmation: the two `validate*` actions run the
 * SAME Zod schemas the API validates with, here in the web tier (no record), and the Dados one adds
 * the platform's read-only pre-check of the Supabase project (09.2-18, D-541: `POST
 * /v1/platform/projects/precheck`, which writes nothing). `createTenantFromDraftAction` is the one
 * write, called by the confirmation dialog. It answers the
 * new id instead of redirecting, so the dialog can go on with the uploads and the domain (existing
 * actions, on the new id) before it moves to the invite step. `findCreatedTenantAction` only reads,
 * and only for that dialog's retry after an answer that never came.
 */

export type DraftField =
  | 'displayName'
  | 'slug'
  | 'primary'
  | 'secondary'
  | 'adminEmail'
  | 'projectRef'
  | 'databasePassword'
  | 'serviceKey'
  | 'publishableKey'
  /** The customer project's token and its typed expiry (09.4-15, UI-D-550). */
  | 'token'
  | 'tokenExpiresAt'
  /** The project refused the manual access as a whole (a block-level error, no single field). */
  | 'access';
export type DraftFieldError =
  | 'displayNameRequired'
  | 'slugInvalid'
  | 'slugTaken'
  | 'hexInvalid'
  | 'emailInvalid'
  | 'emailInUse'
  | 'projectRefRequired'
  | 'projectRefInvalid'
  | 'projectNotFound'
  | 'projectNotEmpty'
  | 'projectInUse'
  | 'projectPaused'
  | 'passwordRequired'
  | 'serviceKeyRequired'
  | 'publishableKeyRequired'
  | 'accessInvalid'
  // 09.4-15 (UI-D-550): the customer project's token, its date and its two customer-only ref refusals.
  | 'tokenRequired'
  | 'tokenInvalid'
  | 'tokenForbidden'
  | 'tokenOtherProject'
  | 'tokenAccountWide'
  | 'tokenExpiryInvalid'
  | 'projectNotFoundCustomer'
  | 'projectNotPro';
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
   * The Supabase project's ref as typed or pasted (09.2-18, UI-D-533). The action normalises it again
   * (`normalizeProjectRef`) and only a bare 20-letter ref ever reaches the API.
   */
  projectRef?: string;
  /**
   * Who owns the project (09.4-15, D-570): absent or `platform` is today's flow and sends no new field.
   * `customer` adds the write-only `token` and the optional typed `tokenExpiresAt` (`YYYY-MM-DD`), sent
   * to the pre-check and to the creation and nowhere else: never logged, never echoed.
   */
  owner?: 'platform' | 'customer';
  token?: string;
  tokenExpiresAt?: string;
  /**
   * The manual access (UI-D-534), sent ONCE with the creation and nowhere else: never to the Dados
   * check, never logged, never echoed. Empty strings count as absent.
   */
  access?: ProjectAccess;
  /**
   * The look beyond the pair (2026-10-03), already checked by the dialog (`lookBodyOf`); validated
   * again here with the API's own strict schema. Absent for the Dados step's own check.
   */
  look?: BrandingLookBody;
};

/**
 * The Dados check. `ok`: every field passes and the project's pre-check passed (`manualAccess`: the
 * platform cannot obtain the project's access by itself, so the form asks for it). Not ok:
 * `fieldErrors` empty and no flag is a failure no field owns (a module key outside the allow-list);
 * `unchecked` is a pre-check that could not run (transport, 5xx, a provider hiccup); `manualAccess`
 * rides along so the form can reveal the block while other fields still need fixing.
 */
export type DraftValidation =
  | { ok: true; manualAccess: boolean }
  | { ok: false; fieldErrors: DraftFieldErrors; unchecked?: boolean; manualAccess?: boolean };

export type CreateTenantResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: DraftFieldErrors }
  | { ok: false; error: 'generic' };

function fieldErrorFor(path: string): [DraftField, DraftFieldError] | null {
  if (path === 'projectRef') return ['projectRef', 'projectRefInvalid'];
  if (path === 'token') return ['token', 'tokenRequired'];
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

/** The ref the API gets: always the normalised one (P99), whatever the form sent. */
function refOf(input: TenantDraftInput): string {
  return normalizeProjectRef(input.projectRef ?? '');
}

/** The shape rule of the ref (UI-D-533): empty, or not exactly 20 lower-case letters. */
function refFormatError(ref: string): 'projectRefRequired' | 'projectRefInvalid' | null {
  if (ref === '') return 'projectRefRequired';
  return projectRefSchema.safeParse(ref).success ? null : 'projectRefInvalid';
}

/** Whether this draft is a customer-owned project (D-570). Anything else is the platform's. */
const isCustomer = (input: TenantDraftInput) => input.owner === 'customer';

/** The customer fields a request carries, `{}` for a platform draft (no new field, byte for byte). */
function customerFields(input: TenantDraftInput): {
  owner?: 'customer';
  token?: string;
  tokenExpiresAt?: string;
} {
  if (!isCustomer(input)) return {};
  const expiresAt = (input.tokenExpiresAt ?? '').trim();
  return {
    owner: 'customer',
    token: (input.token ?? '').trim(),
    ...(expiresAt === '' ? {} : { tokenExpiresAt: expiresAt }),
  };
}

/** The manual access with its empty values dropped, or `undefined` for none at all. */
function presentAccess(access: ProjectAccess | undefined): ProjectAccess | undefined {
  if (!access) return undefined;
  const kept: ProjectAccess = {};
  for (const key of ['databasePassword', 'serviceKey', 'publishableKey'] as const) {
    const value = access[key];
    if (typeof value === 'string' && value.trim() !== '') kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function parseDraft(input: TenantDraftInput) {
  const ref = refOf(input);
  const access = presentAccess(input.access);
  return createTenantBodySchema.safeParse({
    displayName: input.displayName,
    slug: input.slug,
    colors: { primary: input.primary, secondary: input.secondary },
    modules: input.modules,
    adminEmail: input.adminEmail,
    ...(ref === '' ? {} : { projectRef: ref }),
    ...(access ? { access } : {}),
    ...customerFields(input),
    ...(input.look === undefined ? {} : { look: input.look }),
  });
}

/**
 * Where a pre-check refusal lands and which sentence it reads (UI-D-550, D-570): `token_expiry_invalid` under the
 * date, every other `token_*` under the token, the ref reasons under the ref. `unchecked` is the top alert
 * instead and has no entry. `not_found` reads the customer wording for a customer draft (UI-D-559);
 * `token_other_project` and `not_pro` are mapped but never produced today (D-572).
 */
const PRECHECK_FIELD_ERRORS: Partial<Record<PrecheckReason, [DraftField, DraftFieldError]>> = {
  invalid: ['projectRef', 'projectRefInvalid'],
  not_found: ['projectRef', 'projectNotFound'],
  not_empty: ['projectRef', 'projectNotEmpty'],
  in_use: ['projectRef', 'projectInUse'],
  paused: ['projectRef', 'projectPaused'],
  not_pro: ['projectRef', 'projectNotPro'],
  token_invalid: ['token', 'tokenInvalid'],
  token_forbidden: ['token', 'tokenForbidden'],
  token_other_project: ['token', 'tokenOtherProject'],
  token_account_wide: ['token', 'tokenAccountWide'],
  token_expiry_invalid: ['tokenExpiresAt', 'tokenExpiryInvalid'],
};

type PrecheckOutcome =
  | { kind: 'ok'; manualAccess: boolean }
  | { kind: 'refused'; field: DraftField; error: DraftFieldError }
  | { kind: 'unchecked' }
  | { kind: 'redirect'; path: string };

/**
 * `POST /v1/platform/projects/precheck` for a ref that already passed the shape rule. The API answers
 * a pre-check that could not run as data (`unchecked`); a transport error or a 5xx is the same thing
 * to the operator. A 401/403 navigates like every platform read (the caller `redirect`s outside the
 * try/catch, the Next 16 rule).
 */
async function precheckRef(ref: string, input: TenantDraftInput): Promise<PrecheckOutcome> {
  const customer = isCustomer(input);
  try {
    const res = await apiFetch('/v1/platform/projects/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A platform draft posts exactly `{ projectRef }`; a customer draft adds owner, token and date, once.
      body: JSON.stringify({ projectRef: ref, ...customerFields(input) }),
    });
    if (res.status === 401 || res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; details?: Record<string, unknown>; requestId?: string };
      } | null;
      const path = platformRedirectPath(
        new ApiClientError(
          res.status,
          body?.error?.code ?? 'HTTP_ERROR',
          body?.error?.details,
          body?.error?.requestId,
        ),
      );
      return path ? { kind: 'redirect', path } : { kind: 'unchecked' };
    }
    if (!res.ok) {
      console.error('platform.projects.precheck_failed', { status: res.status });
      return { kind: 'unchecked' };
    }
    const answer = precheckAnswerSchema.parse(await res.json());
    if (answer.ok) return { kind: 'ok', manualAccess: answer.manualAccess };
    const mapped = PRECHECK_FIELD_ERRORS[answer.reason];
    if (!mapped) return { kind: 'unchecked' };
    const [field, error] = mapped;
    return {
      kind: 'refused',
      field,
      error: customer && error === 'projectNotFound' ? 'projectNotFoundCustomer' : error,
    };
  } catch (error) {
    console.error('platform.projects.precheck_failed', { error: String(error) });
    return { kind: 'unchecked' };
  }
}

/**
 * The Dados step's "Continuar": the API's own schema, run here, so a bad field is caught on the
 * step that owns it, and then the project's read-only pre-check (09.2-18, UI-D-533) once the ref has
 * the right shape (an empty or malformed ref never reaches the API, P97/P98). Nothing is written;
 * what only the API can know about the other fields (a slug or an e-mail already in use) is answered
 * at the confirmation, which sends the user back here to fix it. The manual access never passes
 * through here: it is sent once, with the creation.
 */
export async function validateTenantDraftAction(input: TenantDraftInput): Promise<DraftValidation> {
  const ref = refOf(input);
  const parsed = parseDraft(input);
  const fieldErrors: DraftFieldErrors = parsed.success
    ? {}
    : mapIssues(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') })));
  const shapeError = refFormatError(ref);
  // A customer draft needs its token before anything is asked of the API (UI-D-550): no request.
  const tokenMissing = isCustomer(input) && (input.token ?? '').trim() === '';
  if (tokenMissing) fieldErrors.token = 'tokenRequired';
  if (shapeError) fieldErrors.projectRef = shapeError;
  if (shapeError || tokenMissing) return { ok: false, fieldErrors };

  const check = await precheckRef(ref, input);
  if (check.kind === 'redirect') redirect(check.path);
  if (check.kind === 'unchecked') return { ok: false, fieldErrors, unchecked: true };
  if (check.kind === 'refused') {
    fieldErrors[check.field] = check.error;
    return { ok: false, fieldErrors };
  }
  if (!parsed.success || Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors, manualAccess: check.manualAccess };
  }
  return { ok: true, manualAccess: check.manualAccess };
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
 * 02-19; the first admin needs no access of their own, the invite writes it, 09.1-04),
 * `details.issues[]` a schema failure it caught that we did not. A 401/403 navigates like
 * every platform read (`redirect` after the try/catch, the Next 16 rule).
 */
export async function createTenantFromDraftAction(
  input: TenantDraftInput,
): Promise<CreateTenantResult> {
  const parsed = parseDraft(input);
  const shapeError = refFormatError(refOf(input));
  if (!parsed.success || shapeError) {
    const fieldErrors = parsed.success
      ? {}
      : mapIssues(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.') })));
    if (shapeError) (fieldErrors as DraftFieldErrors).projectRef = shapeError;
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
        // 09.2-14: the project's refusals (the same words the pre-check uses) and the manual access.
        const customer = isCustomer(input);
        const projectKey =
          typeof details?.projectRef === 'string'
            ? REF_DETAIL_ERRORS[details.projectRef]
            : undefined;
        if (projectKey) {
          fieldErrors.projectRef =
            customer && projectKey === 'projectNotFound' ? 'projectNotFoundCustomer' : projectKey;
        }
        // 09.4-15 (D-570): a customer token the API refused, as a closed code. `org_mismatch` and
        // `unchecked` have no field to blame: they stay a generic failure the operator can retry.
        if (customer && typeof details?.token === 'string') {
          const token = TOKEN_DETAIL_ERRORS[details.token];
          if (token) fieldErrors[token[0]] = token[1];
        }
        if (customer && details?.tokenExpiresAt === 'token_expiry_invalid') {
          fieldErrors.tokenExpiresAt = 'tokenExpiryInvalid';
        }
        if (details?.databasePassword === 'required')
          fieldErrors.databasePassword = 'passwordRequired';
        if (details?.serviceKey === 'required') fieldErrors.serviceKey = 'serviceKeyRequired';
        if (details?.publishableKey === 'required') {
          fieldErrors.publishableKey = 'publishableKeyRequired';
        }
        if (details?.access === 'invalid') fieldErrors.access = 'accessInvalid';
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

/** The API's `VALIDATION_FAILED { projectRef: <reason> }` words, as the form's field errors. */
const REF_DETAIL_ERRORS: Record<string, DraftFieldError> = {
  required: 'projectRefRequired',
  invalid: 'projectRefInvalid',
  not_found: 'projectNotFound',
  not_empty: 'projectNotEmpty',
  in_use: 'projectInUse',
  paused: 'projectPaused',
};

/** The API's `VALIDATION_FAILED { token: <code> }` words of a customer project, and the field each lands on. */
const TOKEN_DETAIL_ERRORS: Record<string, [DraftField, DraftFieldError]> = {
  token_invalid: ['token', 'tokenInvalid'],
  token_forbidden: ['token', 'tokenForbidden'],
  token_other_project: ['token', 'tokenOtherProject'],
  token_account_wide: ['token', 'tokenAccountWide'],
  not_found: ['projectRef', 'projectNotFoundCustomer'],
};

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

/**
 * What the confirmation dialog reads while the database is prepared (09.2-18, UI-D-535): the derived
 * state and, per step, its status and reason CODE. Nothing else of the overview crosses: no ref, no
 * credential field exists in it (UI-D-548), and a reason is a code the catalog turns into a sentence.
 */
export type BootstrapProgress = {
  state: DatabaseState;
  steps: {
    step: BootstrapStepKey;
    status: BootstrapStepStatus;
    reasonCode: BootstrapReasonCode | null;
  }[];
};

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `GET /v1/platform/tenants/{id}/database`, reduced to `BootstrapProgress`. The dialog polls it every
 * 2 s while the `database` task runs; any failure (transport, a refusal, a payload that does not
 * parse) answers `null` and the dialog keeps its last state and asks again at the next tick
 * (UI-D-544). It never redirects: a poll tick must not navigate the operator away from a creation.
 */
export async function readBootstrapProgressAction(
  tenantId: string,
): Promise<BootstrapProgress | null> {
  if (!TENANT_ID.test(tenantId)) return null;
  try {
    const res = await apiFetch(`/v1/platform/tenants/${tenantId}/database`);
    if (!res.ok) return null;
    const overview = databaseOverviewSchema.parse(await res.json());
    return {
      state: overview.state,
      steps: overview.steps.map(({ step, status, reasonCode }) => ({ step, status, reasonCode })),
    };
  } catch (error) {
    console.error('platform.projects.progress_failed', { error: String(error) });
    return null;
  }
}
