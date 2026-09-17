import { describe, expect, it } from 'vitest';
import { createFakeDomainProvider, fakeDomainProviderStats } from '../server/domains/fake';

/**
 * The `DOMAIN_PROVIDER=fake` contract (D-36): what every non-production environment runs, and what
 * the integration suite and the panel's TXT/expiry states rely on. No network, no database.
 */
describe('fake domain provider', () => {
  const provider = createFakeDomainProvider();

  it('is the fake and answers a CNAME routing record for a subdomain', async () => {
    expect(provider.name).toBe('fake');
    const check = await provider.addDomain('comunidade.cliente.test');
    expect(check.records).toEqual([
      {
        type: 'CNAME',
        name: 'comunidade.cliente.test',
        value: 'fake.tria-dns.test',
        purpose: 'routing',
      },
    ]);
    expect(check.ownershipVerified).toBe(true);
    expect(check.configured).toBe(false);
  });

  it('answers an A routing record for a 2-label apex', async () => {
    const records = await provider.getDnsRecords('cliente.test');
    expect(records).toEqual([
      { type: 'A', name: 'cliente.test', value: '203.0.113.10', purpose: 'routing' },
    ]);
  });

  it('needs-txt: adds the TXT ownership challenge at _vercel.<apex>, ownership false on add and true on verify', async () => {
    const host = 'needs-txt.cliente.test';
    const added = await provider.addDomain(host);
    expect(added.ownershipVerified).toBe(false);
    expect(added.configured).toBe(false);
    expect(added.records).toContainEqual({
      type: 'TXT',
      name: '_vercel.cliente.test',
      value: `vc-domain-verify=${host},fake`,
      purpose: 'ownership',
    });
    expect(added.records.filter((r) => r.purpose === 'routing')).toHaveLength(1);

    const verified = await provider.verify(host);
    expect(verified.ownershipVerified).toBe(true);
    expect(verified.configured).toBe(true);
  });

  it('never-verifies: verify keeps configured false (the expiry/poller hook); everything else verifies on the first check', async () => {
    const stuck = await provider.verify('never-verifies.cliente.test');
    expect(stuck.ownershipVerified).toBe(true);
    expect(stuck.configured).toBe(false);

    const ok = await provider.verify('ok.cliente.test');
    expect(ok).toMatchObject({ ownershipVerified: true, configured: true });
  });

  it('addDomain, getDnsRecords and verify answer the same record set for a host', async () => {
    const host = 'needs-txt.mesmo.cliente.test';
    const a = (await provider.addDomain(host)).records;
    const b = await provider.getDnsRecords(host);
    const c = (await provider.verify(host)).records;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('counts every call (the "no duplicate provider registration" test seam)', async () => {
    const before = fakeDomainProviderStats();
    await provider.addDomain('c1.cliente.test');
    await provider.getDnsRecords('c1.cliente.test');
    await provider.verify('c1.cliente.test');
    await provider.removeDomain('c1.cliente.test');
    const after = fakeDomainProviderStats();
    expect(after).toEqual({
      addDomain: before.addDomain + 1,
      getDnsRecords: before.getDnsRecords + 1,
      verify: before.verify + 1,
      removeDomain: before.removeDomain + 1,
    });
  });
});
