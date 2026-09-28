import postgres from 'postgres';
import { envValue } from './admin';
import { createThrowawayTenant, deleteTenantBySlug, throwawayOrigin } from './tenant-fixtures';

/**
 * Fixtures for the DIRECTORY states (03-05 Task 2).
 *
 * The seeded `rede-demo` community has nine active members, which is enough to prove search and a
 * member profile but says nothing about the keyset second page: with a page size of 25 the
 * "Carregar mais" button never appears. So this module provisions a THROWAWAY tenant with
 * 27 active members — two past the page boundary — plus the two memberships the 404 matrix needs
 * (one blocked, one soft-deleted) and an admin who must stay invisible (D-47).
 *
 * Identity goes through the GoTrue admin API (`createUser`) and the membership through a direct
 * superuser connection — the same split `e2e/admin.ts` uses, and the reason both credentials are
 * required. Display names and bios are written straight into `member_profiles` afterwards: the
 * `app.ensure_member_profile` trigger seeds the row from `users.name`, and this fixture needs names
 * whose SORT ORDER is known, because the whole point is to prove that page two continues page one
 * without a gap, a duplicate or a re-order.
 */

/** Two past the 25-row page: page one is full, page two carries the remainder. */
export const MEMBERS_TENANT_SIZE = 27;

/** The 60-character name and 150-character bio the truncation case needs (E4/overflow, long-text). */
const LONG_NAME = 'Membro 01 Alcântara Buarque de Vasconcelos Figueiredo Nunes';
const LONG_BIO =
  'Escrevo sobre a comunidade, organizo os encontros de sábado, cuido do acervo de fotos antigas e ainda arrumo tempo para responder todo mundo.';

/** Superuser connection for fixtures only — never used by application code. */
let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeMembersAdmin(): Promise<void> {
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

async function deleteUser(id: string): Promise<void> {
  await fetch(`${envValue('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export type ThrowawayMember = {
  email: string;
  userId: string;
  membershipId: string;
  displayName: string;
  bio: string | null;
};

export type MembersTenant = {
  slug: string;
  host: string;
  /** `http://<host>:3000` locally — the origin every navigation in the spec must use. */
  origin: string;
  tenantId: string;
  /** The `MEMBERS_TENANT_SIZE` ACTIVE members, in the order the directory must list them. */
  members: ThrowawayMember[];
  /**
   * Whom the spec signs in as: the first active member (UI-D-03 — they see themselves in the list),
   * or the admin when the tenant was created with `size: 0`.
   */
  caller: ThrowawayMember;
  password: string;
  /** Absent from the directory (D-47) and openable only by the 404 matrix's expectations. */
  admin: ThrowawayMember;
  blocked: ThrowawayMember;
  softDeleted: ThrowawayMember;
};

/** Runs `jobs` with a small concurrency so 30 GoTrue creates do not become 30 round trips in series. */
async function inBatches<T>(jobs: (() => Promise<T>)[], size = 6): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < jobs.length; i += size) {
    out.push(...(await Promise.all(jobs.slice(i, i + size).map((job) => job()))));
  }
  return out;
}

/**
 * The display name of member `n` (1-based). Zero-padded so the ASCII sort the directory pages on
 * (`app.imm_unaccent(lower(display_name))`) is also the numeric order a human reads — `Membro 09`
 * before `Membro 10`, which an unpadded name would get wrong and hide a real paging bug behind a
 * plausible-looking list. Member 01 carries the 60-character name the truncation case needs.
 */
export function memberName(n: number): string {
  return n === 1 ? LONG_NAME : `Membro ${String(n).padStart(2, '0')} Teste`;
}

async function addMembership(
  tenantId: string,
  slug: string,
  email: string,
  password: string,
  role: 'member' | 'admin_tenant',
  status: 'active' | 'blocked',
  profile: { displayName: string; bio: string | null },
): Promise<ThrowawayMember> {
  const userId = await createUser(email, password);
  const rows = await sql()<{ id: string }[]>`
    insert into public.memberships (tenant_id, user_id, role, status, blocked_at)
    values (${tenantId}::uuid, ${userId}::uuid, ${role}, ${status},
            ${status === 'blocked' ? sql()`now()` : null})
    returning id`;
  const membershipId = rows[0]?.id;
  if (!membershipId) throw new Error(`could not create a membership for ${email} in ${slug}`);

  // The trigger already inserted the profile from `users.name` (empty here) — name it deliberately.
  await sql()`
    update public.member_profiles
       set display_name = ${profile.displayName}, bio = ${profile.bio}, updated_at = now()
     where membership_id = ${membershipId}::uuid`;

  return { email, userId, membershipId, displayName: profile.displayName, bio: profile.bio };
}

/**
 * Provisions `slug` with `MEMBERS_TENANT_SIZE` active members, an admin, a blocked membership and a
 * soft-deleted one. Idempotent: a leftover from an interrupted run is torn down first.
 *
 * Member 01 carries a 60-character name and a 150-character bio (truncation), member 02 carries no
 * bio at all (the single-line row), and the rest carry a short bio.
 */
export async function createMembersTenant(
  slug: string,
  password: string,
  size: number = MEMBERS_TENANT_SIZE,
): Promise<MembersTenant> {
  await deleteMembersTenant(slug);

  const host = `${slug}.localhost`;
  const { id: tenantId } = await createThrowawayTenant({
    slug,
    displayName: `Comunidade ${slug}`,
    hosts: [{ host, primary: true, verified: true }],
    colors: { primary: '#2e6fd0', secondary: '#7aa7e8' },
  });

  const mail = (local: string) => `${local}@${slug}.local`;

  const members = await inBatches(
    Array.from({ length: size }, (_, index) => () => {
      const n = index + 1;
      const bio = n === 1 ? LONG_BIO : n === 2 ? null : `Bio do membro ${n}.`;
      return addMembership(
        tenantId,
        slug,
        mail(`m${String(n).padStart(2, '0')}`),
        password,
        'member',
        'active',
        {
          displayName: memberName(n),
          bio,
        },
      );
    }),
  );
  members.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const [admin, blocked, softDeleted] = await Promise.all([
    addMembership(tenantId, slug, mail('admin'), password, 'admin_tenant', 'active', {
      displayName: `Admin de ${slug}`,
      bio: 'Cuido desta comunidade.',
    }),
    addMembership(tenantId, slug, mail('bloqueado'), password, 'member', 'blocked', {
      displayName: 'Membro Bloqueado',
      bio: null,
    }),
    addMembership(tenantId, slug, mail('removido'), password, 'member', 'active', {
      displayName: 'Membro Removido',
      bio: null,
    }),
  ]);

  // The soft delete is the real one the API's predicate reads — a row, not a deletion.
  await sql()`
    update public.memberships set deleted_at = now()
     where id = ${softDeleted.membershipId}::uuid`;

  // `size: 0` is the deliberately EMPTY community: the caller is then the admin, who is excluded
  // from the directory by D-47's predicate, so the list is genuinely empty rather than filtered.
  const caller = members[0] ?? admin;

  return {
    slug,
    host,
    origin: throwawayOrigin(host),
    tenantId,
    members,
    caller,
    password,
    admin,
    blocked,
    softDeleted,
  };
}

/**
 * Removes the tenant, its memberships and every identity this fixture created for it.
 *
 * `media_assets` goes first: a spec that gave a member a photo (`stubUnfetchableAvatar`) leaves a
 * row pointing at the tenant, and that foreign key does NOT cascade — without this the tenant
 * delete fails and every later run inherits the leftovers.
 */
export async function deleteMembersTenant(slug: string): Promise<void> {
  const ids = await sql()<{ id: string }[]>`
    select u.id from public.users u where u.email like ${`%@${slug}.local`}`;
  await sql()`
    update public.member_profiles p
       set avatar_asset_id = null
      from public.tenants t
     where t.id = p.tenant_id and t.slug = ${slug}`;
  await sql()`
    delete from public.media_assets a
     using public.tenants t
     where t.id = a.tenant_id and t.slug = ${slug}`;
  await deleteTenantBySlug(slug);
  await inBatches(ids.map((row) => () => deleteUser(row.id)));
}

/**
 * Removes every throwaway community whose slug starts with `prefix`, including the identities they
 * created. Called before provisioning so a crashed run leaves nothing behind — each run uses a
 * FRESH slug (see below), so leftovers would otherwise accumulate in a developer's local database.
 */
export async function sweepMembersTenants(prefix: string): Promise<void> {
  const rows = await sql()<{ slug: string }[]>`
    select slug from public.tenants where slug like ${`${prefix}%`}`;
  for (const row of rows) await deleteMembersTenant(row.slug);
}

/**
 * A slug that is UNIQUE PER RUN.
 *
 * Both the web app and the API cache the host to tenant mapping for 60 s. Re-using one host across
 * runs therefore points a fresh session (minted for the NEW tenant id) at a cached mapping for the
 * tenant the previous run deleted, and every request is refused with `TENANT_HOST_MISMATCH` — which
 * the screens turn into a bounce back to `/entrar`. Whether a given test survives then depends on
 * where the 60 s window happens to fall, which is exactly the kind of flake that gets blamed on the
 * feature. A new host per run cannot collide with any cache entry.
 */
export function membersTenantSlug(prefix: string, project: string): string {
  const suffix = project.replace(/[^a-z0-9]/g, '').slice(0, 10);
  return `${prefix}-${suffix}-${Date.now().toString(36)}`;
}
