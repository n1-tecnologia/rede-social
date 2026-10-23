/**
 * The move engine (09.2-22, D-534, D-536): copies one tenant's rows, accounts, files and queued jobs into a
 * bootstrapped project and verifies the copy. Plan 23 wraps it in the state machine (suspend, quiesce,
 * cutover, rollback, audit, the command). Imported as `@rede-social/core/server/projects/move/index`.
 *
 * Pipeline: `planMove` -> `assertCoverage` -> `copyAuth` -> `copyRows` -> `copyStorage` -> `requeueJobs` ->
 * `verifyCopy`.
 */

export {
  defaultBossFor,
  defaultStorage,
  type MoveContext,
  type MoveDeps,
  type MoveWaits,
  openContext,
  type StatusSetter,
} from './context';
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
export {
  completeCutover,
  currentStatus,
  dropCaches,
  dropTenantHostCache,
  flipPointer,
} from './cutover';
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
export {
  activeJobsOf,
  DEFAULT_GAP_MS,
  DEFAULT_JOBS_WAIT_MS,
  DEFAULT_QUIESCE_MS,
  type Fingerprint,
  fingerprintOf,
  type QuiesceOptions,
  quiesce,
} from './quiesce';
export { type RequeuePorts, requeueJobs } from './requeue';
export {
  assertNoLeftover,
  BRANDING_PUBLIC_PATH,
  rewriteStorageOrigins,
  scanForOrigin,
} from './rewrite';
export {
  DEFAULT_REGISTRY_WAIT_MS,
  type MoveLine,
  type MoveMode,
  type MoveOptions,
  type MoveResult,
  runMove,
} from './run';
export {
  advance,
  canTransition,
  claimLease,
  eventsOf,
  hasEvent,
  isOpen,
  LEASE_MINUTES,
  latestMoveOf,
  leaseClaimable,
  loadMove,
  MOVE_STATES,
  type MoveEvent,
  type MoveRow,
  type MoveState,
  type MoveStore,
  openMoveOf,
  platformStore,
  recordEvent,
  releaseLease,
  setMoveError,
  TRANSITIONS,
} from './state';
export {
  assertTargetReady,
  bootstrapTarget,
  registerMoveTarget,
  type TargetDeps,
} from './target';
export * from './types';
export {
  FULL_CHECKSUM_MAX_ROWS,
  SAMPLE_TARGET_ROWS,
  type VerifyOptions,
  verifyCopy,
} from './verify';
