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

/**
 * Deletes the membership row while leaving the identity (and its live session) alone — the "orphan
 * identity" the API answers with 403 `NO_MEMBERSHIP`.
 */
export async function removeMembership(email: string): Promise<void> {
  await sql()`
    delete from public.memberships m
     using public.users u
     where u.id = m.user_id and u.email = ${email}`;
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

/** Removes the throwaway example items a spec created (01-07; the module is deleted in Phase 4). */
export async function deleteExampleItemsLike(pattern: string): Promise<void> {
  await sql()`delete from public.example_items where title like ${pattern}`;
}

/**
 * Removes a tenant the platform-panel spec created through the UI (02-12). `tenant_modules`,
 * `tenant_domains`, `tenant_invites` and `memberships` cascade from `tenants`.
 */
export async function deleteTenantBySlug(slug: string): Promise<void> {
  await sql()`delete from public.tenants where slug = ${slug}`;
}

/** `tenant_modules.enabled` for one key of one tenant, or `null` when there is no row (D-17/D-19). */
export async function getTenantModuleFlag(slug: string, key: string): Promise<boolean | null> {
  const rows = await sql()<{ enabled: boolean }[]>`
    select tm.enabled
      from public.tenant_modules tm
      join public.tenants t on t.id = tm.tenant_id
     where t.slug = ${slug} and tm.module_key = ${key}`;
  return rows[0]?.enabled ?? null;
}

/** A `.env.local` / process value a spec needs on the Node side (02-10 invite spec). Read, never printed. */
export function envValue(name: string): string {
  return required(name);
}

/** The live membership of an e-mail (`role` + `status`), or `null` when there is none (02-10). */
export async function membershipForEmail(
  email: string,
): Promise<{ role: string; status: string } | null> {
  const rows = await sql()<{ role: string; status: string }[]>`
    select m.role, m.status
      from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email} and m.deleted_at is null
     limit 1`;
  return rows[0] ?? null;
}

/** How many `consent_records` rows an e-mail owns (D-03 evidence: two after an accept). */
export async function consentCountForEmail(email: string): Promise<number> {
  const rows = await sql()<{ count: number }[]>`
    select count(*)::int as count
      from public.consent_records c
      join public.users u on u.id = c.user_id
     where u.email = ${email}`;
  return rows[0]?.count ?? 0;
}

/**
 * Restores a seeded member's profile to known values (03-04): the profile specs edit the SHARED
 * seeded member, so every case puts the row back the way `pnpm db:seed` wrote it. `avatarAssetId` is
 * cleared when `null` is passed, which is what a photo case needs in its teardown — the asset row and
 * its Storage objects are left to 03-08's sweeper, exactly as a real removal leaves them.
 */
export async function resetMemberProfile(
  email: string,
  values: { displayName: string; bio: string | null; avatarAssetId?: string | null },
): Promise<void> {
  const updated = await sql()`
    update public.member_profiles p
       set display_name = ${values.displayName},
           bio = ${values.bio},
           updated_at = now()
      from public.users u
     where u.id = p.user_id and u.email = ${email}
    returning p.id`;
  if (updated.length === 0) throw new Error(`no member profile for ${email}`);

  if (values.avatarAssetId !== undefined) {
    await sql()`
      update public.member_profiles p
         set avatar_asset_id = ${values.avatarAssetId},
             updated_at = now()
        from public.users u
       where u.id = p.user_id and u.email = ${email}`;
  }
}

/** A seeded member's profile row as the screens read it (03-04 assertions on persistence). */
export async function memberProfileForEmail(
  email: string,
): Promise<{ displayName: string; bio: string | null; avatarAssetId: string | null } | null> {
  const rows = await sql()<
    { display_name: string; bio: string | null; avatar_asset_id: string | null }[]
  >`
    select p.display_name, p.bio, p.avatar_asset_id
      from public.member_profiles p
      join public.users u on u.id = p.user_id
     where u.email = ${email}
     limit 1`;
  const row = rows[0];
  return row
    ? { displayName: row.display_name, bio: row.bio, avatarAssetId: row.avatar_asset_id }
    : null;
}

/** The newest `tenant_invites.status` for an e-mail, or `null` (02-10 lifecycle assertions). */
export async function inviteStatusForEmail(email: string): Promise<string | null> {
  const rows = await sql()<{ status: string }[]>`
    select status from public.tenant_invites
     where email = ${email}
     order by created_at desc
     limit 1`;
  return rows[0]?.status ?? null;
}
