import { moduleLogger } from '@tria/core/server/logging';
import type { JobDefinition } from '@tria/core/server/modules/manifest';
import { EXAMPLE_PROCESS_QUEUE, type ExampleProcessJob } from '../contracts/index';
import { markProcessed } from './service';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-example');

/**
 * The module's single pg-boss job, declared as data. The worker (`apps/api/src/worker.ts`) creates
 * one queue per `JobDefinition` in the registry at start and binds this handler — the module never
 * touches pg-boss itself, which is what keeps it a package rather than a process.
 *
 * `payload.tenantId` is treated as DATA, not authority: `markProcessed` re-enters the tenant lane
 * with it and RLS decides whether the row is even visible (T-07-03).
 */
export const exampleProcessJob: JobDefinition<ExampleProcessJob> = {
  name: EXAMPLE_PROCESS_QUEUE,
  handler: async (payload) => {
    const updated = await markProcessed(payload.tenantId, payload.itemId);
    log.info(
      {
        event: 'example.process.done',
        tenantId: payload.tenantId,
        itemId: payload.itemId,
        updated,
      },
      'example item processed',
    );
  },
};
