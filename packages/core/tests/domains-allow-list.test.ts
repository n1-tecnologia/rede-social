import { describe, expect, it } from 'vitest';
import {
  createLocalAuthAllowList,
  createSupabaseAuthAllowList,
  localAllowListEntries,
} from '../server/domains/auth-allow-list';
import { allowListEntry } from '../server/domains/types';

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
  it('add: GET then PATCH the same path with the existing entries preserved in order plus the new one', async () => {
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
        'https://app.example/**,https://old.example/auth/confirm**,https://h.example/auth/confirm**',
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
