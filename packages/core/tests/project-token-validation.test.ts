import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProjectProvider } from '../server/projects/fake';
import { setProjectProviderForTests } from '../server/projects/provider-access';
import {
  SCOPED_TOKEN_PREFIX,
  TokenRefusal,
  todayInSaoPaulo,
  validateCustomerToken,
} from '../server/projects/token';
import { type ProjectProvider, ProjectProviderError } from '../server/projects/types';

/**
 * 09.4-07 Task 1 (D-569..D-572, CTK-09, CTK-10, CTK-12): the one registration validation. The order is fixed
 * (typed date, prefix, describe, listing) and every refusal is a single closed code and nothing else.
 */

const REF = 'alpha-ref';
const OTHER_REF = 'other-ref';
const TODAY = '2026-10-27';
const EXPIRY = '2026-12-31';

const GOOD = 'sbp_fc_fake_good_value_01';
const ALL = 'sbp_fc_fake_all_value_02';
const DEAD = 'sbp_fc_fake_dead_value_03';
const FORBIDDEN = 'sbp_fc_fake_forbidden_04';
const ELSEWHERE = 'sbp_fc_fake_elsewhere_05';
const PLAIN_PAT = 'sbp_0123456789abcdef0123456789abcdef01234567';

const target = (ref: string) => ({
  apiUrl: 'http://127.0.0.1:54321',
  databaseUrl: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  host: '127.0.0.1',
  port: 54322,
  dbName: 'postgres',
  ref,
});

function world(extra: Parameters<typeof createFakeProjectProvider>[0] = {}) {
  return createFakeProjectProvider({
    targets: { [REF]: target(REF), [OTHER_REF]: target(OTHER_REF) },
    orgSlug: 'acme',
    orgs: { [OTHER_REF]: 'other' },
    tokens: {
      [GOOD]: { refs: [REF] },
      [ALL]: { refs: 'all' },
      [DEAD]: { refs: [REF], state: 'dead' },
      [FORBIDDEN]: { refs: [REF], state: 'forbidden' },
      [ELSEWHERE]: { refs: [OTHER_REF] },
    },
    ...extra,
  });
}

afterEach(() => setProjectProviderForTests(undefined));

async function refusalOf(promise: Promise<unknown>): Promise<TokenRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TokenRefusal) return error;
    throw error;
  }
  throw new Error('expected a TokenRefusal, but the call resolved');
}

/** A request-token view of the fake, with `listProjects` replaced (the describe still goes to the fake). */
function withListing(
  fake: ReturnType<typeof world>,
  token: string,
  listProjects: ProjectProvider['listProjects'],
): ProjectProvider {
  return { ...fake.forToken(token), listProjects };
}

describe('the order of the checks', () => {
  it('a bad expiry date is refused as token_expiry_invalid before the prefix and before any provider call', async () => {
    const fake = world();
    setProjectProviderForTests(fake);
    const refusal = await refusalOf(
      validateCustomerToken({
        ref: REF,
        token: 'not-a-token',
        expiresAt: '2026-10-01',
        today: TODAY,
      }),
    );
    expect(refusal.code).toBe('token_expiry_invalid');
    expect(fake.calls.tokenUses).toEqual([]);
  });

  it('a token without the sbp_fc prefix is token_account_wide and no provider is ever built', async () => {
    const fake = world();
    setProjectProviderForTests(fake);
    for (const token of [PLAIN_PAT, 'sbp_xx_fake', '', ' sbp_fc_fake']) {
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token, expiresAt: null, today: TODAY }),
      );
      expect(refusal.code).toBe('token_account_wide');
    }
    expect(fake.calls.tokenUses).toEqual([]);
    expect(SCOPED_TOKEN_PREFIX).toBe('sbp_fc');
  });
});

describe('the describe check', () => {
  it('an unknown or dead token is token_invalid', async () => {
    setProjectProviderForTests(world());
    for (const token of ['sbp_fc_never_issued_value', DEAD]) {
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token, expiresAt: null, today: TODAY }),
      );
      expect(refusal.code).toBe('token_invalid');
    }
  });

  it('a token that is not scoped to the ref, or is forbidden, is token_forbidden', async () => {
    setProjectProviderForTests(world());
    for (const token of [ELSEWHERE, FORBIDDEN]) {
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token, expiresAt: null, today: TODAY }),
      );
      expect(refusal.code).toBe('token_forbidden');
    }
  });

  it('an unknown ref is not_found', async () => {
    setProjectProviderForTests(world());
    const refusal = await refusalOf(
      validateCustomerToken({ ref: 'nowhere-ref', token: ALL, expiresAt: null, today: TODAY }),
    );
    expect(refusal.code).toBe('not_found');
  });

  it('a timeout, a 5xx and a malformed ref are unchecked', async () => {
    const down = world({ failAt: { step: 'verify', times: 'always' } });
    setProjectProviderForTests(down);
    expect(
      (
        await refusalOf(
          validateCustomerToken({ ref: REF, token: GOOD, expiresAt: null, today: TODAY }),
        )
      ).code,
    ).toBe('unchecked');

    const fake = world();
    const timingOut: ProjectProvider = {
      ...fake.forToken(GOOD),
      describe: async () => {
        throw new ProjectProviderError('timeout', 0, undefined, true);
      },
    };
    expect(
      (
        await refusalOf(
          validateCustomerToken({
            ref: REF,
            token: GOOD,
            expiresAt: null,
            today: TODAY,
            provider: timingOut,
          }),
        )
      ).code,
    ).toBe('unchecked');

    setProjectProviderForTests(fake);
    expect(
      (
        await refusalOf(
          validateCustomerToken({ ref: 'X', token: GOOD, expiresAt: null, today: TODAY }),
        )
      ).code,
    ).toBe('unchecked');
  });
});

describe('the account-wide check (D-570)', () => {
  it('a project-scoped token whose listing holds only the target passes', async () => {
    const fake = world();
    setProjectProviderForTests(fake);
    const result = await validateCustomerToken({
      ref: REF,
      token: GOOD,
      expiresAt: EXPIRY,
      today: TODAY,
    });
    expect(result.orgSlug).toBe('acme');
    expect(result.expiresAt).toBe(EXPIRY);
    expect(typeof result.provider.describe).toBe('function');
    expect(fake.calls.tokenUses.every((use) => use.kind === 'customer')).toBe(true);
  });

  it('a token whose scope is all with two known refs is token_account_wide', async () => {
    setProjectProviderForTests(world());
    const refusal = await refusalOf(
      validateCustomerToken({ ref: REF, token: ALL, expiresAt: null, today: TODAY }),
    );
    expect(refusal.code).toBe('token_account_wide');
  });

  it('a listing that answers 403 passes: the token was refused the list, which is what a scoped token gets', async () => {
    const fake = world();
    const provider = withListing(fake, GOOD, async () => {
      throw new ProjectProviderError('forbidden', 403, 'token_forbidden', true);
    });
    const result = await validateCustomerToken({
      ref: REF,
      token: GOOD,
      expiresAt: null,
      today: TODAY,
      provider,
    });
    expect(result.orgSlug).toBe('acme');
  });

  it('a listing that times out or answers 5xx is unchecked', async () => {
    const fake = world();
    for (const error of [
      new ProjectProviderError('timeout', 0, undefined, true),
      new ProjectProviderError('unavailable', 503, undefined, true),
    ]) {
      const provider = withListing(fake, GOOD, async () => {
        throw error;
      });
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token: GOOD, expiresAt: null, today: TODAY, provider }),
      );
      expect(refusal.code).toBe('unchecked');
    }
  });

  it('a listing that names any ref other than the target is token_account_wide', async () => {
    const fake = world();
    const provider = withListing(fake, GOOD, async () => [{ ref: REF }, { ref: 'a-third-ref' }]);
    const refusal = await refusalOf(
      validateCustomerToken({ ref: REF, token: GOOD, expiresAt: null, today: TODAY, provider }),
    );
    expect(refusal.code).toBe('token_account_wide');
  });
});

describe('the organisation pin (D-571)', () => {
  it('with no pin, the first read teaches the organisation and returns it to be stored', async () => {
    setProjectProviderForTests(world());
    const learned = await validateCustomerToken({
      ref: OTHER_REF,
      token: ELSEWHERE,
      expiresAt: null,
      today: TODAY,
    });
    expect(learned.orgSlug).toBe('other');
  });

  it('with a pin that matches, the validation passes', async () => {
    setProjectProviderForTests(world());
    const result = await validateCustomerToken({
      ref: OTHER_REF,
      token: ELSEWHERE,
      expiresAt: null,
      orgSlug: 'other',
      today: TODAY,
    });
    expect(result.orgSlug).toBe('other');
  });

  it('with a pin that differs, the result is org_mismatch', async () => {
    setProjectProviderForTests(world());
    const refusal = await refusalOf(
      validateCustomerToken({
        ref: OTHER_REF,
        token: ELSEWHERE,
        expiresAt: null,
        orgSlug: 'acme',
        today: TODAY,
      }),
    );
    expect(refusal.code).toBe('org_mismatch');
  });
});

describe('the typed expiry date', () => {
  it('a past date, a date more than a year away and an impossible date are token_expiry_invalid before any provider call', async () => {
    const fake = world();
    setProjectProviderForTests(fake);
    for (const expiresAt of ['2026-10-26', TODAY, '2027-12-01', '2026-13-40', 'amanha']) {
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token: GOOD, expiresAt, today: TODAY }),
      );
      expect(refusal.code, expiresAt).toBe('token_expiry_invalid');
    }
    expect(fake.calls.tokenUses).toEqual([]);
  });

  it('null means the token has no expiry and is valid', async () => {
    setProjectProviderForTests(world());
    const result = await validateCustomerToken({
      ref: REF,
      token: GOOD,
      expiresAt: null,
      today: TODAY,
    });
    expect(result.expiresAt).toBeNull();
  });

  it('today is read in America/Sao_Paulo, the operator is in Brazil', () => {
    expect(todayInSaoPaulo(new Date('2026-10-27T03:00:00Z'))).toBe('2026-10-27');
    expect(todayInSaoPaulo(new Date('2026-10-27T02:59:59Z'))).toBe('2026-10-26');
    expect(todayInSaoPaulo(new Date('2026-10-28T02:30:00Z'))).toBe('2026-10-27');
  });
});

describe('what a refusal carries (T-09.4-24)', () => {
  it('the message is the code and nothing else, and no token or prefix is observable anywhere', async () => {
    setProjectProviderForTests(world());
    const tokens = [PLAIN_PAT, DEAD, ELSEWHERE, FORBIDDEN, 'sbp_fc_never_issued_value'];
    for (const token of tokens) {
      const refusal = await refusalOf(
        validateCustomerToken({ ref: REF, token, expiresAt: null, today: TODAY }),
      );
      expect(refusal.message).toBe(refusal.code);
      const seen = JSON.stringify([
        refusal.message,
        refusal.code,
        refusal.name,
        Object.getOwnPropertyNames(refusal).map((key) => String(Reflect.get(refusal, key))),
      ]);
      expect(seen).not.toContain(token);
      expect(seen).not.toContain(token.slice(0, 6));
      expect(String(refusal.stack)).not.toContain(token);
    }
  });

  it('a successful result does not carry the token either', async () => {
    setProjectProviderForTests(world());
    const result = await validateCustomerToken({
      ref: REF,
      token: GOOD,
      expiresAt: EXPIRY,
      today: TODAY,
    });
    const seen = JSON.stringify({ orgSlug: result.orgSlug, expiresAt: result.expiresAt });
    expect(seen).not.toContain(GOOD);
    expect(seen).not.toContain(GOOD.slice(0, 8));
  });
});
