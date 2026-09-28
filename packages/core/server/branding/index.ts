import { z } from 'zod';
import { registerJobQueues } from '../jobs/boss';

/**
 * Kernel branding capability (D-27/D-28): pure key/id helpers, pure sharp derivation and the
 * `kernel.branding-derive-icons` queue. The admin-lane service that talks to Storage and the
 * database is `../platform/branding.ts` (Biome confines `supabaseAdmin`/`withAdminTx` there);
 * the job wrapper is `./derive-icons-job.ts` (imports the service — service -> job direction only,
 * so it is deliberately NOT re-exported from this barrel).
 *
 * Imported as `@rede-social/core/server/branding/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 */

export const BRANDING_DERIVE_ICONS_QUEUE = 'kernel.branding-derive-icons';
/** Bounded crash re-arm: after this many attempts the job logs `gave_up` and stops. */
export const BRANDING_DERIVE_MAX_ATTEMPTS = 3;

export type DeriveIconsPayload = { tenantId: string; iconVersion: number; attempt: number };

/** `iconVersion: -1` means "whatever the row says" (re-arm payloads); the job re-reads the row anyway. */
export const deriveIconsPayloadSchema = z.object({
  tenantId: z.uuid(),
  iconVersion: z.number().int().min(-1),
  attempt: z.number().int().min(0).default(0),
});

// `kernel.branding-derive-icons` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). Every enqueue path
// (`platform/branding.ts`) imports this barrel at module top, so the API's lazy `startedBoss()`
// always knows the queue before the first `send`; the worker creates it from its explicit job list.
registerJobQueues([BRANDING_DERIVE_ICONS_QUEUE]);

export * from './icons';
export * from './upload';
