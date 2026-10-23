/**
 * The move engine (09.2-22, D-534, D-536): copies one tenant's rows, accounts, files and queued jobs into a
 * bootstrapped project and verifies the copy. Plan 23 wraps it in the state machine (suspend, quiesce,
 * cutover, rollback, audit, the command). Imported as `@rede-social/core/server/projects/move/index`.
 *
 * Pipeline: `planMove` -> `assertCoverage` -> `copyAuth` -> `copyRows` -> `copyStorage` -> `requeueJobs` ->
 * `verifyCopy`.
 */

export { copyAuth, EmailConflictError } from './copy-auth';
export { COPY_BATCH_SIZE, type CopyOptions, copyRows } from './copy-rows';
export {
  type CopyStorageOptions,
  type CopyStorageReport,
  copyStorage,
  DEFAULT_STORAGE_CONCURRENCY,
  type StorageClientLike,
  type StorageListing,
  type StorageObject,
  type StoragePort,
  storageTotalsOf,
  supabaseStoragePort,
  type UploadOptions,
} from './copy-storage';
export { type FkEdge, type OrderResult, orderTables, SELF_REF_ORDER } from './fk-order';
export {
  accountIdsOf,
  assertCoverage,
  COPY_EXCLUSIONS,
  foreignKeyEdges,
  introspectTables,
  MOVE_BUCKETS,
  planMove,
  SPECIAL_TABLES,
} from './plan';
export { type RequeuePorts, requeueJobs } from './requeue';
export {
  assertNoLeftover,
  BRANDING_PUBLIC_PATH,
  rewriteStorageOrigins,
  scanForOrigin,
} from './rewrite';
export * from './types';
export {
  FULL_CHECKSUM_MAX_ROWS,
  SAMPLE_TARGET_ROWS,
  type VerifyOptions,
  verifyCopy,
} from './verify';
