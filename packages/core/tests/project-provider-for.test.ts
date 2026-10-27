import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProjectProvider } from '../server/projects/fake';
import { setProjectProviderForTests } from '../server/projects/provider-access';
import {
  createRequestTokenProvider,
  dropProjectProvider,
  getProjectProviderFor,
  PROVIDER_CACHE_MAX,
  type ProviderProject,
} from '../server/projects/provider-for';
import type { ProjectProvider } from '../server/projects/types';
import { seal } from '../server/secrets/sealed';

/**
 * 09.4-06 (D-566, D-571, D-573, CTK-22, CTK-23): which management token a call uses is a property of the
 * PROJECT. The resolver returns the platform provider for a platform project and, for a customer project, a
 * provider built from that project's own sealed token, cached by project and credential version.
 */

const REF = 'alpha-ref';
const TOKEN_A = 'sbp_fc_fake_a';
const TOKEN_B = 'sbp_fc_fake_b';

const target = (ref: string) => ({
  apiUrl: 'http://127.0.0.1:54321',
  databaseUrl: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  host: '127.0.0.1',
  port: 54322,
  dbName: 'postgres',
  ref,
});

function fakeWorld() {
  return createFakeProjectProvider({
    targets: { [REF]: target(REF) },
    orgSlug: 'acme',
    tokens: { [TOKEN_A]: { refs: 'all' }, [TOKEN_B]: { refs: 'all' } },
  });
}

function customer(id: string, token: string | null, credentialVersion = 1): ProviderProject {
  return {
    id,
    ref: REF,
    provider: 'fake',
    credentialVersion,
    owner: 'customer',
    orgSlug: 'acme',
    mgmtTokenSealed: token === null ? null : seal(token, `${id}:mgmt_token`),
  };
}

const platform = (id: string): ProviderProject => ({
  id,
  ref: REF,
  provider: 'fake',
  credentialVersion: 1,
  owner: 'platform',
  orgSlug: null,
  mgmtTokenSealed: null,
});

afterEach(() => setProjectProviderForTests(undefined));

describe('getProjectProviderFor (CTK-22, CTK-23)', () => {
  it('resolves a customer project to a view of the token it sealed, cached by project and version', async () => {
    const fake = fakeWorld();
    setProjectProviderForTests(fake);
    const project = customer('p-one', TOKEN_A);

    const first = await getProjectProviderFor(project);
    await first.describe(REF);
    expect(fake.calls.tokenUses).toEqual([{ ref: REF, kind: 'customer' }]);

    expect(await getProjectProviderFor(project)).toBe(first);
    const rotated = await getProjectProviderFor(customer('p-one', TOKEN_B, 2));
    expect(rotated).not.toBe(first);
  });

  it('a platform project gets exactly the override, never a customer view', async () => {
    const fake = fakeWorld();
    setProjectProviderForTests(fake);
    expect(await getProjectProviderFor(platform('p-platform'))).toBe(fake);
    // An owner that is absent is a platform project too (the existing callers pass no owner).
    const { owner: _owner, ...legacy } = platform('p-legacy');
    expect(await getProjectProviderFor(legacy)).toBe(fake);
  });

  it('a plain override (no token views) keeps winning for a customer project', async () => {
    const plain = { name: 'fake' } as unknown as ProjectProvider;
    setProjectProviderForTests(plain);
    expect(await getProjectProviderFor(customer('p-plain', TOKEN_A))).toBe(plain);
  });

  it('stays bounded: 80 customer projects evict the first, and the cache never exceeds the bound', async () => {
    expect(PROVIDER_CACHE_MAX).toBe(64);
    setProjectProviderForTests(fakeWorld());
    const kept = customer('p-keep', TOKEN_A);
    const firstView = await getProjectProviderFor(kept);
    for (let n = 0; n < 80; n += 1) await getProjectProviderFor(customer(`p-fill-${n}`, TOKEN_A));
    expect(await getProjectProviderFor(kept)).not.toBe(firstView);
  });

  it('dropProjectProvider removes every version of that project and no other', async () => {
    setProjectProviderForTests(fakeWorld());
    const a1 = await getProjectProviderFor(customer('p-drop-a', TOKEN_A, 1));
    const a2 = await getProjectProviderFor(customer('p-drop-a', TOKEN_A, 2));
    const b1 = await getProjectProviderFor(customer('p-drop-b', TOKEN_A, 1));
    dropProjectProvider('p-drop-a');
    expect(await getProjectProviderFor(customer('p-drop-a', TOKEN_A, 1))).not.toBe(a1);
    expect(await getProjectProviderFor(customer('p-drop-a', TOKEN_A, 2))).not.toBe(a2);
    expect(await getProjectProviderFor(customer('p-drop-b', TOKEN_A, 1))).toBe(b1);
  });

  it('never falls back to the platform provider: no sealed token throws, a wrong AAD is unreadable, neither names the token', async () => {
    const fake = fakeWorld();
    setProjectProviderForTests(fake);

    const none = await getProjectProviderFor(customer('p-none', null)).catch((e: unknown) => e);
    expect(none).toBeInstanceOf(Error);
    expect((none as Error).message).toBe('customer project has no sealed management token');

    const wrong: ProviderProject = {
      ...customer('p-wrong', TOKEN_A),
      mgmtTokenSealed: seal(TOKEN_A, 'another-id:mgmt_token'),
    };
    const unreadable = await getProjectProviderFor(wrong).catch((e: unknown) => e);
    expect((unreadable as Error).message).toBe('sealed value unreadable');
    for (const failure of [none, unreadable]) {
      expect(String((failure as Error).message)).not.toContain('sbp_');
    }
    expect(fake.calls.tokenUses).toEqual([]);
  });
});

describe('createRequestTokenProvider (before the project exists)', () => {
  it('builds an uncached provider on every call, learns the organisation, shares no state', async () => {
    const fake = fakeWorld();
    setProjectProviderForTests(fake);
    const one = await createRequestTokenProvider({ token: TOKEN_A });
    const two = await createRequestTokenProvider({ token: TOKEN_A });
    expect(one).not.toBe(two);

    await expect(one.describe(REF)).resolves.toMatchObject({ ref: REF });
    await expect(two.describe(REF)).resolves.toMatchObject({ ref: REF });
    expect(fake.calls.tokenUses.every((use) => use.kind === 'customer')).toBe(true);
  });

  it('an unknown token surfaces token_invalid from the first call', async () => {
    setProjectProviderForTests(fakeWorld());
    const view = await createRequestTokenProvider({ token: 'sbp_fc_fake_stranger' });
    await expect(view.describe(REF)).rejects.toMatchObject({ code: 'token_invalid' });
  });
});
