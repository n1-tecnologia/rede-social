import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Fixtures for specs that need a THROWAWAY member: the seeded users are shared by the whole suite and
 * must never be blocked or have their password rotated.
 *
 * Identity is created through the GoTrue admin API (service key) and the membership through a direct
 * superuser connection — the same split `scripts/seed.ts` uses, and the reason both credentials are
 * required here. Application code never does either.
 */

/**
 * `scripts/local-env.sh --write` generates `apps/api/.env.local`; CI passes the same names through the
 * process environment. Values are read, never printed.
 */
function fromEnvFile(): Record<string, string> {
  const file = fileURLToPath(new URL('../../api/.env.local', import.meta.url));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

let fileValues: Record<string, string> | null = null;

function required(name: string): string {
  fileValues ??= fromEnvFile();
  const value = process.env[name] || fileValues[name];
  if (!value) {
    throw new Error(`${name} is required by the e2e admin fixtures (see scripts/local-env.sh)`);
  }
  return value;
}

/** Superuser connection for fixtures only. Never used by application code. */
let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

function authHeaders(): Record<string, string> {
  const key = required('SUPABASE_SERVICE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

/** Creates a confirmed identity plus an active membership in `tenantSlug`. Returns the user id. */
export async function createMember(
  email: string,
  password: string,
  tenantSlug: string,
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
): Promise<string> {
  const res = await fetch(`${required('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };

  // `public.users` is mirrored from `auth.users` by the on_auth_user_created trigger.
  const inserted = await sql()`
    insert into public.memberships (tenant_id, user_id, role, status)
    select t.id, ${id}::uuid, ${role}, 'active' from public.tenants t where t.slug = ${tenantSlug}
    on conflict (tenant_id, user_id) do update set status = 'active'
    returning id`;
  if (inserted.length === 0) throw new Error(`tenant ${tenantSlug} not found for ${email}`);

  return id;
}

/** Flips a membership between `active` and `blocked` (AUTH-06, D-09). */
export async function setMembershipStatus(
  email: string,
  status: 'active' | 'blocked' | 'invited',
): Promise<void> {
  const updated = await sql()`
    update public.memberships m
       set status = ${status},
           blocked_at = case when ${status} = 'blocked' then now() else null end
      from public.users u
     where u.id = m.user_id and u.email = ${email}
    returning m.id`;
  if (updated.length === 0) throw new Error(`no membership for ${email}`);
}

/** Removes the throwaway identity; `public.users` and `memberships` cascade. */
export async function deleteUserByEmail(email: string): Promise<void> {
  const rows = await sql()<{ id: string }[]>`select id from auth.users where email = ${email}`;
  const id = rows[0]?.id;
  if (!id) return;
  await fetch(`${required('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}
