import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeProjectProvider, type FakeTarget } from '../server/projects/fake';
import { ProjectProviderError } from '../server/projects/types';

/**
 * 09.2-12 (DBT-37, D-540, P74): the fake project provider needs no network, keeps all its state per
 * instance, and offers the seams plan 13's bootstrap tests use: `COMING_UP` polls, recorded PATCH bodies,
 * `failAt` once or always.
 */

const target = (name: string): FakeTarget => ({
  apiUrl: `http://127.0.0.1:54321/${name}`,
  host: '127.0.0.1',
  port: 54322,
  dbName: name,
});

const A = 'tenant-a';
const B = 'tenant-b';
const targets = { [A]: target(A), [B]: target(B), 'paused-tenant': target('paused') };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fake project provider: polls and health', () => {
  it('answers COMING_UP for exactly the first K polls of a ref, then ACTIVE_HEALTHY', async () => {
    const fake = createFakeProjectProvider({ targets, comingUpPolls: 3 });
    const statuses: string[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await fake.describe(A)).status);
    expect(statuses).toEqual([
      'COMING_UP',
      'COMING_UP',
      'COMING_UP',
      'ACTIVE_HEALTHY',
      'ACTIVE_HEALTHY',
      'ACTIVE_HEALTHY',
    ]);
    expect(fake.calls.describes[A]).toBe(6);
  });

  it('reports auth COMING_UP (db already healthy) while the project is coming up, all healthy after', async () => {
    const fake = createFakeProjectProvider({ targets, comingUpPolls: 1 });
    await fake.describe(A);
    const during = await fake.health(A);
    expect(during.services.db).toBe('ACTIVE_HEALTHY');
    expect(during.services.auth).toBe('COMING_UP');
    await fake.describe(A);
    const after = await fake.health(A);
    expect(Object.values(after.services).every((s) => s === 'ACTIVE_HEALTHY')).toBe(true);
  });

  it('waitUntilHealthy polls through the COMING_UP answers with growing delays and then resolves', async () => {
    const sleeps: number[] = [];
    const fake = createFakeProjectProvider({
      targets,
      comingUpPolls: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await fake.waitUntilHealthy(A);
    expect(sleeps).toEqual([2_000, 4_000, 8_000]);
  });

  it('a ref containing "paused" is INACTIVE and waitUntilHealthy fails as paused (invalid)', async () => {
    const fake = createFakeProjectProvider({ targets });
    expect((await fake.describe('paused-tenant')).status).toBe('INACTIVE');
    await expect(fake.waitUntilHealthy('paused-tenant')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('an unknown ref is not_found, a malformed ref is invalid, neither touches a counter', async () => {
    const fake = createFakeProjectProvider({ targets });
    await expect(fake.describe('nope-nope')).rejects.toMatchObject({
      kind: 'not_found',
      status: 404,
    });
    await expect(fake.listApiKeys('nope-nope')).rejects.toMatchObject({ kind: 'not_found' });
    for (const bad of ['', 'A', '../x', 'a b', 'x'.repeat(41)]) {
      await expect(fake.describe(bad)).rejects.toMatchObject({ kind: 'invalid', status: 0 });
    }
    expect(fake.calls.describes).toEqual({});
  });
});

describe('fake project provider: isolation (P74)', () => {
  it('two instances share nothing: counters, configurations, recorded calls and failure switches', async () => {
    const one = createFakeProjectProvider({
      targets,
      comingUpPolls: 2,
      failAt: { step: 'auth', times: 'always' },
    });
    const two = createFakeProjectProvider({ targets, comingUpPolls: 2 });
    await one.describe(A);
    await one.describe(A);
    // `two` is untouched by `one`'s polls: its first poll is still COMING_UP.
    expect((await two.describe(A)).status).toBe('COMING_UP');
    expect((await one.describe(A)).status).toBe('ACTIVE_HEALTHY');
    await expect(
      one.patchAuthConfig(A, { site_url: 'https://one.example' }),
    ).rejects.toBeInstanceOf(ProjectProviderError);
    await two.patchAuthConfig(A, { site_url: 'https://two.example' });
    expect(one.calls.patches[A]).toBeUndefined();
    expect(two.calls.patches[A]).toHaveLength(1);
    expect((await createFakeProjectProvider({ targets }).getAuthConfig(A)).site_url).toBe(
      'http://localhost:3000',
    );
  });

  it('parallel calls on one instance for different refs never disturb each other', async () => {
    const fake = createFakeProjectProvider({ targets, comingUpPolls: 2 });
    const [a1, b1, a2, b2, a3, b3] = await Promise.all([
      fake.describe(A),
      fake.describe(B),
      fake.describe(A),
      fake.describe(B),
      fake.describe(A),
      fake.describe(B),
    ]);
    expect([a1, a2, a3].map((d) => d.status)).toEqual(['COMING_UP', 'COMING_UP', 'ACTIVE_HEALTHY']);
    expect([b1, b2, b3].map((d) => d.status)).toEqual(['COMING_UP', 'COMING_UP', 'ACTIVE_HEALTHY']);
    expect(fake.calls.describes).toEqual({ [A]: 3, [B]: 3 });
  });
});

describe('fake project provider: failAt', () => {
  it('fails the matching provider calls ONCE, then succeeds (resume)', async () => {
    const fake = createFakeProjectProvider({ targets, failAt: { step: 'auth', times: 1 } });
    const failure = (await fake
      .patchAuthConfig(A, { site_url: 'https://x.example' })
      .catch((e: unknown) => e)) as ProjectProviderError;
    expect(failure).toBeInstanceOf(ProjectProviderError);
    expect(failure).toMatchObject({ kind: 'unavailable', status: 500, message: 'unavailable 500' });
    await expect(
      fake.patchAuthConfig(A, { site_url: 'https://x.example' }),
    ).resolves.toBeUndefined();
    await expect(fake.getAuthConfig(A)).resolves.toBeDefined();
    expect(fake.calls.patches[A]).toHaveLength(1);
  });

  it("fails 'always' on every matching call and only on the armed step", async () => {
    const fake = createFakeProjectProvider({
      targets,
      failAt: { step: 'realtime', times: 'always' },
    });
    for (let i = 0; i < 3; i += 1) {
      await expect(fake.patchRealtime(A, { private_only: true })).rejects.toMatchObject({
        kind: 'unavailable',
      });
    }
    await expect(fake.getRealtimeConfig(A)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(fake.patchStorage(A, { fileSizeLimit: 1 })).resolves.toBeUndefined();
    await expect(fake.describe(A)).resolves.toBeDefined();
  });

  it('maps each step to its provider calls: verify, schema, buckets', async () => {
    const verify = createFakeProjectProvider({ targets, failAt: { step: 'verify', times: 1 } });
    await expect(verify.describe(A)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(verify.describe(A)).resolves.toBeDefined();

    const schema = createFakeProjectProvider({ targets, failAt: { step: 'schema', times: 1 } });
    await expect(schema.patchPostgrest(A, { db_schema: 'data_api_closed' })).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(
      schema.patchPostgrest(A, { db_schema: 'data_api_closed' }),
    ).resolves.toBeUndefined();

    const buckets = createFakeProjectProvider({ targets, failAt: { step: 'buckets', times: 1 } });
    await expect(buckets.listBuckets(A)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(buckets.listBuckets(A)).resolves.toEqual([]);
  });

  it('failpoint() lets the bootstrap fail the steps that are not provider calls (roles, tenant, invite)', () => {
    const fake = createFakeProjectProvider({
      targets,
      failAt: [
        { step: 'roles', times: 1 },
        { step: 'invite', times: 'always' },
      ],
    });
    expect(() => fake.failpoint('roles')).toThrow(ProjectProviderError);
    expect(() => fake.failpoint('roles')).not.toThrow();
    expect(() => fake.failpoint('tenant')).not.toThrow();
    expect(() => fake.failpoint('invite')).toThrow(ProjectProviderError);
    expect(() => fake.failpoint('invite')).toThrow(ProjectProviderError);
    fake.arm({ step: 'tenant', times: 1 });
    expect(() => fake.failpoint('tenant')).toThrow();
    expect(fake.calls.failpoints).toEqual([
      'roles',
      'roles',
      'tenant',
      'invite',
      'invite',
      'tenant',
    ]);
  });
});

describe('fake project provider: recorded writes and deterministic answers', () => {
  it('records every PATCH body verbatim and read-backs the merged configuration', async () => {
    const fake = createFakeProjectProvider({ targets });
    const authBody = {
      site_url: 'https://c.example',
      hook_send_email_enabled: false,
      hook_custom_access_token_uri:
        'pg-functions://postgres/public/hook_custom_access_token_allowlist',
      smtp_pass: 'p@ss',
    };
    await fake.patchAuthConfig(A, authBody);
    authBody.site_url = 'mutated-after-the-call';
    await fake.patchPostgrest(A, {
      db_schema: 'data_api_closed',
      db_extra_search_path: 'extensions',
    });
    await fake.patchStorage(A, { fileSizeLimit: 52_428_800 });
    await fake.patchRealtime(A, { private_only: true });
    expect(fake.calls.patches[A]).toEqual([
      {
        target: 'auth',
        body: {
          site_url: 'https://c.example',
          hook_send_email_enabled: false,
          hook_custom_access_token_uri:
            'pg-functions://postgres/public/hook_custom_access_token_allowlist',
          smtp_pass: 'p@ss',
        },
      },
      {
        target: 'postgrest',
        body: { db_schema: 'data_api_closed', db_extra_search_path: 'extensions' },
      },
      { target: 'storage', body: { fileSizeLimit: 52_428_800 } },
      { target: 'realtime', body: { private_only: true } },
    ]);
    expect((await fake.getAuthConfig(A)).site_url).toBe('https://c.example');
    expect((await fake.getPostgrestConfig(A)).db_schema).toBe('data_api_closed');
    expect((await fake.getRealtimeConfig(A)).private_only).toBe(true);
    await expect(fake.patchAuthConfig(A, {})).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('signing keys: none at first, created standby, moved to in_use, the previous in_use becomes previously_used', async () => {
    const fake = createFakeProjectProvider({ targets });
    expect(await fake.signingKeys(A)).toEqual([]);
    const first = await fake.createSigningKey(A);
    expect(first).toMatchObject({ algorithm: 'ES256', status: 'standby' });
    await fake.patchSigningKey(A, first.id, 'in_use');
    const second = await fake.createSigningKey(A);
    expect(second.id).not.toBe(first.id);
    await fake.patchSigningKey(A, second.id, 'in_use');
    const statuses = Object.fromEntries((await fake.signingKeys(A)).map((k) => [k.id, k.status]));
    expect(statuses).toEqual({ [first.id]: 'previously_used', [second.id]: 'in_use' });
    await expect(fake.patchSigningKey(A, 'missing', 'in_use')).rejects.toMatchObject({
      kind: 'not_found',
    });
  });

  it('keys are deterministic per ref and flagged fake; the pooler is the local target with plain role names', async () => {
    const fake = createFakeProjectProvider({ targets });
    const first = await fake.ensureKeys(A);
    const again = await fake.ensureKeys(A);
    expect(again).toEqual(first);
    expect(first.publishable).toMatchObject({
      kind: 'publishable',
      value: `fake_publishable_${A}`,
      fake: true,
    });
    expect(first.service).toMatchObject({ kind: 'secret', value: `fake_secret_${A}`, fake: true });
    expect((await fake.ensureKeys(B)).service.value).toBe(`fake_secret_${B}`);
    expect(fake.calls.ensureKeys[A]).toBe(2);
    const pooler = await fake.poolerConfig(A);
    expect(pooler).toMatchObject({
      host: '127.0.0.1',
      txPort: 54322,
      sessionPort: 54322,
      dbName: A,
    });
    expect(pooler.userFor('api_user')).toBe('api_user');
  });

  it('records the database password it was given; a short one is invalid', async () => {
    const fake = createFakeProjectProvider({ targets });
    await expect(fake.setDatabasePassword(A, 'short')).rejects.toMatchObject({ kind: 'invalid' });
    await fake.setDatabasePassword(A, 'a-generated-32-byte-password-value');
    expect(fake.calls.passwords).toEqual([
      { ref: A, password: 'a-generated-32-byte-password-value' },
    ]);
  });

  it('lists the migrations and buckets of the target, and answers the read-only query with null when there is no database', async () => {
    const fake = createFakeProjectProvider({
      targets: {
        [A]: {
          ...target(A),
          migrations: [{ version: '1', name: 'init' }],
          buckets: [{ id: 'media', name: 'media', public: false }],
        },
        [B]: target(B),
      },
    });
    expect(await fake.listMigrations(A)).toEqual([{ version: '1', name: 'init' }]);
    expect(await fake.listBuckets(A)).toEqual([{ id: 'media', name: 'media', public: false }]);
    expect(await fake.listMigrations(B)).toEqual([]);
    expect(await fake.readOnlyQuery(B, 'select 1')).toBeNull();
    expect(await fake.readOnlyQuery('nope-nope', 'select 1')).toBeNull();
  });

  it('performs no network call across a whole bootstrap-shaped flow', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const fake = createFakeProjectProvider({ targets, comingUpPolls: 2 });
    await fake.waitUntilHealthy(A);
    await fake.ensureKeys(A);
    await fake.poolerConfig(A);
    await fake.setDatabasePassword(A, 'a-generated-32-byte-password-value');
    await fake.patchAuthConfig(A, { site_url: 'https://c.example' });
    await fake.patchPostgrest(A, { db_schema: 'data_api_closed' });
    await fake.patchStorage(A, { fileSizeLimit: 1 });
    await fake.patchRealtime(A, { private_only: true });
    await fake.createSigningKey(A);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fake project provider: customer tokens (09.4-05, CTK-30)', () => {
  const ALPHA = 'alpha-ref';
  const BETA = 'beta-ref';
  const TOKEN = 'sbp_fc_fake_a';
  const both = { [ALPHA]: target(ALPHA), [BETA]: target(BETA) };

  it('an unknown token is token_invalid on every method; a ref outside the scope is token_forbidden', async () => {
    const fake = createFakeProjectProvider({
      targets: both,
      tokens: { [TOKEN]: { refs: [ALPHA] } },
    });
    const stranger = fake.forToken('sbp_fc_fake_unknown');
    const expected = { kind: 'forbidden', status: 401, code: 'token_invalid', customerToken: true };
    await expect(stranger.describe(ALPHA)).rejects.toMatchObject(expected);
    await expect(stranger.health(ALPHA)).rejects.toMatchObject(expected);
    await expect(stranger.listApiKeys(ALPHA)).rejects.toMatchObject(expected);
    await expect(stranger.listProjects()).rejects.toMatchObject(expected);

    const view = fake.forToken(TOKEN);
    await expect(view.describe(ALPHA)).resolves.toMatchObject({ ref: ALPHA });
    await expect(view.describe(BETA)).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
      code: 'token_forbidden',
      customerToken: true,
    });
    await expect(view.listApiKeys(BETA)).rejects.toMatchObject({ code: 'token_forbidden' });
    const failure = (await view.describe(BETA).catch((e: unknown) => e)) as ProjectProviderError;
    expect(failure.message).toBe('forbidden 403');
    expect(JSON.stringify({ ...failure, message: failure.message })).not.toContain('sbp_');
  });

  it('learns the organisation like the real adapter and pins it', async () => {
    const orgs = { [ALPHA]: 'acme', [BETA]: 'other' };
    const fake = createFakeProjectProvider({
      targets: both,
      orgs,
      tokens: { [TOKEN]: { refs: 'all' } },
    });
    const learning = fake.forToken(TOKEN);
    await expect(learning.describe(ALPHA)).resolves.toMatchObject({ orgSlug: 'acme' });
    await expect(learning.describe(BETA)).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
      code: 'org_mismatch',
      customerToken: true,
    });
    // The pin also covers the reads of secrets.
    await expect(learning.ensureKeys(BETA)).rejects.toMatchObject({ code: 'org_mismatch' });

    const pinned = fake.forToken(TOKEN, { orgSlug: 'acme' });
    await expect(pinned.describe(BETA)).rejects.toMatchObject({ code: 'org_mismatch' });
    // The platform fake does not pin: its describe answers the ref's organisation.
    await expect(fake.describe(BETA)).resolves.toMatchObject({ orgSlug: 'other' });
  });

  it('setTokenState makes the next call token_invalid or token_forbidden; the base fake is unaffected', async () => {
    const fake = createFakeProjectProvider({
      targets: both,
      tokens: { [TOKEN]: { refs: 'all' } },
    });
    const view = fake.forToken(TOKEN);
    await expect(view.describe(ALPHA)).resolves.toBeDefined();
    fake.setTokenState(TOKEN, 'dead');
    await expect(view.describe(ALPHA)).rejects.toMatchObject({
      status: 401,
      code: 'token_invalid',
    });
    fake.setTokenState(TOKEN, 'forbidden');
    await expect(view.describe(ALPHA)).rejects.toMatchObject({
      status: 403,
      code: 'token_forbidden',
    });
    fake.setTokenState(TOKEN, 'ok');
    await expect(view.describe(ALPHA)).resolves.toBeDefined();
    fake.setTokenState(TOKEN, 'dead');
    await expect(fake.describe(ALPHA)).resolves.toBeDefined();
  });

  it('listProjects returns the refs in the token scope, and every target for the platform fake and for all', async () => {
    const fake = createFakeProjectProvider({
      targets: both,
      tokens: { one: { refs: [ALPHA] }, everything: { refs: 'all' } },
    });
    await expect(fake.forToken('one').listProjects()).resolves.toEqual([{ ref: ALPHA }]);
    await expect(fake.forToken('everything').listProjects()).resolves.toEqual([
      { ref: ALPHA },
      { ref: BETA },
    ]);
    await expect(fake.listProjects()).resolves.toEqual([{ ref: ALPHA }, { ref: BETA }]);
  });

  it('records the token kind of every call that names a ref', async () => {
    const fake = createFakeProjectProvider({
      targets: both,
      tokens: { [TOKEN]: { refs: [ALPHA] } },
    });
    await fake.describe(BETA);
    await fake.ensureKeys(BETA);
    const view = fake.forToken(TOKEN);
    await view.describe(ALPHA);
    await view.listApiKeys(ALPHA);
    await view.describe(BETA).catch(() => undefined);
    await view.listProjects();
    expect(fake.calls.tokenUses).toEqual([
      { ref: BETA, kind: 'platform' },
      { ref: BETA, kind: 'platform' },
      { ref: ALPHA, kind: 'customer' },
      { ref: ALPHA, kind: 'customer' },
      { ref: BETA, kind: 'customer' },
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain(TOKEN);
  });

  it('the view shares one world with the base fake: polls, recorded writes and failAt', async () => {
    const fake = createFakeProjectProvider({
      targets: both,
      comingUpPolls: 1,
      tokens: { [TOKEN]: { refs: 'all' } },
      failAt: { step: 'auth', times: 1 },
    });
    const view = fake.forToken(TOKEN);
    expect((await view.describe(ALPHA)).status).toBe('COMING_UP');
    expect((await fake.describe(ALPHA)).status).toBe('ACTIVE_HEALTHY');
    await expect(
      view.patchAuthConfig(ALPHA, { site_url: 'https://x.example' }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await view.patchAuthConfig(ALPHA, { site_url: 'https://x.example' });
    expect(fake.calls.patches[ALPHA]).toEqual([
      { target: 'auth', body: { site_url: 'https://x.example' } },
    ]);
  });
});
