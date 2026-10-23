import { Webhook } from 'standardwebhooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildActionLink,
  HookPayloadError,
  HookSignatureError,
  parseHookSecrets,
  verifyHookRequest,
} from '../server/mail/hook-schema';
import {
  HOOK_PROJECT_CACHE_MAX,
  HOOK_PROJECT_NEGATIVE_TTL_MS,
  HOOK_PROJECT_TTL_MS,
  hookProjectCacheSize,
  hookSecretsFor,
  invalidateHookProject,
  resolveHookProject,
} from '../server/mail/project-hook';

// The registry read and the sealed-secret opener are replaced: this file never touches a database or a keyring.
const registry = vi.hoisted(() => ({
  reads: [] as string[],
  answer: null as { id: string; hookRef: string } | null,
}));
vi.mock('../db/platform-tx', () => ({
  withPlatformTx: async () => {
    registry.reads.push('read');
    return registry.answer ? [registry.answer] : [];
  },
}));
vi.mock('../server/secrets/sealed', () => ({
  open: (sealed: string, aad: string) => `v1,whsec_${sealed}|${aad.length}`,
}));

/**
 * Send Email Hook signature and payload handling (T-02-21, T-02-26). Test payloads are signed with
 * the real `standardwebhooks` signer, so this suite pins the wire format GoTrue produces.
 */

const SECRET_A = Buffer.from('unit-test-hook-secret-aaaaaaaaaaaaaa').toString('base64');
const SECRET_B = Buffer.from('unit-test-hook-secret-bbbbbbbbbbbbbb').toString('base64');

const PAYLOAD = JSON.stringify({
  user: { id: '3f4c0d5e-2a6b-4b1c-9d8e-7f6a5b4c3d2e', email: 'm@x.example' },
  email_data: {
    token: '123456',
    token_hash: 'abc',
    redirect_to: 'http://h:3000/auth/confirm?next=/redefinir-senha',
    email_action_type: 'recovery',
    site_url: 'http://localhost:3000',
    token_new: '',
    token_hash_new: '',
  },
});

function sign(secret: string, raw: string, at = new Date(), id = 'msg_1') {
  const timestamp = new Date(at);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': new Webhook(secret).sign(id, timestamp, raw),
  };
}

describe('parseHookSecrets', () => {
  it('accepts both rotation spellings and yields the bare base64 list', () => {
    expect(parseHookSecrets('v1,whsec_A|v1,whsec_B')).toEqual(['A', 'B']);
    expect(parseHookSecrets('v1,whsec_A|B')).toEqual(['A', 'B']);
    expect(parseHookSecrets('v1,whsec_A')).toEqual(['A']);
  });

  it('yields an empty list for unset or empty input', () => {
    expect(parseHookSecrets(undefined)).toEqual([]);
    expect(parseHookSecrets('')).toEqual([]);
    expect(parseHookSecrets('|')).toEqual([]);
  });
});

describe('verifyHookRequest', () => {
  it('accepts a payload signed with the FIRST secret and returns the parsed payload', () => {
    const payload = verifyHookRequest(PAYLOAD, sign(SECRET_A, PAYLOAD), [SECRET_A, SECRET_B]);
    expect(payload.user.email).toBe('m@x.example');
    expect(payload.email_data.email_action_type).toBe('recovery');
  });

  it('accepts a payload signed with the SECOND secret (rotation)', () => {
    const payload = verifyHookRequest(PAYLOAD, sign(SECRET_B, PAYLOAD), [SECRET_A, SECRET_B]);
    expect(payload.email_data.token_hash).toBe('abc');
  });

  it('rejects a wrong secret', () => {
    const wrong = Buffer.from('unit-test-hook-secret-cccccccccccccc').toString('base64');
    expect(() => verifyHookRequest(PAYLOAD, sign(wrong, PAYLOAD), [SECRET_A, SECRET_B])).toThrow(
      HookSignatureError,
    );
  });

  it('rejects a body altered after signing', () => {
    const headers = sign(SECRET_A, PAYLOAD);
    const altered = PAYLOAD.replace('"recovery"', '"invite"');
    expect(() => verifyHookRequest(altered, headers, [SECRET_A])).toThrow(HookSignatureError);
  });

  it('rejects a webhook-timestamp ten minutes old', () => {
    const stale = sign(SECRET_A, PAYLOAD, new Date(Date.now() - 10 * 60_000));
    expect(() => verifyHookRequest(PAYLOAD, stale, [SECRET_A])).toThrow(HookSignatureError);
  });

  it('fails closed on an empty secret list and on missing headers', () => {
    expect(() => verifyHookRequest(PAYLOAD, sign(SECRET_A, PAYLOAD), [])).toThrow(
      HookSignatureError,
    );
    const { 'webhook-signature': _drop, ...partial } = sign(SECRET_A, PAYLOAD);
    expect(() => verifyHookRequest(PAYLOAD, partial, [SECRET_A])).toThrow(HookSignatureError);
  });

  it('turns a verified body that is not a hook payload into HookPayloadError', () => {
    const raw = JSON.stringify({ hello: 'world' });
    expect(() => verifyHookRequest(raw, sign(SECRET_A, raw), [SECRET_A])).toThrow(HookPayloadError);
    const notJson = 'not json';
    expect(() => verifyHookRequest(notJson, sign(SECRET_A, notJson), [SECRET_A])).toThrow(
      HookPayloadError,
    );
  });
});

describe('buildActionLink', () => {
  it('keeps redirect_to verbatim (its next=/… included) and appends token_hash and type', () => {
    expect(
      buildActionLink('http://h:3000/auth/confirm?next=/redefinir-senha', 'abc', 'recovery'),
    ).toBe('http://h:3000/auth/confirm?next=/redefinir-senha&token_hash=abc&type=recovery');
    expect(buildActionLink('https://h/auth/confirm', 'a b', 'invite')).toBe(
      'https://h/auth/confirm?token_hash=a%20b&type=invite',
    );
  });

  it('refuses a redirect_to that is not a URL', () => {
    expect(() => buildActionLink('not a url', 'abc', 'recovery')).toThrow(HookPayloadError);
  });
});

const REF = 'AbCdEfGhIjKlMnOpQrSt_-';

describe('resolveHookProject (09.2-11, DBT-14, P26/P27)', () => {
  beforeEach(() => {
    registry.reads.length = 0;
    registry.answer = null;
    invalidateHookProject();
  });

  it('answers null WITHOUT a query for anything that cannot be a reference', async () => {
    for (const bad of [
      undefined,
      '',
      REF.slice(0, 21),
      `${REF}x`,
      `${REF.slice(0, 21)}=`,
      `${REF.slice(0, 21)}.`,
      ' '.repeat(22),
      'é'.repeat(22),
    ]) {
      expect(await resolveHookProject(bad)).toBeNull();
    }
    expect(registry.reads).toHaveLength(0);
  });

  it('reads the registry once for a well-formed reference and remembers a hit', async () => {
    registry.answer = { id: 'p1', hookRef: REF };
    expect((await resolveHookProject(REF))?.id).toBe('p1');
    expect((await resolveHookProject(REF))?.id).toBe('p1');
    expect(registry.reads).toHaveLength(1);
  });

  it('remembers a miss too, and a later row is found after the cache is dropped', async () => {
    expect(await resolveHookProject(REF)).toBeNull();
    expect(await resolveHookProject(REF)).toBeNull();
    expect(registry.reads).toHaveLength(1);
    registry.answer = { id: 'p1', hookRef: REF };
    invalidateHookProject(REF);
    expect((await resolveHookProject(REF))?.id).toBe('p1');
  });

  it('keeps positive answers for 5 minutes and negative ones for 30 seconds', async () => {
    expect(HOOK_PROJECT_TTL_MS).toBe(300_000);
    expect(HOOK_PROJECT_NEGATIVE_TTL_MS).toBe(30_000);
    vi.useFakeTimers();
    try {
      expect(await resolveHookProject(REF)).toBeNull();
      vi.advanceTimersByTime(HOOK_PROJECT_NEGATIVE_TTL_MS - 1);
      await resolveHookProject(REF);
      expect(registry.reads).toHaveLength(1);
      vi.advanceTimersByTime(2);
      await resolveHookProject(REF);
      expect(registry.reads).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is bounded at 1,000 remembered references however many are asked about', async () => {
    expect(HOOK_PROJECT_CACHE_MAX).toBe(1_000);
    for (let n = 0; n < HOOK_PROJECT_CACHE_MAX + 50; n += 1) {
      await resolveHookProject(`ref-${String(n).padStart(18, '0')}`);
    }
    expect(hookProjectCacheSize()).toBe(HOOK_PROJECT_CACHE_MAX);
  });
});

describe('hookSecretsFor (09.2-11, P27/P28)', () => {
  it('yields no secret for a project that has none, which verifies nothing', () => {
    expect(hookSecretsFor({ id: 'p1', hookSecretSealed: null })).toEqual([]);
    expect(() =>
      verifyHookRequest(
        PAYLOAD,
        sign(SECRET_A, PAYLOAD),
        hookSecretsFor({ id: 'p1', hookSecretSealed: null }),
      ),
    ).toThrow(HookSignatureError);
  });

  it('opens the sealed column with the project id as part of the AAD and keeps stored order', () => {
    const secrets = hookSecretsFor({ id: 'p1', hookSecretSealed: 'x' });
    // The stub opens to `v1,whsec_x|<aad length>`: two entries, the second is `p1:hook_secret`'s length.
    expect(secrets).toEqual(['x', String('p1:hook_secret'.length)]);
  });
});
