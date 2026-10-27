import type { ProjectProvider } from './types';

/**
 * Skeleton for the RED commit of 09.4-07 Task 1: the shapes exist, the behaviour does not. The GREEN commit
 * replaces this file with the real validation.
 */

export const SCOPED_TOKEN_PREFIX = 'sbp_fc';

export type TokenReason =
  | 'token_invalid'
  | 'token_forbidden'
  | 'token_other_project'
  | 'token_account_wide'
  | 'token_expiry_invalid'
  | 'org_mismatch'
  | 'not_found'
  | 'unchecked'
  | 'already_registered';

export class TokenRefusal extends Error {
  readonly code: TokenReason;
  constructor(code: TokenReason) {
    super(code);
    this.name = 'TokenRefusal';
    this.code = code;
  }
}

export function todayInSaoPaulo(_now: Date = new Date()): string {
  return '';
}

export async function validateCustomerToken(input: {
  ref: string;
  token: string;
  expiresAt: string | null;
  orgSlug?: string;
  today?: string;
  provider?: ProjectProvider;
}): Promise<{ orgSlug: string; expiresAt: string | null; provider: ProjectProvider }> {
  return { orgSlug: '', expiresAt: input.expiresAt, provider: input.provider as ProjectProvider };
}
