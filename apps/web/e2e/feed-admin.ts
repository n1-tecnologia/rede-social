import postgres from 'postgres';
import { envValue } from './admin';
import { createThrowawayTenant, deleteTenantBySlug, throwawayOrigin } from './tenant-fixtures';

/**
 * Fixture for the feed's EMPTY states (04-06, UI-D-20).
 *
 * Both seed tenants have posts by design — that is what every other feed spec reads — so "a
 * community with nothing published" cannot be observed there without deleting rows the rest of the
 * suite depends on. This module provisions a throwaway tenant with the `feed` module enabled, an
 * admin and one member, and NOT ONE POST, so the member copy and the admin copy of the empty card
 * can both be read from a real render.
 *
 * Identity goes through the GoTrue admin API and the membership through a direct superuser
 * connection — the same split `e2e/admin.ts` and `e2e/members-admin.ts` use.
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeFeedAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

function authHeaders(): Record<string, string> {
  const key = envValue('SUPABASE_SERVICE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

async function createUser(email: string, password: string): Promise<string> {
  const res = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export type EmptyFeedTenant = {
  slug: string;
  origin: string;
  tenantId: string;
  adminEmail: string;
  memberEmail: string;
  password: string;
};

/** Per-project slug, so the two Playwright projects never provision the same host concurrently. */
export function emptyFeedSlug(project: string): string {
  return `feed-empty-${project.replace(/[^a-z0-9]+/gi, '').toLowerCase()}`;
}

async function addMembership(
  tenantId: string,
  email: string,
  password: string,
  role: 'member' | 'admin_tenant',
  displayName: string,
): Promise<string> {
  const userId = await createUser(email, password);
  const rows = await sql()<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${userId}::uuid, ${role}, 'active')
    returning id`;
  const membershipId = rows[0]?.id;
  if (!membershipId) throw new Error(`could not create a membership for ${email}`);
  // The trigger seeds the profile from `users.name` (empty here) — name it deliberately.
  await sql()`
    update public.member_profiles
       set display_name = ${displayName}, updated_at = now()
     where membership_id = ${membershipId}::uuid`;
  return membershipId;
}

/** Provisions `slug` with the feed enabled, an admin, one member and zero posts. Idempotent. */
export async function createEmptyFeedTenant(
  slug: string,
  password: string,
): Promise<EmptyFeedTenant> {
  await deleteEmptyFeedTenant(slug);

  const host = `${slug}.localhost`;
  const { id: tenantId } = await createThrowawayTenant({
    slug,
    displayName: `Comunidade ${slug}`,
    hosts: [{ host, primary: true, verified: true }],
    colors: { primary: '#2e6fd0', secondary: '#7aa7e8' },
  });

  // `feed` ENABLED and nothing else: the widget must be the only home slot, so the card the member
  // reads is unambiguously the feed's own empty and not `HomeSlots`' "Em breve" (UI-D-20).
  await sql()`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantId}::uuid, 'feed', true)
    on conflict (tenant_id, module_key) do update set enabled = true`;

  const adminEmail = `admin@${slug}.local`;
  const memberEmail = `membro@${slug}.local`;
  await addMembership(tenantId, adminEmail, password, 'admin_tenant', 'Admin Sem Publicacoes');
  await addMembership(tenantId, memberEmail, password, 'member', 'Membro Sem Publicacoes');

  return {
    slug,
    origin: throwawayOrigin(host),
    tenantId,
    adminEmail,
    memberEmail,
    password,
  };
}

/** Removes the tenant, its memberships and the two GoTrue users it created. */
export async function deleteEmptyFeedTenant(slug: string): Promise<void> {
  const users = await sql()<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${slug}`;
  await deleteTenantBySlug(slug);
  for (const row of users) {
    await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users/${row.user_id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  }
}
