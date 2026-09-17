import type { DnsRecord } from '@tria/contracts';
import { z } from 'zod';
import { moduleLogger } from '../logging';
import { type DomainCheck, type DomainProvider, DomainProviderError } from './types';

/**
 * `DOMAIN_PROVIDER=vercel` — the Vercel Project Domains REST adapter (RESEARCH Pattern 5;
 * COVERAGE.md "Vercel REST API — Project Domains": every INTEGRATE row is one of the five calls
 * below, and no OPT-OUT endpoint has code here — no listing, no redirect PATCH, no account-level
 * delete, no DNS records, no buying).
 *
 * Two independent conditions decide `verified_at` (Pitfall 5): ownership (`verified` on the
 * project domain, else the TXT challenge in `verification[]` at `_vercel.<apex>`) and configuration
 * (`misconfigured === false` on `/config`). The routing targets come ONLY from the config answer
 * (`recommendedCNAME` / `recommendedIPv4`, rank 1) — each project has its own CNAME target, so the
 * generic values from the docs are never hard-coded.
 *
 * Secrets: the token is read by `domains/index.ts` from the kernel env and injected here; requests
 * are logged as `{ method, path, status }` only and every failure becomes a `DomainProviderError`
 * whose message carries kind + status (T-02-51). `redirect: 'error'` and a 10 s timeout on every
 * call; the host is `encodeURIComponent`-ed into every path (T-02-52).
 */

const log = moduleLogger('domains-vercel');

const DEFAULT_BASE_URL = 'https://api.vercel.com';
const REQUEST_TIMEOUT_MS = 10_000;

const projectDomainSchema = z
  .object({
    name: z.string(),
    apexName: z.string(),
    projectId: z.string(),
    verified: z.boolean(),
    verification: z
      .array(
        z.object({
          type: z.string(),
          domain: z.string(),
          value: z.string(),
          reason: z.string(),
        }),
      )
      .optional(),
  })
  .loose();
type ProjectDomain = z.infer<typeof projectDomainSchema>;

const domainConfigSchema = z
  .object({
    configuredBy: z.string().nullable().optional(),
    misconfigured: z.boolean(),
    recommendedCNAME: z.array(z.object({ rank: z.number(), value: z.string() })).default([]),
    recommendedIPv4: z
      .array(z.object({ rank: z.number(), value: z.array(z.string()) }))
      .default([]),
    acceptedChallenges: z.array(z.string()).default([]),
  })
  .loose();
type DomainConfig = z.infer<typeof domainConfigSchema>;

const vercelErrorSchema = z
  .object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }) })
  .loose();

export type VercelDomainProviderOptions = {
  token: string;
  projectId: string;
  teamId: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

type Method = 'GET' | 'POST' | 'DELETE';

export function createVercelDomainProvider(opts: VercelDomainProviderOptions): DomainProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const projectId = encodeURIComponent(opts.projectId);
  const teamQuery = `teamId=${encodeURIComponent(opts.teamId)}`;

  /** One place builds every request; non-2xx answers are mapped to `DomainProviderError` by `errorOf`. */
  async function request(req: { method: Method; path: string; body?: object }): Promise<Response> {
    const { method, path, body } = req;
    const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}${teamQuery}`;
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    log.debug({ event: 'domains.vercel.request', method, path, status: response.status });
    return response;
  }

  async function errorOf(response: Response): Promise<DomainProviderError> {
    let code: string | undefined;
    try {
      code = vercelErrorSchema.parse(await response.json()).error.code;
    } catch {
      code = undefined;
    }
    const status = response.status;
    if (status === 400 && code === 'invalid_domain') {
      return new DomainProviderError('invalid_domain', status);
    }
    if (status === 403) return new DomainProviderError('forbidden', status);
    if (status === 409) return new DomainProviderError('in_use', status);
    if (status === 429) return new DomainProviderError('rate_limited', status);
    return new DomainProviderError('unavailable', status);
  }

  async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) throw await errorOf(response);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new DomainProviderError('unavailable', response.status);
    return parsed.data;
  }

  const domainPath = (host: string) =>
    `/v9/projects/${projectId}/domains/${encodeURIComponent(host)}`;
  const configPath = (host: string) =>
    `/v6/domains/${encodeURIComponent(host)}/config?projectIdOrName=${projectId}`;

  const getProjectDomain = async (host: string): Promise<ProjectDomain> =>
    parse(await request({ method: 'GET', path: domainPath(host) }), projectDomainSchema);

  const getConfig = async (host: string): Promise<DomainConfig> =>
    parse(await request({ method: 'GET', path: configPath(host) }), domainConfigSchema);

  function recordsOf(host: string, pd: ProjectDomain, cfg: DomainConfig): DnsRecord[] {
    const records: DnsRecord[] = [];
    if (pd.name === pd.apexName) {
      const ipv4 = cfg.recommendedIPv4.find((r) => r.rank === 1)?.value[0];
      if (ipv4) records.push({ type: 'A', name: host, value: ipv4, purpose: 'routing' });
    } else {
      const cname = cfg.recommendedCNAME.find((r) => r.rank === 1)?.value;
      if (cname) records.push({ type: 'CNAME', name: host, value: cname, purpose: 'routing' });
    }
    // A12: the challenge's `domain` is shown verbatim (documented as `_vercel.<apex>`).
    for (const entry of pd.verification ?? []) {
      records.push({ type: 'TXT', name: entry.domain, value: entry.value, purpose: 'ownership' });
    }
    return records;
  }

  const checkOf = (host: string, pd: ProjectDomain, cfg: DomainConfig): DomainCheck => ({
    ownershipVerified: pd.verified,
    configured: !cfg.misconfigured,
    records: recordsOf(host, pd, cfg),
  });

  return {
    name: 'vercel',

    async addDomain(host): Promise<DomainCheck> {
      const added = await request({
        method: 'POST',
        path: `/v10/projects/${projectId}/domains`,
        body: { name: host },
      });
      let pd: ProjectDomain;
      if (added.ok) {
        pd = await parse(added, projectDomainSchema);
      } else {
        const error = await errorOf(added);
        if (error.kind !== 'in_use') throw error;
        // 409: on THIS project already (idempotent add) or on another one (genuinely in use)?
        const lookup = await request({ method: 'GET', path: domainPath(host) });
        if (lookup.status === 404) throw error;
        pd = await parse(lookup, projectDomainSchema);
      }
      const cfg = await getConfig(host);
      return checkOf(host, pd, cfg);
    },

    async getDnsRecords(host): Promise<DnsRecord[]> {
      const [pd, cfg] = await Promise.all([getProjectDomain(host), getConfig(host)]);
      return recordsOf(host, pd, cfg);
    },

    async verify(host): Promise<DomainCheck> {
      const [pd, cfg] = await Promise.all([getProjectDomain(host), getConfig(host)]);
      let ownershipVerified = pd.verified;
      let records = recordsOf(host, pd, cfg);
      if (!ownershipVerified) {
        const attempt = await request({ method: 'POST', path: `${domainPath(host)}/verify` });
        if (attempt.ok) {
          const verified = await parse(attempt, projectDomainSchema);
          ownershipVerified = verified.verified;
          records = recordsOf(host, verified, cfg);
        } else if (attempt.status !== 400) {
          // 400 = TXT missing / mismatch (Pitfall 5): still pending. Anything else is a real failure.
          throw await errorOf(attempt);
        }
      }
      return { ownershipVerified, configured: !cfg.misconfigured, records };
    },

    async removeDomain(host): Promise<void> {
      const response = await request({ method: 'DELETE', path: domainPath(host) });
      if (response.ok || response.status === 404) return;
      throw await errorOf(response);
    },
  };
}
