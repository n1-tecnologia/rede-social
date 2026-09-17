import { describe, expect, it } from 'vitest';
import { DomainProviderError } from '../server/domains/types';
import { createVercelDomainProvider } from '../server/domains/vercel';

/**
 * The Vercel Project Domains adapter (RESEARCH Pattern 5, COVERAGE.md INTEGRATE rows) proven
 * against a recording `fetchImpl` that answers the documented bodies with INVENTED targets — the
 * adapter must echo what the API says, never a hard-coded CNAME/IPv4 (each project has its own).
 * No network: every request is captured and asserted (method, URL, Authorization, body).
 */

const TOKEN = 'vercel-token-SECRET-do-not-leak';
const PROJECT = 'prj_abc123';
const TEAM = 'team_xyz';
const HOST = 'comunidade.cliente.com.br';
const APEX = 'cliente.com.br';

type Call = { method: string; url: URL; headers: Headers; body: unknown; redirect?: string };
type Answer = { status: number; body?: unknown };
type Handler = (call: Call) => Answer;

/** `METHOD pathname` -> answer (a list is consumed in order, so a 409-then-200 sequence is expressible). */
function fetchStub(routes: Record<string, Answer | Answer[] | Handler>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: Call = { method, url, headers, body, redirect: init?.redirect };
    calls.push(call);
    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    if (!route)
      return new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 });
    let answer: Answer;
    if (typeof route === 'function') answer = route(call);
    else if (Array.isArray(route)) {
      const next = route.shift();
      if (!next) throw new Error(`no more answers for ${key}`);
      answer = next;
    } else answer = route;
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

const projectDomain = (overrides: Record<string, unknown> = {}) => ({
  name: HOST,
  apexName: APEX,
  projectId: PROJECT,
  verified: true,
  ...overrides,
});
const config = (overrides: Record<string, unknown> = {}) => ({
  configuredBy: null,
  misconfigured: true,
  recommendedCNAME: [
    { rank: 2, value: 'zzz.vercel-dns-000.test' },
    { rank: 1, value: 'abc123.vercel-dns-999.test' },
  ],
  recommendedIPv4: [{ rank: 1, value: ['198.51.100.7', '198.51.100.8'] }],
  acceptedChallenges: ['dns-01'],
  ...overrides,
});

const provider = (fetchImpl: typeof fetch) =>
  createVercelDomainProvider({ token: TOKEN, projectId: PROJECT, teamId: TEAM, fetchImpl });

const domainPath = `/v9/projects/${PROJECT}/domains/${encodeURIComponent(HOST)}`;
const configPath = `/v6/domains/${encodeURIComponent(HOST)}/config`;

describe('createVercelDomainProvider — addDomain', () => {
  it('POSTs /v10/projects/{id}/domains?teamId= with the bearer token and { name }, then reads the config for the records', async () => {
    const { calls, fetchImpl } = fetchStub({
      [`POST /v10/projects/${PROJECT}/domains`]: { status: 200, body: projectDomain() },
      [`GET ${configPath}`]: { status: 200, body: config() },
    });
    const check = await provider(fetchImpl).addDomain(HOST);

    const post = calls[0];
    expect(post?.method).toBe('POST');
    expect(post?.url.origin).toBe('https://api.vercel.com');
    expect(post?.url.pathname).toBe(`/v10/projects/${PROJECT}/domains`);
    expect(post?.url.searchParams.get('teamId')).toBe(TEAM);
    expect(post?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(post?.headers.get('content-type')).toBe('application/json');
    expect(post?.body).toEqual({ name: HOST });
    expect(post?.redirect).toBe('error');

    expect(check.ownershipVerified).toBe(true);
    expect(check.configured).toBe(false);
    expect(check.records).toEqual([
      { type: 'CNAME', name: HOST, value: 'abc123.vercel-dns-999.test', purpose: 'routing' },
    ]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).not.toContain(
      `POST ${domainPath}/verify`,
    );
  });

  it('409 whose follow-up GET is 404 rejects with in_use; 409 whose GET is 200 is already ours and continues', async () => {
    const taken = fetchStub({
      [`POST /v10/projects/${PROJECT}/domains`]: {
        status: 409,
        body: { error: { code: 'domain_already_in_use', message: 'in use by another project' } },
      },
      [`GET ${domainPath}`]: { status: 404, body: { error: { code: 'not_found' } } },
    });
    await expect(provider(taken.fetchImpl).addDomain(HOST)).rejects.toMatchObject({
      kind: 'in_use',
    });

    const ours = fetchStub({
      [`POST /v10/projects/${PROJECT}/domains`]: {
        status: 409,
        body: { error: { code: 'domain_already_in_use', message: 'already added' } },
      },
      [`GET ${domainPath}`]: { status: 200, body: projectDomain({ verified: false }) },
      [`GET ${configPath}`]: { status: 200, body: config({ misconfigured: false }) },
    });
    const check = await provider(ours.fetchImpl).addDomain(HOST);
    expect(check).toMatchObject({ ownershipVerified: false, configured: true });
  });

  it('400 invalid_domain maps to invalid_domain; the error message never carries the token', async () => {
    const { fetchImpl } = fetchStub({
      [`POST /v10/projects/${PROJECT}/domains`]: {
        status: 400,
        body: { error: { code: 'invalid_domain', message: `bad ${TOKEN}` } },
      },
    });
    let caught: unknown;
    try {
      await provider(fetchImpl).addDomain('bad host');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainProviderError);
    expect((caught as DomainProviderError).kind).toBe('invalid_domain');
    expect((caught as Error).message).not.toContain(TOKEN);
    expect((caught as Error).message).not.toContain('bad');
  });
});

describe('createVercelDomainProvider — getDnsRecords', () => {
  it('builds CNAME from recommendedCNAME rank 1 for a subdomain and one TXT per verification[] entry (name verbatim)', async () => {
    const { calls, fetchImpl } = fetchStub({
      [`GET ${domainPath}`]: {
        status: 200,
        body: projectDomain({
          verified: false,
          verification: [
            {
              type: 'TXT',
              domain: `_vercel.${APEX}`,
              value: 'vc-domain-verify=xyz',
              reason: 'pending_domain_verification',
            },
          ],
        }),
      },
      [`GET ${configPath}`]: { status: 200, body: config() },
    });
    const records = await provider(fetchImpl).getDnsRecords(HOST);
    expect(records).toEqual([
      { type: 'CNAME', name: HOST, value: 'abc123.vercel-dns-999.test', purpose: 'routing' },
      { type: 'TXT', name: `_vercel.${APEX}`, value: 'vc-domain-verify=xyz', purpose: 'ownership' },
    ]);
    const cfg = calls.find((c) => c.url.pathname === configPath);
    expect(cfg?.url.searchParams.get('projectIdOrName')).toBe(PROJECT);
    expect(cfg?.url.searchParams.get('teamId')).toBe(TEAM);
    expect(cfg?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  });

  it('builds A from recommendedIPv4 rank 1 first value for an apex', async () => {
    const apexPath = `/v9/projects/${PROJECT}/domains/${encodeURIComponent(APEX)}`;
    const { fetchImpl } = fetchStub({
      [`GET ${apexPath}`]: { status: 200, body: projectDomain({ name: APEX }) },
      [`GET /v6/domains/${encodeURIComponent(APEX)}/config`]: { status: 200, body: config() },
    });
    const records = await provider(fetchImpl).getDnsRecords(APEX);
    expect(records).toEqual([{ type: 'A', name: APEX, value: '198.51.100.7', purpose: 'routing' }]);
  });
});

describe('createVercelDomainProvider — verify', () => {
  it('POSTs /verify only when the project domain is not verified; a 400 there leaves ownership false; misconfigured true means configured false', async () => {
    const { calls, fetchImpl } = fetchStub({
      [`GET ${domainPath}`]: { status: 200, body: projectDomain({ verified: false }) },
      [`GET ${configPath}`]: { status: 200, body: config({ misconfigured: true }) },
      [`POST ${domainPath}/verify`]: {
        status: 400,
        body: { error: { code: 'missing_txt_record', message: 'no TXT record' } },
      },
    });
    const check = await provider(fetchImpl).verify(HOST);
    expect(check.ownershipVerified).toBe(false);
    expect(check.configured).toBe(false);
    expect(calls.filter((c) => c.url.pathname.endsWith('/verify'))).toHaveLength(1);
  });

  it('a 200 from /verify reads `verified` from the body; both true only when verified and misconfigured === false', async () => {
    const { fetchImpl } = fetchStub({
      [`GET ${domainPath}`]: { status: 200, body: projectDomain({ verified: false }) },
      [`GET ${configPath}`]: { status: 200, body: config({ misconfigured: false }) },
      [`POST ${domainPath}/verify`]: { status: 200, body: projectDomain({ verified: true }) },
    });
    expect(await provider(fetchImpl).verify(HOST)).toMatchObject({
      ownershipVerified: true,
      configured: true,
    });
  });

  it('skips the /verify POST when the project domain is already verified', async () => {
    const { calls, fetchImpl } = fetchStub({
      [`GET ${domainPath}`]: { status: 200, body: projectDomain({ verified: true }) },
      [`GET ${configPath}`]: { status: 200, body: config({ misconfigured: false }) },
    });
    const check = await provider(fetchImpl).verify(HOST);
    expect(check).toMatchObject({ ownershipVerified: true, configured: true });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('createVercelDomainProvider — removeDomain and error mapping', () => {
  it('DELETEs /v9/projects/{id}/domains/{host}?teamId= with the host URL-encoded; 404 resolves', async () => {
    const weird = 'xn--comunidade-caf-8bb.cliente.com.br';
    const { calls, fetchImpl } = fetchStub({
      [`DELETE /v9/projects/${PROJECT}/domains/${encodeURIComponent(weird)}`]: {
        status: 200,
        body: {},
      },
      [`DELETE ${domainPath}`]: { status: 404, body: { error: { code: 'not_found' } } },
    });
    const p = provider(fetchImpl);
    await expect(p.removeDomain(weird)).resolves.toBeUndefined();
    await expect(p.removeDomain(HOST)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.searchParams.get('teamId')).toBe(TEAM);
    expect(calls.every((c) => c.redirect === 'error')).toBe(true);
    // A host with a slash can never escape the project path.
    await p.removeDomain('a/b.example').catch(() => undefined);
    expect(calls[2]?.url.pathname).toBe(
      `/v9/projects/${PROJECT}/domains/${encodeURIComponent('a/b.example')}`,
    );
  });

  it('429 -> rate_limited, 403 -> forbidden, 5xx -> unavailable (with status), never leaking the token', async () => {
    const cases: Array<[number, string]> = [
      [429, 'rate_limited'],
      [403, 'forbidden'],
      [503, 'unavailable'],
    ];
    for (const [status, kind] of cases) {
      const { fetchImpl } = fetchStub({
        [`DELETE ${domainPath}`]: { status, body: { error: { code: 'x', message: TOKEN } } },
      });
      let caught: unknown;
      try {
        await provider(fetchImpl).removeDomain(HOST);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainProviderError);
      const err = caught as DomainProviderError;
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
      expect(err.message).not.toContain(TOKEN);
    }
  });
});
