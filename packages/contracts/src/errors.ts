import { z } from 'zod';

/** Stable machine codes every client screen switches on (D-09). `TENANT_HOST_MISMATCH` per D-23. */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'INVALID_TOKEN',
  'NO_MEMBERSHIP',
  'MEMBERSHIP_BLOCKED',
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
