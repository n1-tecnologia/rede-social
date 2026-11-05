import { z } from 'zod';

/**
 * Stable machine codes every client screen switches on (D-09). `TENANT_HOST_MISMATCH` per D-23 (since
 * 08.1, D-307: the session holds no membership in the tenant host's community);
 * `TENANT_SUSPENDED` (D-32) is the tenant being unavailable as a whole, distinct from
 * `MEMBERSHIP_BLOCKED` (this member only) — the web routes them to different screens.
 * `MEMBERSHIP_INVITED` (D-29) is an invited admin's Bearer outside the two onboarding routes: the web
 * routes it back to `/aceitar-convite`.
 * `DOMAIN_IN_USE` / `DOMAIN_STATE_INVALID` (D-34/D-35) are the platform panel's custom-domain
 * refusals: a host attached to another tenant (the body never names it), and an operation the
 * row's state forbids (`details.reason` from `DOMAIN_STATE_REASONS`). `INVITE_STATE_INVALID` (D-30)
 * is the same shape for the first-admin invite (`details.reason` from `INVITE_STATE_REASONS`).
 * `EMAIL_NOT_ALLOWED` (quick 261018-owq) is an e-mail that is not on the global allowlist.
 * `SUBSCRIPTION_PENDING` (09.1-02, D-497) is the payment-cut refusal of `requireAuth`.
 * `PROFILE_FORM_PENDING` (12-05, D-581) is the unanswered-required-question refusal, last in the chain.
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_TOKEN',
  'NO_MEMBERSHIP',
  'MEMBERSHIP_BLOCKED',
  'TENANT_SUSPENDED',
  'MEMBERSHIP_INVITED',
  'DOMAIN_IN_USE',
  'DOMAIN_STATE_INVALID',
  'INVITE_STATE_INVALID',
  'TENANT_HOST_MISMATCH',
  // 08.1-01 (D-308, D-06): a host that is not a tenant host (localhost, Vercel Preview, the platform
  // host, no header) and a caller with several memberships and no valid `x-tenant-choice` among them.
  // Never carries details: the body must not name or count the caller's communities.
  'TENANT_CHOICE_REQUIRED',
  'MODULE_DISABLED',
  'FORBIDDEN',
  'EMAIL_ALREADY_REGISTERED',
  // Quick 261018-owq: the stable refusal for an e-mail that is not `liberado` on the global
  // allowlist (`public.email_allowlist`): sign-up, and an invite for an address un-listed since.
  'EMAIL_NOT_ALLOWED',
  'TENANT_NOT_FOUND',
  // 09.1-02 (D-496, D-497): a member of a tenant whose payment gate is on and whose e-mail has no
  // active access. A sibling of `MEMBERSHIP_BLOCKED`, NEVER a membership status: nothing of the
  // member's profile, content or session is touched. `details.tenantName` only (the host's tenant,
  // D-302). One-way: the web app branches on this literal.
  'SUBSCRIPTION_PENDING',
  // 12-05 (D-581): the profile form's refusal of `requireAuth`, a sibling of the payment cut, NEVER a
  // membership status: nothing of the member's profile, content or session is touched. `details.tenantName`
  // only. One-way once released: the web app branches on this literal.
  'PROFILE_FORM_PENDING',
  // 09.2-03 (D-538, D-537): the routing seam failed CLOSED. `TENANT_PROJECT_UNBOUND`: the tenant has no
  // `platform.tenant_projects` row; `TENANT_UNAVAILABLE`: the tenant's project cannot be reached right now
  // (breaker open, connection refused, or the registry unreadable with no fresh enough binding). Both are
  // 503 and carry no details: the body never names a project, a ref or a tenant. Costly to rename once
  // released, not a one-way door (the web branches on the literal).
  'TENANT_PROJECT_UNBOUND',
  'TENANT_UNAVAILABLE',
  // 09.2-08 (D-542, D-545): the tenant's project is still being prepared / is being migrated. 503, no details
  // (no project fact, no tenant name). Costly to rename once released, not a one-way door.
  'TENANT_PREPARING',
  'TENANT_UPDATING',
  // 09.2-23 (D-535, DBT-48, T-09.2-101): a platform mutation of a tenant whose database is being moved. 409, no
  // details (no project fact, no tenant name). The panel's disabled button is the visible half; this is the rule.
  'TENANT_MOVING',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  // 03-07: the ONE distinguishable refusal of `GET /v1/media/{id}/playback` — the CALLER'S OWN
  // video is still transcoding (`details.media = 'not_ready'`). Every other miss takes the bare
  // 404 above, so this code can never be used to probe another community (T-03-49).
  'CONFLICT',
  // 03-01: the named 03-06 seam — `POST /v1/media/uploads { kind: 'video' }` until the
  // `VideoProvider` adapter lands. A named, tested refusal rather than a silent gap.
  'NOT_IMPLEMENTED',
  // 13-09 (D-605, D-615, T-13-18): the closed refusals of the App tab. The first three say a store credential
  // file is the wrong kind (a `.p8` that is not an EC P-256 key, a typed Key ID that differs from the one in the
  // file name, a Google JSON that is not a service account) and NEVER name a value. `IDS_LOCKED` (409) says the
  // store ids cannot change once the app is marked published.
  'CREDENTIAL_NOT_P8',
  'CREDENTIAL_KEY_ID_MISMATCH',
  'CREDENTIAL_NOT_SERVICE_ACCOUNT',
  'IDS_LOCKED',
  // 13-13 (D-609, D-610, T-13-29): the account-deletion refusals. `LAST_ADMIN` (409): the only active
  // administrator cannot delete their own account (SQLSTATE AD001). `WRONG_PASSWORD` (403): the password
  // re-entry did not match; nothing was changed. `RATE_LIMITED` (429): too many deletion attempts for this
  // member or this network address. None carries details. One-way once released: the apps branch on them.
  'LAST_ADMIN',
  'WRONG_PASSWORD',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `{ error: { code, message, details?, requestId } }` — the only error shape the API produces. */
export type ApiErrorEnvelope = {
  error: {
    code: ErrorCode | 'HTTP_ERROR';
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
};

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.enum([...ERROR_CODES, 'HTTP_ERROR']),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
});
