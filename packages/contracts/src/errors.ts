import { z } from 'zod';

/**
 * Stable machine codes every client screen switches on (D-09). `TENANT_HOST_MISMATCH` per D-23;
 * `TENANT_SUSPENDED` (D-32) is the tenant being unavailable as a whole, distinct from
 * `MEMBERSHIP_BLOCKED` (this member only) — the web routes them to different screens.
 * `DOMAIN_IN_USE` / `DOMAIN_STATE_INVALID` (D-34/D-35) are the platform panel's custom-domain
 * refusals: a host attached to another tenant (the body never names it), and an operation the
 * row's state forbids (`details.reason` from `DOMAIN_STATE_REASONS`).
 */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_TOKEN',
  'NO_MEMBERSHIP',
  'MEMBERSHIP_BLOCKED',
  'TENANT_SUSPENDED',
  'DOMAIN_IN_USE',
  'DOMAIN_STATE_INVALID',
  'TENANT_HOST_MISMATCH',
  'MODULE_DISABLED',
  'FORBIDDEN',
  'EMAIL_ALREADY_REGISTERED',
  'TENANT_NOT_FOUND',
  'VALIDATION_FAILED',
  'NOT_FOUND',
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
