import postgres from 'postgres';

/**
 * Spec-only helpers of the Marca tab spec (02-14). `admin.ts` is 02-12's (import only); this file
 * owns the two direct reads/writes the branding tests need — a VERIFIED primary host for the
 * throwaway tenant (so `GET /v1/public/tenants/by-host` answers for it) and the raw `branding`
 * jsonb — through the same superuser connection shape `admin.ts` uses. Application code never does
 * either. Values are read, never printed.
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeBrandingAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/**
 * Inserts a verified primary host for the tenant with `slug` — the same row 02-13's integration test
 * writes (`verified_at` is the resolver's predicate, `verification_status` the panel's).
 */
export async function insertVerifiedHost(slug: string, host: string): Promise<void> {
  const rows = await sql()`
    insert into public.tenant_domains (host, tenant_id, is_primary, verified_at, verification_status)
    select ${host}, t.id, true, now(), 'verified' from public.tenants t where t.slug = ${slug}
    returning id`;
  if (rows.length === 0) throw new Error(`tenant ${slug} not found for host ${host}`);
}

export type TenantBrandingRow = {
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  iconUrls: Record<string, string> | null;
  iconVersion: number;
  colors: { primary: string; secondary: string };
};

/** The raw `tenants.branding` jsonb of a slug, with every key defaulted (what the API persisted). */
export async function getTenantBranding(slug: string): Promise<TenantBrandingRow> {
  const rows = await sql()<{ branding: Record<string, unknown> | null }[]>`
    select branding from public.tenants where slug = ${slug}`;
  const b = rows[0]?.branding;
  if (!b) throw new Error(`tenant ${slug} not found`);
  const colors = (b.colors ?? {}) as { primary?: string; secondary?: string };
  return {
    logoUrl: (b.logoUrl as string | undefined) ?? null,
    iconUrl: (b.iconUrl as string | undefined) ?? null,
    faviconUrl: (b.faviconUrl as string | undefined) ?? null,
    iconUrls: (b.iconUrls as Record<string, string> | undefined) ?? null,
    iconVersion: (b.iconVersion as number | undefined) ?? 0,
    colors: { primary: colors.primary ?? '', secondary: colors.secondary ?? '' },
  };
}
