import { type AttemptLimiter, createAttemptLimiter } from '../accounts/rate-limit';

/**
 * The abuse ceilings of the report and block routes (13-14, T-13-34): 20 reports and 60 blocks per member per hour,
 * with the repository's in-process attempt limiter (13-13). Per process on purpose, like the deletion limiter: the
 * effective ceiling is the number here times the instance count, still a hard stop on a flood. Every ATTEMPT counts,
 * a refused one included, so guessing ids is not free. The key is the member inside the tenant of record, never
 * anything the client sends.
 */
export const REPORTS_PER_HOUR = 20;
export const BLOCKS_PER_HOUR = 60;
const HOUR_MS = 60 * 60_000;

export const reportLimiter: AttemptLimiter = createAttemptLimiter({
  max: REPORTS_PER_HOUR,
  windowMs: HOUR_MS,
});

export const blockLimiter: AttemptLimiter = createAttemptLimiter({
  max: BLOCKS_PER_HOUR,
  windowMs: HOUR_MS,
});

/** The limiter key of one member in their tenant. */
export const safetyLimiterKey = (input: { tenantId: string; userId: string }): string[] => [
  `user:${input.tenantId}:${input.userId}`,
];
