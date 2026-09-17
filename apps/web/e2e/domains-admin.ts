import postgres from 'postgres';
import { envValue } from './admin';
import { hosts } from './fixtures';

/**
 * Spec-only helpers of the Domínios/Módulos panel spec (02-15). `admin.ts` is 02-12's (import
 * only); this file owns a real GoTrue session for API calls from the Node side and the two direct
 * reads/writes on `tenant_domains` the lifecycle tests need (expire a host, read its status).
 * Everything goes through the same superuser connection shape `admin.ts` uses — application code
 * never does either. Values are read, never printed.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const PLATFORM_HOST = new URL(hosts.platform).hostname;

export type ApiFetch = (path: string, init?: RequestInit, host?: string) => Promise<Response>;

/**
 * Signs `email` in with the GoTrue password grant and returns a `fetch` against the API that carries
 * the Bearer token + `x-tenant-host` (the platform host by default; a tenant host for member calls).
 */
export async function apiSession(email: string, password: string): Promise<ApiFetch> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed for the e2e session: ${res.status}`);
  const { access_token: accessToken } = (await res.json()) as { access_token: string };

  return (path, init = {}, host = PLATFORM_HOST) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-tenant-host': host,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
}

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeDomainsAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/** Moves a host's `verify_deadline_at` into the past so the NEXT check flips it to expired (D-34). */
export async function expireDomain(host: string): Promise<void> {
  const rows = await sql()`
    update public.tenant_domains
       set verify_deadline_at = now() - interval '1 minute'
     where host = ${host}
    returning id`;
  if (rows.length === 0) throw new Error(`no tenant_domains row for ${host}`);
}

/** `verification_status`, `is_primary` and `verified_at` of a host, or `null` when it is gone. */
export async function getDomainStatus(
  host: string,
): Promise<{ status: string; isPrimary: boolean; verifiedAt: string | null } | null> {
  const rows = await sql()<{ status: string; is_primary: boolean; verified_at: Date | null }[]>`
    select verification_status as status, is_primary, verified_at
      from public.tenant_domains
     where host = ${host}`;
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    isPrimary: row.is_primary,
    verifiedAt: row.verified_at ? row.verified_at.toISOString() : null,
  };
}
