/**
 * The module's pg-boss jobs, declared as DATA and re-exported here so `module.ts` never reaches
 * into `unfurl/` (the `packages/modules/example/server/jobs.ts` shape).
 *
 * The kernel creates one queue per `JobDefinition` in the manifest and the worker binds the handler
 * through `MODULE_REGISTRY` — the module never touches pg-boss itself, and `apps/api/src/worker.ts`
 * needs no edit to pick this up.
 */
export { feedUnfurlJob } from './unfurl/job';
