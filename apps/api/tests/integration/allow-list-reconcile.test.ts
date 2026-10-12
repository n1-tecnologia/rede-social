import { deriveBrandColors } from '@rede-social/contracts';
import { localAllowListEntries } from '@rede-social/core/server/domains/auth-allow-list';
import { allowListEntry } from '@rede-social/core/server/domains/types';
import { reconcileAuthAllowList } from '@rede-social/core/server/platform/reconcile-allow-list';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql } from './setup';

/**
 * `reconcileAuthAllowList` (quick 261012-s0v) against the live local stack with the LOCAL allow-list
 * ledger. Pins three things: only VERIFIED `tenant_domains` rows (`verified_at is not null`) get an
 * `https://<host>/auth/confirm**` entry — a pending host never does; the counts are
 * `{ hosts: <verified rows>, added: hosts, failed: 0 }` where `hosts` is whatever the table holds at
 * call time (seed hosts and residue included, read through `adminSql` right before the call — the
 * config runs files sequentially, so nothing moves in between); and a second call is idempotent.
 */

const RUN = Date.now();
const SLUG = `alr-${RUN}`;
const OK_HOST = `alr-${RUN}-ok.cliente.test`;
const PENDING_HOST = `alr-${RUN}-pending.cliente.test`;

let tenantId: string;

async function verifiedHostCount(): Promise<number> {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n from public.tenant_domains where verified_at is not null`;
  return Number(row?.n ?? 0);
}

beforeAll(async () => {
  const branding = {
    logoUrl: null,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    colors: deriveBrandColors({ primary: '#1d4ed8', secondary: '#60a5fa' }),
  };
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding)
    values (${SLUG}, ${'Allow-list Reconcile'}, ${adminSql.json(branding)})
    returning id`;
  if (!tenant) throw new Error('could not create the throwaway tenant');
  tenantId = tenant.id;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${OK_HOST}, true, now(), 'verified'),
           (${tenantId}::uuid, ${PENDING_HOST}, false, null, 'pending')`;
});

afterAll(async () => {
  // The tenant cascades its domains.
  if (tenantId) await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
  await adminSql.end();
});

describe('reconcileAuthAllowList', () => {
  it('ensures one entry per VERIFIED host, none for a pending one, and counts every verified row', async () => {
    const expectedHosts = await verifiedHostCount();
    expect(expectedHosts).toBeGreaterThanOrEqual(1);

    const result = await reconcileAuthAllowList();

    expect(result).toEqual({ hosts: expectedHosts, added: expectedHosts, failed: 0 });
    expect(localAllowListEntries.has(allowListEntry(OK_HOST))).toBe(true);
    expect(localAllowListEntries.has(allowListEntry(PENDING_HOST))).toBe(false);
  });

  it('is idempotent: a second call returns the same counts and the ledger is unchanged', async () => {
    const expectedHosts = await verifiedHostCount();
    const before = new Set(localAllowListEntries);

    const result = await reconcileAuthAllowList();

    expect(result).toEqual({ hosts: expectedHosts, added: expectedHosts, failed: 0 });
    expect(new Set(localAllowListEntries)).toEqual(before);
    expect(localAllowListEntries.has(allowListEntry(OK_HOST))).toBe(true);
    expect(localAllowListEntries.has(allowListEntry(PENDING_HOST))).toBe(false);
  });
});
