import { z } from 'zod';

/**
 * The panel's view of a tenant's database (09.2-14, D-541, D-542, D-543, D-545): the project ref and its
 * paste normaliser, the eight bootstrap steps, the eight database states and the ONE function that derives a
 * state, the strict answers of the project routes and the write-only credential bodies.
 *
 * One module for the API and the web: the pre-check form, the Banco tab, the list pill and the tenant header
 * all import `databaseState` from here, so they cannot disagree about what "Atrasado" means.
 *
 * Nothing in this file can carry a credential back to the panel. The answers are `.strict()` and have no field
 * of a credential kind; the only secrets that appear are the INPUT bodies (`projectAccessSchema`,
 * `replaceCredentialsBodySchema`), which the server seals and never echoes (D-539).
 */

// ---------------------------------------------------------------------------------------------------------
// Project ref
// ---------------------------------------------------------------------------------------------------------

/** A hosted Supabase project ref: exactly 20 lower-case letters. */
export const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
/** The looser local form of a ref (the registry's own check): only the `fake` provider accepts it. */
export const LOCAL_PROJECT_REF_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;

export const projectRefSchema = z.string().regex(PROJECT_REF_PATTERN);
export const localProjectRefSchema = z.string().regex(LOCAL_PROJECT_REF_PATTERN);

export type ProjectProviderName = 'supabase' | 'fake';

/** Whether `value` is a valid ref for the provider: 20 letters for `supabase`, the looser form for `fake`. */
export function isProjectRef(provider: ProjectProviderName, value: string): boolean {
  return (provider === 'supabase' ? PROJECT_REF_PATTERN : LOCAL_PROJECT_REF_PATTERN).test(value);
}

const DASHBOARD_URL =
  /^https?:\/\/(?:www\.)?supabase\.com\/dashboard\/project\/([^/?#\s]+)(?:[/?#].*)?$/;
const PROJECT_URL = /^https?:\/\/([^/?#.\s]+)\.supabase\.co(?::\d+)?(?:[/?#].*)?$/;

/**
 * The paste normaliser of the "Código do projeto" field (UI-D-533): trims, lower-cases and extracts the ref
 * from the two shapes people copy, `https://supabase.com/dashboard/project/{ref}` (with any trailing path) and
 * `https://{ref}.supabase.co`. Anything else is kept as typed (trimmed, lower-cased) and fails the format rule.
 * Pure, so the web and its tests share it; the API never uses it (it accepts only a bare ref).
 */
export function normalizeProjectRef(input: string): string {
  const text = input.trim().toLowerCase();
  const dashboard = DASHBOARD_URL.exec(text);
  if (dashboard?.[1]) return dashboard[1];
  const project = PROJECT_URL.exec(text);
  if (project?.[1]) return project[1];
  return text;
}

// ---------------------------------------------------------------------------------------------------------
// Bootstrap steps and reasons (the catalog is plan 12's `BOOTSTRAP_REASONS`, mirrored here for the web)
// ---------------------------------------------------------------------------------------------------------

/** The eight bootstrap steps in their fixed order (UI-D-537). */
export const BOOTSTRAP_STEP_KEYS = [
  'verify',
  'roles',
  'schema',
  'auth',
  'buckets',
  'realtime',
  'tenant',
  'invite',
] as const;
export type BootstrapStepKey = (typeof BOOTSTRAP_STEP_KEYS)[number];

export const BOOTSTRAP_STEP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type BootstrapStepStatus = (typeof BOOTSTRAP_STEP_STATUSES)[number];

/**
 * The closed catalog of reason codes a step or a health check can report (UI A-UI-10). Never provider text.
 * Thirteen since 09.4-03; the same thirteen, in the same order, are the core `BOOTSTRAP_REASONS` (plan 05).
 */
export const BOOTSTRAP_REASON_CODES = [
  'unreachable',
  'access_denied',
  'not_empty',
  'migration_failed',
  'auth_config_failed',
  'storage_failed',
  'realtime_failed',
  'tenant_failed',
  'invite_failed',
  'unknown',
  // 09.4-03 (D-573): the three codes of a customer-owned project, APPENDED so the first ten keep their order.
  'token_invalid',
  'token_forbidden',
  'org_mismatch',
] as const;
export type BootstrapReasonCode = (typeof BOOTSTRAP_REASON_CODES)[number];

// ---------------------------------------------------------------------------------------------------------
// The database state
// ---------------------------------------------------------------------------------------------------------

/** The eight states of UI-D-539, in the order the pill vocabulary lists them. */
export const DATABASE_STATES = [
  'ready',
  'preparing',
  'preparation_failed',
  'behind',
  'paused',
  'unreachable',
  'moving',
  'unchecked',
] as const;
export type DatabaseState = (typeof DATABASE_STATES)[number];

/** The four states the list's "Banco com problema" chip isolates (UI-D-540). */
export const DATABASE_PROBLEM_STATES = [
  'preparation_failed',
  'behind',
  'paused',
  'unreachable',
] as const satisfies readonly DatabaseState[];

export type DatabaseStateInput = {
  /** `platform.projects.state`: anything other than `ready` means the project is still being prepared. */
  projectState: string;
  /** The bootstrap step rows of the project (only `status` is read); empty for a project that was never bootstrapped. */
  steps: ReadonlyArray<{ status: string }>;
  /** `platform.project_health.status`; `null` or `unknown` means the health job has not run yet. */
  health: string | null | undefined;
  /** Applied and required tenant migration counts; either may be `null` (never probed, or the gate is off). */
  schema: { applied: number | null; required: number | null } | null | undefined;
  /** A move holds the tenant (plan 23). */
  moving: boolean;
};

/**
 * The ONE derivation of a tenant's database state (D-542, D-543, D-545), with the precedence
 * moving > preparation_failed > preparing > unreachable > paused > behind > unchecked > ready.
 *
 *  - `moving`: the move tool holds the tenant;
 *  - `preparation_failed`: a bootstrap step failed and waits for "Tentar de novo";
 *  - `preparing`: the project is not `ready` (the bootstrap is running or has not started);
 *  - `unreachable` / `paused`: the last health check said so;
 *  - `behind`: the applied tenant schema is strictly below the required one (equal or ahead is never behind;
 *    a missing number holds nothing out);
 *  - `unchecked`: the health job has not run yet;
 *  - `ready`: everything above is false.
 */
export function databaseState(input: DatabaseStateInput): DatabaseState {
  if (input.moving) return 'moving';
  if (input.steps.some((step) => step.status === 'failed')) return 'preparation_failed';
  if (input.projectState !== 'ready') return 'preparing';
  if (input.health === 'unreachable') return 'unreachable';
  if (input.health === 'paused') return 'paused';
  const schema = input.schema;
  if (
    schema &&
    schema.applied !== null &&
    schema.required !== null &&
    schema.applied < schema.required
  ) {
    return 'behind';
  }
  if (input.health === null || input.health === undefined || input.health === 'unknown') {
    return 'unchecked';
  }
  return 'ready';
}

// ---------------------------------------------------------------------------------------------------------
// The token state (09.4-03, D-573, D-574, UI-D-553): its own axis, never a database state
// ---------------------------------------------------------------------------------------------------------

/** The seven token states of UI-D-553, in the order the pill vocabulary lists them. */
export const TOKEN_STATES = [
  'valid',
  'expiring',
  'expired',
  'invalid',
  'no_permission',
  'org_mismatch',
  'unchecked',
] as const;
export type TokenState = (typeof TOKEN_STATES)[number];

/** The stored outcomes of the last token check (`platform.project_health.token_check`). */
export const TOKEN_CHECKS = ['ok', 'invalid', 'forbidden', 'org_mismatch'] as const;
export type TokenCheck = (typeof TOKEN_CHECKS)[number];

/** How many days before the typed expiry the state reads `expiring` (A-UI-5): the ONLY place the number lives. */
export const TOKEN_EXPIRING_WINDOW_DAYS = 30;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days since the epoch of a real `YYYY-MM-DD` calendar date, or `null`. Date.UTC only: no timezone enters. */
function epochDay(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(ms / 86_400_000);
}

export type TokenStateInput = {
  /** The last stored check outcome; `null` when the token was never checked. */
  check: TokenCheck | null;
  /** The expiry date the operator typed (`YYYY-MM-DD`), or `null` when none was informed. */
  expiresAt: string | null;
  /** Today's date (`YYYY-MM-DD`), injected so the function stays pure. */
  today: string;
};

/**
 * The ONE derivation of a customer project's token state (D-573, UI-D-553), with the precedence
 * org_mismatch > invalid > no_permission > expired > expiring > unchecked > valid. The token card, the header
 * pill, the list pill and the list filter all call it, so they cannot disagree. API and web import it, as they
 * do `databaseState`.
 *
 *  - `org_mismatch` / `invalid` / `no_permission` (the stored `forbidden`): the last check said so;
 *  - `expired`: the typed expiry is before `today`;
 *  - `expiring`: the whole days from `today` to the expiry are at most `TOKEN_EXPIRING_WINDOW_DAYS`;
 *  - `unchecked`: nothing says otherwise and the token was never checked;
 *  - `valid`: everything above is false.
 *
 * A platform-owned project has no token state at all, and the token state never feeds `databaseState`
 * (D-574, A-UI-6): a dead token is not an outage.
 */
export function tokenState(input: TokenStateInput): TokenState {
  if (input.check === 'org_mismatch') return 'org_mismatch';
  if (input.check === 'invalid') return 'invalid';
  if (input.check === 'forbidden') return 'no_permission';
  const expiry = input.expiresAt === null ? null : epochDay(input.expiresAt);
  const today = epochDay(input.today);
  if (expiry !== null && today !== null) {
    if (expiry < today) return 'expired';
    if (expiry - today <= TOKEN_EXPIRING_WINDOW_DAYS) return 'expiring';
  }
  if (input.check === null) return 'unchecked';
  return 'valid';
}

/**
 * The one rule for the typed expiry (D-575, UI-D-550): `YYYY-MM-DD`, a real calendar date, strictly after
 * `today` and at most one year after `today`. The API and the form both use it.
 */
export function tokenExpiryIsValid(expiresAt: string, today: string): boolean {
  const expiry = epochDay(expiresAt);
  const from = epochDay(today);
  if (expiry === null || from === null) return false;
  if (expiry <= from) return false;
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const limit = Math.round(Date.UTC(year + 1, month - 1, day) / 86_400_000);
  return expiry <= limit;
}

// ---------------------------------------------------------------------------------------------------------
// The customer-owned project: owner, token inputs and the token-free summary (09.4-03, D-570..D-575)
// ---------------------------------------------------------------------------------------------------------

/** Who owns the Supabase project: the platform's organisation or the customer's own (D-570). */
export const OWNERS = ['platform', 'customer'] as const;
export type ProjectOwner = (typeof OWNERS)[number];

/**
 * The cap of every token INPUT. Scoped tokens are JWT-shaped, so this is the cap the access bodies already use.
 * It deliberately amends the 256 of UI-D-550's `maxLength`.
 */
export const TOKEN_MAX_LENGTH = 4096;

/**
 * What an answer says about the token (UI-D-554): the derived state, the expiry the operator typed and when the
 * last check ran. Nothing here can hold the token, its prefix, its hash or its length (UI-D-561).
 */
export const tokenSummarySchema = z
  .object({
    state: z.enum(TOKEN_STATES),
    expiresAt: z.string().nullable(),
    checkedAt: z.string().nullable(),
  })
  .strict();
export type TokenSummary = z.infer<typeof tokenSummarySchema>;

/**
 * The customer-project fields shared by the pre-check body and the create body (write-only INPUT, never an
 * answer): the owner, the token and the expiry the operator typed. The expiry SHAPE is checked by
 * `tokenExpiryIsValid` in the kernel (it needs `today`), not here. The token is accepted here and nowhere in an
 * answer (UI-D-561).
 */
export const customerProjectFields = {
  owner: z.enum(OWNERS).optional(),
  // Trimmed like `replaceTokenBodySchema`: a pasted leading space or newline must not read as another kind of
  // token, and the sealed value is never padded (09.4 review WR-03).
  token: z.string().trim().max(TOKEN_MAX_LENGTH).optional(),
  tokenExpiresAt: z.string().max(10).optional(),
};

/**
 * Cross-field rule of the customer fields, for `.superRefine` (STATIC messages only: a Zod issue is echoed by
 * the platform hook, so no submitted value may reach it, T-09.4-10): `owner: 'customer'` needs a non-blank
 * token; a token or an expiry with the owner absent or `platform` is refused.
 */
export function refineCustomerProject(
  body: {
    owner?: ProjectOwner | undefined;
    token?: string | undefined;
    tokenExpiresAt?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const hasToken = (body.token ?? '').trim().length > 0;
  const hasExpiry = (body.tokenExpiresAt ?? '').trim().length > 0;
  if (body.owner === 'customer') {
    if (!hasToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['token'],
        message: 'Cole o token de acesso do projeto.',
      });
    }
    return;
  }
  if (hasToken || hasExpiry) {
    ctx.addIssue({
      code: 'custom',
      path: ['owner'],
      message: 'O token só vale para um projeto do cliente.',
    });
  }
}

// ---------------------------------------------------------------------------------------------------------
// Answers (strict: no field can carry a credential)
// ---------------------------------------------------------------------------------------------------------

const schemaCountsSchema = z
  .object({
    applied: z.number().int().min(0).nullable(),
    required: z.number().int().min(0).nullable(),
  })
  .strict();
export type DatabaseSchemaCounts = z.infer<typeof schemaCountsSchema>;

/** The `database` block of a row of `GET /v1/platform/tenants` (UI-D-540). */
export const tenantDatabaseSummarySchema = z
  .object({
    state: z.enum(DATABASE_STATES),
    schema: schemaCountsSchema,
    /** 09.4-03: the token state of a customer project, `null` or absent for a platform one (optional: expand-only). */
    token: z
      .object({ state: z.enum(TOKEN_STATES) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type TenantDatabaseSummary = z.infer<typeof tenantDatabaseSummarySchema>;

export const bootstrapStepRowSchema = z
  .object({
    step: z.enum(BOOTSTRAP_STEP_KEYS),
    status: z.enum(BOOTSTRAP_STEP_STATUSES),
    attempt: z.number().int().min(0),
    reasonCode: z.enum(BOOTSTRAP_REASON_CODES).nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .strict();
export type BootstrapStepRow = z.infer<typeof bootstrapStepRowSchema>;

/**
 * `GET /v1/platform/tenants/{id}/database` (UI-D-536..539): everything the Banco tab shows and nothing it must
 * not. `credentials` says whether the registry HOLDS the sealed values and when they were last written; the
 * values themselves have no place in any answer (D-539). `otherTenants` is how many OTHER tenants share the
 * project (D-540, non-production only). `plan` is information (D-543).
 */
export const databaseOverviewSchema = z
  .object({
    ref: z.string(),
    plan: z.string().nullable(),
    state: z.enum(DATABASE_STATES),
    steps: z.array(bootstrapStepRowSchema),
    schema: schemaCountsSchema,
    lastCheckedAt: z.string().nullable(),
    preparationFinishedAt: z.string().nullable(),
    credentials: z.object({ held: z.boolean(), updatedAt: z.string().nullable() }).strict(),
    otherTenants: z.number().int().min(0),
    moving: z.boolean(),
    lastErrorCode: z.enum(BOOTSTRAP_REASON_CODES).nullable(),
    /**
     * 09.4-03 (D-570, D-573, UI-D-552, UI-D-554): who owns the project, the Supabase organisation slug and the
     * token summary. All OPTIONAL on purpose, so a web deployed before or after the API still parses the other
     * side's answer (expand-only); the panel reads `owner ?? 'platform'`. No field can hold the token itself.
     */
    owner: z.enum(OWNERS).optional(),
    organization: z.string().nullable().optional(),
    token: tokenSummarySchema.nullable().optional(),
  })
  .strict();
export type DatabaseOverview = z.infer<typeof databaseOverviewSchema>;

// ---------------------------------------------------------------------------------------------------------
// Pre-check
// ---------------------------------------------------------------------------------------------------------

/** The reasons a pre-check refuses a ref; the web maps each to one field error (UI-D-533). */
export const PRECHECK_REASONS = [
  'invalid',
  'not_found',
  'not_empty',
  'in_use',
  'paused',
  'unchecked',
  // 09.4-03 (D-570..D-572): the customer-token refusals, appended after the shipped six.
  'token_invalid',
  'token_forbidden',
  'token_other_project',
  'token_account_wide',
  'token_expiry_invalid',
  /** Reserved: the locked permission list cannot read the plan, so the server never emits it today (D-572). */
  'not_pro',
] as const;
export type PrecheckReason = (typeof PRECHECK_REASONS)[number];

/**
 * Body of `POST /v1/platform/projects/precheck`. The ref may be empty or malformed: that is an answer, not a 400.
 * A customer project adds `owner`, the write-only `token` and the optional typed `tokenExpiresAt` (D-570, D-575).
 */
export const precheckBodySchema = z
  .object({ projectRef: z.string().trim().max(200), ...customerProjectFields })
  .strict()
  .superRefine(refineCustomerProject);
export type PrecheckBody = z.infer<typeof precheckBodySchema>;

/** `ok: true` with `manualAccess` (the platform token cannot reveal the project's secrets), or `ok: false` with a reason. */
export const precheckAnswerSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), manualAccess: z.boolean() }).strict(),
  z.object({ ok: z.literal(false), reason: z.enum(PRECHECK_REASONS) }).strict(),
]);
export type PrecheckAnswer = z.infer<typeof precheckAnswerSchema>;

// ---------------------------------------------------------------------------------------------------------
// Write-only access
// ---------------------------------------------------------------------------------------------------------

const accessFields = {
  databasePassword: z.string().max(4096).optional(),
  serviceKey: z.string().max(4096).optional(),
  publishableKey: z.string().max(4096).optional(),
};

/**
 * The three manual-access values (UI-D-534): the `postgres` password and the project's service and publishable
 * keys. Write-only: sealed straight into the registry after being validated against the project, never echoed,
 * never logged. An empty string counts as absent.
 */
export const projectAccessSchema = z.object(accessFields).strict();
export type ProjectAccess = z.infer<typeof projectAccessSchema>;

export const ACCESS_FIELDS = ['databasePassword', 'serviceKey', 'publishableKey'] as const;
export type AccessField = (typeof ACCESS_FIELDS)[number];

/** Body of `PUT /v1/platform/tenants/{id}/database/credentials`: any non-empty subset, strict. */
export const replaceCredentialsBodySchema = z
  .object(accessFields)
  .strict()
  .refine((body) => ACCESS_FIELDS.some((key) => (body[key] ?? '').trim().length > 0), {
    message: 'Informe ao menos um valor.',
  });
export type ReplaceCredentialsBody = z.infer<typeof replaceCredentialsBodySchema>;

/** `PUT /v1/platform/tenants/{id}/database/credentials` answers only that it worked; no value comes back. */
export const replaceCredentialsAnswerSchema = z.object({ ok: z.literal(true) }).strict();
export type ReplaceCredentialsAnswer = z.infer<typeof replaceCredentialsAnswerSchema>;

/**
 * Body of `PUT /v1/platform/tenants/{id}/database/token` (D-575, UI-D-555): the new write-only token and the
 * optional typed expiry. Strict; the date shape is checked by `tokenExpiryIsValid` in the kernel.
 */
export const replaceTokenBodySchema = z
  .object({
    token: z.string().trim().min(1).max(TOKEN_MAX_LENGTH),
    tokenExpiresAt: z.string().max(10).optional(),
  })
  .strict();
export type ReplaceTokenBody = z.infer<typeof replaceTokenBodySchema>;

/** `PUT /v1/platform/tenants/{id}/database/token` answers only that it worked; the token never comes back. */
export const replaceTokenAnswerSchema = z.object({ ok: z.literal(true) }).strict();
export type ReplaceTokenAnswer = z.infer<typeof replaceTokenAnswerSchema>;

/** The `?banco=` filter of the tenant list. */
export const bancoFilterSchema = z.enum(['problema']);
