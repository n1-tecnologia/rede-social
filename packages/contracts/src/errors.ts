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
  'TENANT_NOT_FOUND',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  // 03-07: the ONE distinguishable refusal of `GET /v1/media/{id}/playback` — the CALLER'S OWN
  // video is still transcoding (`details.media = 'not_ready'`). Every other miss takes the bare
  // 404 above, so this code can never be used to probe another community (T-03-49).
  'CONFLICT',
  // 03-01: the named 03-06 seam — `POST /v1/media/uploads { kind: 'video' }` until the
  // `VideoProvider` adapter lands. A named, tested refusal rather than a silent gap.
  'NOT_IMPLEMENTED',
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
