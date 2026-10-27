import { tokenExpiryIsValid } from '@rede-social/contracts/projects';
import { createRequestTokenProvider } from './provider-for';
import { type ProjectProvider, ProjectProviderError } from './types';

/**
 * The token kernel (09.4-07, D-567..D-572, CTK-09, CTK-10, CTK-12): the ONE validation every path that receives
 * a customer's management token runs (the new-tenant wizard, a replacement, an owner change, a move target),
 * before anything is sealed or replaced. It runs in a fixed order and stops at the first refusal:
 *
 *   1. the typed expiry date is a real date, after today, at most a year ahead   `token_expiry_invalid`
 *   2. the token starts with `sbp_fc`, the prefix of a fine-grained token         `token_account_wide` (D-570a)
 *   3. `describe(ref)` through a request-token provider: 401 `token_invalid`, 403 `token_forbidden`, 404
 *      `not_found`, another organisation than the pin `org_mismatch`, anything else `unchecked`
 *   4. `listProjects()`: any listed ref other than the target is `token_account_wide` (D-570b); a 403 passes (a
 *      project-scoped token is refused the listing); a timeout or a 5xx is `unchecked`
 *
 * D-570, both checks required (orchestrator ruling 1): the prefix and the listing are independent. With the
 * locked thirteen permissions the listing check is WEAK: an organisation-wide fine-grained token is also
 * refused the listing (403) and passes it. That is stated here, in `docs/DEPLOY.md` (plan 17) and as a ledger
 * advisory; this plan does not add a fourteenth permission.
 *
 * D-571: with no pin the first `describe` LEARNS the organisation and the validation returns it for the caller
 * to store; with a pin (a replacement, plan 10) a different organisation is `org_mismatch` before anything is
 * replaced. The pin is a slug read from the project, never typed.
 *
 * D-572: the plan (Free or Pro) is not read (the locked permissions cannot). `token_other_project` and
 * `not_pro` are never emitted by this module today: Supabase cannot tell "another project" from "no
 * permission" on a 403 (probe P5 may change that), so both stay in the closed contract lists and the form,
 * reserved.
 *
 * A refusal is a `TokenRefusal` whose message IS its closed code. No function here logs, returns, throws or
 * persists a token, its prefix, its length or a hash of it (T-09.4-24).
 */

/** The prefix of a project-scoped (fine-grained) Supabase access token. */
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

/** A closed refusal: the message is the code and nothing else, so no value can travel inside it. */
export class TokenRefusal extends Error {
  readonly code: TokenReason;

  constructor(code: TokenReason) {
    super(code);
    this.name = 'TokenRefusal';
    this.code = code;
  }
}

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day of `now` in America/Sao_Paulo as `YYYY-MM-DD`. The operator is in Brazil and the typed
 * expiry date carries no zone, so "today" is read where the operator is, not in UTC.
 */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return SAO_PAULO_DAY.format(now);
}

/** What a failed `describe` means for the token, as one closed code. */
function describeRefusal(error: unknown): TokenReason {
  if (error instanceof ProjectProviderError) {
    if (error.customerToken) {
      if (error.code === 'token_invalid') return 'token_invalid';
      if (error.code === 'token_forbidden') return 'token_forbidden';
      if (error.code === 'org_mismatch') return 'org_mismatch';
    }
    if (error.kind === 'not_found') return 'not_found';
  }
  return 'unchecked';
}

export type ValidatedToken = {
  /** The organisation of the project, learned from it (or the pin, when one was given). */
  orgSlug: string;
  expiresAt: string | null;
  /** The provider the checks ran on: the caller may reuse it for the registration's next read. */
  provider: ProjectProvider;
};

/** Runs the whole registration validation. Returns the learned organisation or throws a `TokenRefusal`. */
export async function validateCustomerToken(input: {
  ref: string;
  token: string;
  expiresAt: string | null;
  /** The organisation the project must belong to (a replacement); absent on a first registration. */
  orgSlug?: string;
  /** Test seam: the day the typed date is judged against; defaults to today in America/Sao_Paulo. */
  today?: string;
  /** Test seam: a ready provider; defaults to one built from the token alone (learn mode when no pin). */
  provider?: ProjectProvider;
}): Promise<ValidatedToken> {
  const { ref, token, expiresAt } = input;

  // (1) The typed date, before any other work: a typo costs nothing.
  if (expiresAt !== null && !tokenExpiryIsValid(expiresAt, input.today ?? todayInSaoPaulo())) {
    throw new TokenRefusal('token_expiry_invalid');
  }

  // (2) The prefix of a project-scoped token (D-570a). No request is made for a token that fails it.
  if (!token.startsWith(SCOPED_TOKEN_PREFIX)) throw new TokenRefusal('token_account_wide');

  // (3) The token reaches the project, and the project belongs to the pinned organisation (or teaches it).
  let provider: ProjectProvider;
  let orgSlug: string;
  try {
    provider =
      input.provider ??
      (await createRequestTokenProvider({
        token,
        ...(input.orgSlug === undefined ? {} : { orgSlug: input.orgSlug }),
      }));
    const described = await provider.describe(ref);
    orgSlug = described.orgSlug;
  } catch (error) {
    throw new TokenRefusal(describeRefusal(error));
  }
  // The real adapter already refuses another organisation; this covers a provider that does not.
  if (input.orgSlug !== undefined && orgSlug !== input.orgSlug) {
    throw new TokenRefusal('org_mismatch');
  }

  // (4) The behavioural check (D-570b): a project-scoped token lists nothing but its own project, or is refused.
  try {
    const listed = await provider.listProjects();
    if (listed.some((entry) => entry.ref !== ref)) throw new TokenRefusal('token_account_wide');
  } catch (error) {
    if (error instanceof TokenRefusal) throw error;
    if (error instanceof ProjectProviderError && error.kind === 'forbidden') {
      return { orgSlug, expiresAt, provider };
    }
    throw new TokenRefusal('unchecked');
  }
  return { orgSlug, expiresAt, provider };
}
