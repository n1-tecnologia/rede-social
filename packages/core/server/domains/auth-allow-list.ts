import { z } from 'zod';
import { moduleLogger } from '../logging';
import { type AuthAllowList, allowListEntry } from './types';

/**
 * Auth redirect allow-list writers (D-34, docs/DEPLOY.md WR-09): the `local` no-op ledger (the env
 * default) and the Supabase Management API read-modify-write of `uri_allow_list`
 * (`AUTH_ALLOW_LIST=supabase`, hosted only). COVERAGE.md "Supabase Management API": the three
 * INTEGRATE rows are the GET and the two PATCH shapes below; `site_url`, `mailer_otp_exp`, hook and
 * SMTP fields are never touched from here.
 */

/**
 * Everything the local writer was asked to allow, in this process — the test seam that proves the
 * verified transition ran the allow-list step (`localAllowListEntries.has(allowListEntry(host))`).
 */
export const localAllowListEntries = new Set<string>();

/**
 * `AUTH_ALLOW_LIST=local` — the env default. A NO-OP against the real world on purpose: the local
 * GoTrue already accepts every `http://*.localhost:3000/**` redirect through
 * `supabase/config.toml` (`[auth] additional_redirect_urls`), so there is nothing to write, and
 * writing to a hosted project from a laptop would be exactly the accident the fail-safe default
 * exists to prevent. It keeps an in-memory ledger instead so the verified/detached transitions
 * stay observable in tests. Idempotent both ways.
 */
export function createLocalAuthAllowList(): AuthAllowList {
  return {
    name: 'local',
    async add(host) {
      localAllowListEntries.add(allowListEntry(host));
    },
    async remove(host) {
      localAllowListEntries.delete(allowListEntry(host));
    },
  };
}

const log = moduleLogger('domains-allow-list');

const DEFAULT_BASE_URL = 'https://api.supabase.com';
const REQUEST_TIMEOUT_MS = 10_000;

/** The only entry shape this adapter will ever write: exact lower-case host, the confirm path, `**`. */
const ALLOW_LIST_ENTRY = /^https:\/\/[a-z0-9.-]+\/auth\/confirm\*\*$/;

const authConfigSchema = z.object({ uri_allow_list: z.string().nullable() }).loose();

export type SupabaseAuthAllowListOptions = {
  pat: string;
  projectRef: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

/**
 * Read -> modify -> PATCH of `uri_allow_list` (`GOTRUE_URI_ALLOW_LIST`, a comma-separated list of
 * permitted `redirect_to` destinations). Every existing entry is preserved in order; the PATCH
 * only happens when the set changed; `add` refuses to write anything that fails the exact-host
 * regex (T-02-53: no wildcard creep); `remove` drops exactly that entry. Cross-process
 * serialisation is the caller's job (`withAllowListLock` in the platform lane). Error messages
 * carry the HTTP status only — never the PAT, never a response body.
 */
export function createSupabaseAuthAllowList(opts: SupabaseAuthAllowListOptions): AuthAllowList {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const path = `/v1/projects/${encodeURIComponent(opts.projectRef)}/config/auth`;

  async function call(req: { method: 'GET' | 'PATCH'; body?: object }): Promise<Response> {
    const { method, body } = req;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opts.pat}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    log.debug({ event: 'domains.allow_list.request', method, status: response.status });
    if (!response.ok) {
      throw new Error(`supabase auth config ${method} failed (${response.status})`);
    }
    return response;
  }

  async function read(): Promise<string[]> {
    const parsed = authConfigSchema.safeParse(await (await call({ method: 'GET' })).json());
    if (!parsed.success) throw new Error('supabase auth config GET answered an unexpected body');
    return (parsed.data.uri_allow_list ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  async function write(entries: string[]): Promise<void> {
    await call({ method: 'PATCH', body: { uri_allow_list: entries.join(',') } });
  }

  return {
    name: 'supabase',
    async add(host) {
      const entry = allowListEntry(host);
      if (!ALLOW_LIST_ENTRY.test(entry)) {
        throw new Error(
          'allow-list: refusing to write an entry that is not an exact-host confirm path',
        );
      }
      const current = await read();
      if (current.includes(entry)) return;
      await write([...current, entry]);
    },
    async remove(host) {
      const entry = allowListEntry(host);
      const current = await read();
      const next = current.filter((e) => e !== entry);
      if (next.length === current.length) return;
      await write(next);
    },
  };
}
