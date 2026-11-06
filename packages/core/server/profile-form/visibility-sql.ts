import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';

/**
 * INERT STUB (12.2-04 task 3, RED commit only): the builders return an empty string and never validate, so
 * the tests in `tests/profile-form-visibility-sql.test.ts` fail on their assertions. The next commit (GREEN)
 * replaces this whole file.
 */
export const VISIBILITY_SQL_DEPTH = PROFILE_FORM_LIMITS.branchDepth;

export function branchChainOpenSql(_input: {
  branchRef: string;
  tenant: string;
  member: string;
}): string {
  return '';
}

export function questionVisibleSql(_input: {
  question: string;
  tenant: string;
  member: string;
}): string {
  return '';
}
