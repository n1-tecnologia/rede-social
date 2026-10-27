import { describe, expect, it } from 'vitest';
import * as allowLists from '../server/domains/auth-allow-list';
import {
  createLocalAuthAllowList,
  createSupabaseAuthAllowList,
  localAllowListByProject,
  localAllowListEntries,
} from '../server/domains/auth-allow-list';
import * as domains from '../server/domains/index';
import { authAllowListFor } from '../server/domains/index';
import { allowListEntry } from '../server/domains/types';
import { createFakeProjectProvider } from '../server/projects/fake';
import { setProjectProviderForTests } from '../server/projects/provider-access';
import { type ProjectProvider, ProjectProviderError } from '../server/projects/types';
import { seal } from '../server/secrets/sealed';

/**
 * Auth redirect allow-list writers (D-34, docs/DEPLOY.md WR-09, T-02-53): the local ledger and the
 * Supabase Management API read-modify-write of `uri_allow_list`, proven against a recording fetch.
 * The adapter must add exactly one `https://<host>/auth/confirm**` entry, preserve everything else
 * in order, PATCH only when the set changed, and refuse to write anything that is not a per-domain
 * confirm path.
 */

const PAT = 'sbp_SECRET-personal-access-token';
const REF = 'abcdefghijklmnopqrst';
const PATH = `/v1/projects/${REF}/config/auth`;
const ENTRY_RE = /^https:\/\/[a-z0-9.-]+\/auth\/confirm\*\*$/;

type Call = { method: string; url: URL; headers: Headers; body: unknown; redirect?: string };

function stub(initial: string | null, patchStatus = 200) {
  const calls: Call[] = [];
  let current = initial;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({
      method,
      url,
      headers: new Headers(init?.headers),
      body,
      redirect: init?.redirect,
    });
    if (url.pathname !== PATH) return new Response('{}', { status: 404 });
    if (method === 'GET') {
      return new Response(JSON.stringify({ uri_allow_list: current, site_url: 'x' }), {
        status: 200,
      });
    }
    if (method === 'PATCH') {
      if (patchStatus !== 200) {
        return new Response(JSON.stringify({ message: `nope ${PAT}` }), { status: patchStatus });
      }
      current = (body as { uri_allow_list: string }).uri_allow_list;
      return new Response(JSON.stringify({ uri_allow_list: current }), { status: 200 });
    }
    return new Response('{}', { status: 405 });
  };
  return { calls, fetchImpl, value: () => current };
}

const list = (fetchImpl: typeof fetch) =>
  createSupabaseAuthAllowList({ pat: PAT, projectRef: REF, fetchImpl });

describe('allowListEntry', () => {
  it('is the exact-host confirm path and nothing else', () => {
    expect(allowListEntry('comunidade.cliente.com.br')).toBe(
      'https://comunidade.cliente.com.br/auth/confirm**',
    );
    expect(allowListEntry('comunidade.cliente.com.br')).toMatch(ENTRY_RE);
  });
});

describe('createLocalAuthAllowList', () => {
  it('records and forgets entries in the in-memory ledger, idempotently', async () => {
    const local = createLocalAuthAllowList();
    expect(local.name).toBe('local');
    await local.add('a.example');
    await local.add('a.example');
    expect(localAllowListEntries.has('https://a.example/auth/confirm**')).toBe(true);
    await local.remove('a.example');
    await local.remove('a.example');
    expect(localAllowListEntries.has('https://a.example/auth/confirm**')).toBe(false);
  });
});

describe('createSupabaseAuthAllowList', () => {
  it('add: GET then PATCH the same path with every existing entry kept and the new one, written sorted', async () => {
    const { calls, fetchImpl, value } = stub(
      'https://app.example/**,https://old.example/auth/confirm**',
    );
    const adapter = list(fetchImpl);
    expect(adapter.name).toBe('supabase');
    await adapter.add('h.example');

    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `GET ${PATH}`,
      `PATCH ${PATH}`,
    ]);
    expect(calls[0]?.url.origin).toBe('https://api.supabase.com');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${PAT}`);
    expect(calls[0]?.redirect).toBe('error');
    expect(calls[1]?.headers.get('content-type')).toBe('application/json');
    expect(calls[1]?.body).toEqual({
      uri_allow_list:
        'https://app.example/**,https://h.example/auth/confirm**,https://old.example/auth/confirm**',
    });
    expect(value()).toContain('https://h.example/auth/confirm**');
  });

  it('add of an already-present entry performs no PATCH; an empty/null list becomes the single entry', async () => {
    const present = stub('https://h.example/auth/confirm**, https://x.example/**');
    await list(present.fetchImpl).add('h.example');
    expect(present.calls.map((c) => c.method)).toEqual(['GET']);

    const empty = stub(null);
    await list(empty.fetchImpl).add('h.example');
    expect(empty.calls[1]?.body).toEqual({ uri_allow_list: 'https://h.example/auth/confirm**' });
  });

  it('remove drops exactly that entry and nothing else; removing an absent entry performs no PATCH', async () => {
    const { calls, fetchImpl } = stub(
      'https://a.example/auth/confirm**,https://h.example/auth/confirm**,https://h.example/**',
    );
    await list(fetchImpl).remove('h.example');
    expect(calls[1]?.method).toBe('PATCH');
    expect(calls[1]?.body).toEqual({
      uri_allow_list: 'https://a.example/auth/confirm**,https://h.example/**',
    });

    const absent = stub('https://a.example/auth/confirm**');
    await list(absent.fetchImpl).remove('h.example');
    expect(absent.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('never emits an entry that is not an exact-host confirm path (wildcard refusal, no PATCH)', async () => {
    for (const host of ['*.example', '**', 'a.example/**', 'A.EXAMPLE', '']) {
      const { calls, fetchImpl } = stub('https://a.example/auth/confirm**');
      await expect(list(fetchImpl).add(host)).rejects.toThrow();
      expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    }
  });

  it('a failed PATCH surfaces the status only — never the PAT or the body', async () => {
    const { fetchImpl } = stub('', 403);
    let caught: unknown;
    try {
      await list(fetchImpl).add('h.example');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('403');
    expect((caught as Error).message).not.toContain(PAT);
    expect((caught as Error).message).not.toContain('nope');
  });
});

describe('the written list is canonical (09.2-11, P81-P83)', () => {
  it('writes sorted and de-duplicated whatever order and repeats the stored list had', async () => {
    const { calls, fetchImpl } = stub(
      'https://z.example/auth/confirm**,https://b.example/auth/confirm**,https://z.example/auth/confirm**',
    );
    await list(fetchImpl).add('m.example');
    expect(calls[1]?.body).toEqual({
      uri_allow_list:
        'https://b.example/auth/confirm**,https://m.example/auth/confirm**,https://z.example/auth/confirm**',
    });
  });

  it('a repeated add changes nothing: the second run reads and does not write', async () => {
    const { calls, fetchImpl, value } = stub('https://z.example/auth/confirm**');
    const adapter = list(fetchImpl);
    await adapter.add('a.example');
    const afterFirst = value();
    await adapter.add('a.example');
    await adapter.add('a.example');
    expect(value()).toBe(afterFirst);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('an already-present entry in an unsorted stored list is not rewritten', async () => {
    const { calls, fetchImpl } = stub(
      'https://z.example/auth/confirm**,https://a.example/auth/confirm**',
    );
    await list(fetchImpl).add('a.example');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('a host that is a prefix or a suffix of another is a distinct exact entry', async () => {
    const { calls, fetchImpl } = stub('https://ba.example.com/auth/confirm**');
    const adapter = list(fetchImpl);
    await adapter.add('a.example.com');
    expect(calls[1]?.body).toEqual({
      uri_allow_list: 'https://a.example.com/auth/confirm**,https://ba.example.com/auth/confirm**',
    });
    await adapter.remove('a.example.com');
    expect(calls[3]?.body).toEqual({ uri_allow_list: 'https://ba.example.com/auth/confirm**' });
  });

  it('an add never writes an empty list, even over an empty or null stored one', async () => {
    for (const initial of [null, '', ' , ']) {
      const { calls, fetchImpl } = stub(initial);
      await list(fetchImpl).add('h.example');
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({ uri_allow_list: 'https://h.example/auth/confirm**' });
    }
  });
});

describe('authAllowListFor (09.2-11, DBT-42)', () => {
  const project = (id: string, credentialVersion = 1) => ({
    id,
    ref: `ref-${id}`,
    provider: 'supabase',
    credentialVersion,
  });

  it('keeps one in-memory ledger per project: two projects never cross', async () => {
    const a = authAllowListFor(project('proj-a'));
    const b = authAllowListFor(project('proj-b'));
    expect(a.name).toBe('local');
    expect(a).not.toBe(b);
    await a.add('only-a.example');
    await b.add('only-b.example');
    expect(
      localAllowListByProject.get('proj-a')?.has('https://only-a.example/auth/confirm**'),
    ).toBe(true);
    expect(
      localAllowListByProject.get('proj-a')?.has('https://only-b.example/auth/confirm**'),
    ).toBe(false);
    expect(
      localAllowListByProject.get('proj-b')?.has('https://only-b.example/auth/confirm**'),
    ).toBe(true);
    // The union view the existing platform tests read still sees both.
    expect(localAllowListEntries.has('https://only-a.example/auth/confirm**')).toBe(true);
    await a.remove('only-a.example');
    await b.remove('only-b.example');
  });

  it('memoises by project and credential version, and a rotated credential gets a fresh adapter', () => {
    const first = authAllowListFor(project('proj-c', 1));
    expect(authAllowListFor(project('proj-c', 1))).toBe(first);
    expect(authAllowListFor(project('proj-c', 2))).not.toBe(first);
  });

  it('stays bounded at 64 adapters', () => {
    const kept = authAllowListFor(project('proj-keep'));
    for (let n = 0; n < 80; n += 1) authAllowListFor(project(`proj-fill-${n}`));
    // The oldest were evicted; the earliest key now builds a new adapter.
    expect(authAllowListFor(project('proj-keep'))).not.toBe(kept);
  });
});

// ---------------------------------------------------------------------------------------------------------
// 09.4-06 (CTK-27, D-575, T-09.4-22): the allow-list of a CUSTOMER project goes through its guarded provider.
// ---------------------------------------------------------------------------------------------------------

describe('createProviderAuthAllowList (09.4-06, CTK-27)', () => {
  /** A recording stand-in for the guarded provider: only the two config methods the adapter may use. */
  function stubProvider(initial: string | null) {
    const log: string[] = [];
    let current = initial;
    const provider = {
      name: 'fake',
      async getAuthConfig(ref: string) {
        log.push(`get ${ref}`);
        return { uri_allow_list: current, site_url: 'https://untouched.example' };
      },
      async patchAuthConfig(ref: string, body: Record<string, unknown>) {
        log.push(`patch ${ref}`);
        log.push(JSON.stringify(body));
        current = String(body.uri_allow_list);
      },
    } as unknown as ProjectProvider;
    return { provider, log, current: () => current };
  }

  it('adds one exact-host entry, sorted and de-duplicated, keeps the others, writes only on a change', async () => {
    const { provider, log, current } = stubProvider(
      'https://b.example/auth/confirm**, https://a.example/auth/confirm**,http://localhost:3000/**',
    );
    const adapter = allowLists.createProviderAuthAllowList(provider, REF);
    expect(adapter.name).toBe('supabase');

    await adapter.add('c.example');
    expect(current()).toBe(
      [
        'http://localhost:3000/**',
        'https://a.example/auth/confirm**',
        'https://b.example/auth/confirm**',
        'https://c.example/auth/confirm**',
      ].join(','),
    );
    const writes = log.filter((line) => line.startsWith('patch')).length;
    expect(writes).toBe(1);
    // The same host again: read, no write.
    await adapter.add('c.example');
    expect(log.filter((line) => line.startsWith('patch')).length).toBe(writes);
    // Only `uri_allow_list` is ever written.
    for (const line of log.filter((entry) => entry.startsWith('{'))) {
      expect(Object.keys(JSON.parse(line))).toEqual(['uri_allow_list']);
    }
  });

  it('refuses a host outside the exact-host rule before any request, and never writes an empty list on add', async () => {
    const refused = stubProvider('');
    const adapter = allowLists.createProviderAuthAllowList(refused.provider, REF);
    await expect(adapter.add('*.example.com')).rejects.toThrow(/exact-host/);
    await expect(adapter.add('bad host.example')).rejects.toThrow(/exact-host/);
    expect(refused.log).toEqual([]);

    for (const initial of [null, '', ' , ']) {
      const stub = stubProvider(initial);
      await allowLists.createProviderAuthAllowList(stub.provider, REF).add('h.example');
      expect(stub.current()).toBe('https://h.example/auth/confirm**');
    }
  });

  it('remove drops exactly that entry, and does nothing when it is absent', async () => {
    const { provider, log, current } = stubProvider(
      'https://a.example/auth/confirm**,https://b.example/auth/confirm**',
    );
    const adapter = allowLists.createProviderAuthAllowList(provider, REF);
    await adapter.remove('a.example');
    expect(current()).toBe('https://b.example/auth/confirm**');
    const writes = log.filter((line) => line.startsWith('patch')).length;
    await adapter.remove('a.example');
    expect(log.filter((line) => line.startsWith('patch')).length).toBe(writes);
  });

  it('a dead customer token rejects with token_invalid and no write happens', async () => {
    const TOKEN = 'sbp_fc_fake_allow';
    const fake = createFakeProjectProvider({
      targets: {
        [REF]: {
          apiUrl: 'http://127.0.0.1:54321',
          databaseUrl: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
          host: '127.0.0.1',
          port: 54322,
          dbName: 'postgres',
        },
      },
      tokens: { [TOKEN]: { refs: 'all' } },
    });
    fake.setTokenState(TOKEN, 'dead');
    const adapter = allowLists.createProviderAuthAllowList(fake.forToken(TOKEN), REF);
    const failure = await adapter.add('h.example').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProjectProviderError);
    expect(failure).toMatchObject({ code: 'token_invalid', customerToken: true });
    expect((failure as Error).message).not.toContain('sbp_');
    expect(fake.calls.patches[REF] ?? []).toEqual([]);
  });
});

describe('authAllowListFor for a customer project (09.4-06, CTK-27, D-575)', () => {
  const TOKEN = 'sbp_fc_fake_adapter';
  const customer = (id: string, credentialVersion = 1) => ({
    id,
    ref: REF,
    provider: 'supabase',
    credentialVersion,
    owner: 'customer',
    orgSlug: 'acme',
    mgmtTokenSealed: seal(TOKEN, `${id}:mgmt_token`),
  });

  it('with mode supabase it builds the provider-backed adapter, memoised by project and version', () => {
    const first = domains.authAllowListFor(customer('cust-a'), { mode: 'supabase' });
    expect(first.name).toBe('supabase');
    expect(domains.authAllowListFor(customer('cust-a'), { mode: 'supabase' })).toBe(first);
    expect(domains.authAllowListFor(customer('cust-a', 2), { mode: 'supabase' })).not.toBe(first);
  });

  it('a platform project with mode supabase still takes the platform adapter path (it needs the platform token)', () => {
    const platform = { id: 'plat-a', ref: REF, provider: 'supabase', credentialVersion: 1 };
    expect(() => domains.authAllowListFor(platform, { mode: 'supabase' })).toThrow(
      /is required by the selected adapter/,
    );
  });

  it('with no mode both a customer and a platform project keep an in-memory ledger', () => {
    expect(domains.authAllowListFor(customer('cust-local')).name).toBe('local');
    const platform = { id: 'plat-local', ref: REF, provider: 'supabase', credentialVersion: 1 };
    expect(domains.authAllowListFor(platform).name).toBe('local');
  });

  it('writes through the project token: a dead token fails in the reconcile path, naming the code', async () => {
    const fake = createFakeProjectProvider({
      targets: {
        [REF]: {
          apiUrl: 'http://127.0.0.1:54321',
          databaseUrl: 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
          host: '127.0.0.1',
          port: 54322,
          dbName: 'postgres',
        },
      },
      orgSlug: 'acme',
      tokens: { [TOKEN]: { refs: 'all' } },
    });
    setProjectProviderForTests(fake);
    try {
      const adapter = domains.authAllowListFor(customer('cust-live'), { mode: 'supabase' });
      await adapter.add('h.example');
      expect(fake.calls.tokenUses.every((use) => use.kind === 'customer')).toBe(true);
      expect(fake.calls.patches[REF]?.at(-1)?.body).toEqual({
        uri_allow_list: 'https://h.example/auth/confirm**',
      });
      fake.setTokenState(TOKEN, 'dead');
      await expect(adapter.add('other.example')).rejects.toMatchObject({ code: 'token_invalid' });
    } finally {
      setProjectProviderForTests(undefined);
    }
  });

  it('stays bounded at 64 adapters', () => {
    const kept = domains.authAllowListFor(customer('cust-keep'), { mode: 'supabase' });
    for (let n = 0; n < 80; n += 1) {
      domains.authAllowListFor(customer(`cust-fill-${n}`), { mode: 'supabase' });
    }
    expect(domains.authAllowListFor(customer('cust-keep'), { mode: 'supabase' })).not.toBe(kept);
  });

  it('dropAllowListAdapter removes every version of that project and no other', () => {
    const a1 = domains.authAllowListFor(customer('cust-drop-a', 1), { mode: 'supabase' });
    const a2 = domains.authAllowListFor(customer('cust-drop-a', 2), { mode: 'supabase' });
    const b1 = domains.authAllowListFor(customer('cust-drop-b', 1), { mode: 'supabase' });
    domains.dropAllowListAdapter('cust-drop-a');
    expect(domains.authAllowListFor(customer('cust-drop-a', 1), { mode: 'supabase' })).not.toBe(a1);
    expect(domains.authAllowListFor(customer('cust-drop-a', 2), { mode: 'supabase' })).not.toBe(a2);
    expect(domains.authAllowListFor(customer('cust-drop-b', 1), { mode: 'supabase' })).toBe(b1);
  });
});
