/**
 * Account deletion (13-13, D-609, D-610): the request with password re-entry, the cancel by a fresh sign-in
 * and the one-time notice live in `deletion.ts`; the job that anonymises after the 14-day window and confirms by
 * e-mail lives in `anonymise-job.ts` (a worker file, imported by the worker only).
 */
export {
  cancelPendingDeletion,
  type DeletionDeps,
  type DeletionInput,
  defaultDeletionDeps,
  isLastAdmin,
  PASSWORD_MAX,
  requestAccountDeletion,
  takeDeletionNotice,
} from './deletion';
export {
  accountDeletionLimiter,
  DELETION_ATTEMPTS,
  DELETION_WINDOW_MS,
  deletionLimiterKeys,
} from './rate-limit';
