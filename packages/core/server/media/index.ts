import { z } from 'zod';
import { registerJobQueues } from '../jobs/boss';

/**
 * Kernel media capability (MEDIA-01/MEDIA-02/TENANT-04, CONTEXT D-16 — always on, no module flag):
 * pure key/limit/inspect/variant helpers and the `kernel.media-derive-variants` queue. The lanes
 * that talk to Storage and the database are `./storage.ts` and `./service.ts`; the job wrapper is
 * `./derive-job.ts` (it imports the service — service -> job direction only, so it is deliberately
 * NOT re-exported from this barrel).
 *
 * Imported as `@tria/core/server/media/index` from outside the kernel (the `./server/*` export maps
 * to a file, not a directory).
 */

export const MEDIA_DERIVE_QUEUE = 'kernel.media-derive-variants';
/** Bounded crash re-arm: after this many attempts the asset is flipped to a terminal `failed`. */
export const MEDIA_DERIVE_MAX_ATTEMPTS = 3;

export type DeriveVariantsPayload = { tenantId: string; assetId: string; attempt: number };

export const deriveVariantsPayloadSchema = z.object({
  tenantId: z.uuid(),
  assetId: z.uuid(),
  attempt: z.number().int().min(0).default(0),
});

// `kernel.media-derive-variants` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). Every enqueue path
// (`media/service.ts`) imports this barrel at module top, so the API's lazy `startedBoss()` always
// knows the queue before the first `send`; the worker creates it from its explicit job list.
registerJobQueues([MEDIA_DERIVE_QUEUE]);

export * from './inspect';
export * from './keys';
export * from './limits';
export * from './variants';
