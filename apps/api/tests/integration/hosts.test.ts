import { hostTenantSchema } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS } from './setup';

/**
 * TENANT-02 / D-32 / D-35 / D-36 — the public by-host contract as the shell, proxy.ts and the manifest
 * route consume it. Every case uses its OWN throwaway host so the 60 s positive/negative cache in
 * `resolveTenantHost` never hands one case another case's answer (the cache is keyed by host only).
 *
 * The verified/unverified/alias cases attach throwaway `tenant_domains` rows to the seeded rede-lab
 * tenant and never touch `tenants`; the suspended case owns a throwaway tenant so rede-lab's status
 * is never flipped under a dev server sharing this database.
 */

type Envelope = { error: { code: string } };
type ByHost = ReturnType<typeof hostTenantSchema.parse>;

const RUN = Date.now();
const host = (n: number) => `hosts-test-${RUN}-${n}.localhost`;
const SUSPENDED_SLUG = `hosts-susp-${RUN}`.slice(0, 40);

let labId = '';
let suspendedId = '';

const byHost = (h: string) =>
  api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(h)}`);

beforeAll(async () => {
  const [lab] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = 'rede-lab'`;
  labId = lab?.id ?? '';
  if (!labId) throw new Error('seed missing: run pnpm db:seed');

  // Unverified alias (1), verified alias (2) on rede-lab.
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${labId}::uuid, ${host(1)}, false, null),
           (${labId}::uuid, ${host(2)}, false, now())`;

  // A suspended throwaway tenant with its own verified primary host (3) and a configured brand.
  const [suspended] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version, status, branding)
    values (${SUSPENDED_SLUG}, 'Comunidade Suspensa', 'Regras de teste.', 1, 'suspended',
            ${adminSql.json({ colors: { primary: '#B91C1C', secondary: '#F87171' } })})
    returning id`;
  suspendedId = suspended?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${suspendedId}::uuid, ${host(3)}, true, now())`;
});

afterAll(async () => {
  await adminSql`delete from public.tenant_domains where host in (${host(1)}, ${host(2)})`;
  await adminSql`delete from public.tenants where slug = ${SUSPENDED_SLUG}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('GET /v1/public/tenants/by-host — verified-only, brand-carrying, primary-aware', () => {
  it('1. an attached but UNVERIFIED host is unknown: 404 TENANT_NOT_FOUND (D-36, T-02-02)', async () => {
    const res = await byHost(host(1));
    expect(res.status).toBe(404);
    expect(((await res.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
  });

  it('2. the seeded primary host answers the exact strict body with the seeded brand (D-25)', async () => {
    const res = await byHost(HOSTS.lab);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const raw = (await res.json()) as Record<string, unknown>;
    // T-02-04: exactly these keys — brand and host facts only.
    expect(Object.keys(raw).sort()).toEqual(
      ['branding', 'displayName', 'isPrimary', 'primaryHost', 'slug', 'status'].sort(),
    );
    const body = hostTenantSchema.parse(raw);
    expect(body).toMatchObject({
      slug: 'rede-lab',
      displayName: 'Rede Lab',
      status: 'active',
      isPrimary: true,
      primaryHost: HOSTS.lab,
    });
    expect(Object.keys(body.branding).sort()).toEqual(
      ['colors', 'faviconUrl', 'iconUrls', 'logoUrl'].sort(),
    );
    expect(body.branding.colors.primary).toBe('#0f766e');
    expect(body.branding.colors.secondary).toBe('#14b8a6');
    expect(body.branding.colors.onPrimary).toBe('#ffffff');
    expect(body.branding.logoUrl).toBe('/seed-logos/rede-lab.svg');
  });

  it('3. a verified NON-primary alias resolves with isPrimary false and names the primary (D-35)', async () => {
    const res = await byHost(host(2));
    expect(res.status).toBe(200);
    const body = hostTenantSchema.parse(await res.json()) as ByHost;
    expect(body.slug).toBe('rede-lab');
    expect(body.isPrimary).toBe(false);
    expect(body.primaryHost).toBe(HOSTS.lab);
    expect(body.branding.colors.primary).toBe('#0f766e');
  });

  it('4. a suspended tenant’s verified host still resolves, with status "suspended" (D-32)', async () => {
    const res = await byHost(host(3));
    expect(res.status).toBe(200);
    const body = hostTenantSchema.parse(await res.json()) as ByHost;
    expect(body.status).toBe('suspended');
    expect(body.displayName).toBe('Comunidade Suspensa');
    expect(body.isPrimary).toBe(true);
    expect(body.primaryHost).toBe(host(3));
    // The brand is resolved from the stored source colors: lower-cased, derivations filled in.
    expect(body.branding.colors.primary).toBe('#b91c1c');
    expect(body.branding.colors.onPrimary).toBe('#ffffff');
    expect(body.branding.logoUrl).toBeNull();
  });

  it('5. a verified host of a tenant with branding {} answers the neutral brand (TENANT-02/empty)', async () => {
    // rede-lab has a brand; the assertion is on the resolver's behaviour for a row inserted WITHOUT
    // colors, so it uses the suspended throwaway tenant's shape checked in (4) as the positive and a
    // fresh empty-brand tenant here.
    const slug = `hosts-empty-${RUN}`.slice(0, 40);
    const [empty] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, 'Sem Marca', 'Regras de teste.', 1)
      returning id`;
    try {
      await adminSql`
        insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
        values (${empty?.id ?? ''}::uuid, ${host(5)}, true, now())`;
      const res = await byHost(host(5));
      expect(res.status).toBe(200);
      const body = hostTenantSchema.parse(await res.json()) as ByHost;
      expect(body.branding.logoUrl).toBeNull();
      expect(body.branding.colors.primary).toBe('#2e6fd0');
      expect(body.branding.colors.secondary).toBe('#5b9cf8');
    } finally {
      await adminSql`delete from public.tenants where slug = ${slug}`;
    }
  });

  it('6. the answer never names another tenant (adjacency: same colors would still be keyed by host)', async () => {
    const text = await (await byHost(HOSTS.lab)).text();
    expect(text).not.toContain('rede-demo');
    expect(text).not.toContain('#7c3aed');
  });
});
