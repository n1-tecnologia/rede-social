import postgres from 'postgres';
import { hosts } from './fixtures';

/**
 * Fixtures for specs that need their OWN tenant (aliases, unverified hosts, a suspended status): the
 * seed tenants are shared by the whole suite and their hosts sit in two 60 s caches (web + API), so
 * a spec must never flip tria-demo/tria-lab. Everything here goes through the same superuser
 * connection `admin.ts` uses (`PLAYWRIGHT_DB_URL`, local default) — application code never does this.
 *
 * Hosts must be `<something>.localhost`: Chromium resolves them to loopback and `next.config.ts`
 * allows `*.localhost` dev origins; Node cannot resolve them, so only the browser navigates there.
 */

const SLUG = /^[a-z0-9-]{3,40}$/;

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeTenantFixtures(): Promise<void> {
  await client?.end();
  client = null;
}

export type ThrowawayHost = {
  host: string;
  primary: boolean;
  /** `false` inserts the row with `verified_at` null and status `pending` (D-36: never resolves). */
  verified: boolean;
};

export type ThrowawayTenant = {
  slug: string;
  displayName: string;
  hosts: ThrowawayHost[];
  colors: { primary: string; secondary: string };
  logoUrl?: string | null;
  status?: 'active' | 'suspended';
};

/**
 * Inserts a tenant (rules text, brand jsonb — `resolveBranding` derives the missing keys) and one
 * `tenant_domains` row per host. Returns the tenant id. Idempotent on the slug: a leftover from an
 * interrupted run is removed first.
 */
export async function createThrowawayTenant(input: ThrowawayTenant): Promise<{ id: string }> {
  if (!SLUG.test(input.slug)) throw new Error(`invalid throwaway slug: ${input.slug}`);
  await deleteTenantBySlug(input.slug);

  const branding = {
    logoUrl: input.logoUrl ?? null,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    colors: input.colors,
  };
  const rows = await sql()<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding, rules_text, status)
    values (${input.slug}, ${input.displayName}, ${sql().json(branding)}, 'Regras de teste.',
            ${input.status ?? 'active'})
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create tenant ${input.slug}`);

  for (const h of input.hosts) {
    await sql()`
      insert into public.tenant_domains
        (tenant_id, host, is_primary, verified_at, verification_status)
      values (${id}::uuid, ${h.host.toLowerCase()}, ${h.primary},
              ${h.verified ? sql()`now()` : null}, ${h.verified ? 'verified' : 'pending'})`;
  }
  return { id };
}

/** Flips a tenant between `active` and `suspended` (D-32). */
export async function setTenantStatus(slug: string, status: 'active' | 'suspended'): Promise<void> {
  const updated = await sql()`
    update public.tenants set status = ${status} where slug = ${slug} returning id`;
  if (updated.length === 0) throw new Error(`no tenant ${slug}`);
}

/**
 * Removes the tenant and everything that points at it. `tenant_domains`, `tenant_modules` and
 * `tenant_invites` cascade; memberships and consent records do not (by design), so they go first.
 */
export async function deleteTenantBySlug(slug: string): Promise<void> {
  const rows = await sql()<{ id: string }[]>`select id from public.tenants where slug = ${slug}`;
  const id = rows[0]?.id;
  if (!id) return;
  await sql()`delete from public.consent_records where tenant_id = ${id}::uuid`;
  await sql()`delete from public.memberships where tenant_id = ${id}::uuid`;
  await sql()`delete from public.tenants where id = ${id}::uuid`;
}

/** Scheme + port of `hosts.generic` around the given host (`http://<host>:3000` locally). */
export function throwawayOrigin(host: string): string {
  const generic = new URL(hosts.generic);
  return `${generic.protocol}//${host}${generic.port ? `:${generic.port}` : ''}`;
}
