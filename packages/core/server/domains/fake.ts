import type { DnsRecord } from '@tria/contracts';
import type { DomainCheck, DomainProvider } from './types';

/**
 * `DOMAIN_PROVIDER=fake` — the env default and what every non-production environment runs (D-36:
 * "with the fake adapter the first check verifies", so attach -> verify -> resolve -> invite is
 * e2e-testable without Vercel). Deterministic per host, no network, no state beyond call counters:
 *
 *  - a subdomain (3+ labels) gets `CNAME <host> -> fake.tria-dns.test`, a 2-label apex gets
 *    `A <host> -> 203.0.113.10` (TEST-NET-3, never routable);
 *  - a host containing `needs-txt` also gets the TXT ownership challenge at `_vercel.<apex>` and
 *    `addDomain` reports `ownershipVerified: false` for it — the panel's TXT step (02-15) and the
 *    "TXT then verify" shape (RESEARCH Open Question 3) are exercised without a real provider;
 *  - `addDomain` always answers `configured: false` (the customer has not created the records yet);
 *  - `verify` answers `ownershipVerified: true` and `configured: true`, EXCEPT for a host containing
 *    `never-verifies`, which stays unconfigured forever — the expiry / poller tests need a host
 *    that never flips.
 *
 * The seed never reaches this adapter: seeded hosts are written verified directly (D-24).
 */

const ROUTING_CNAME_TARGET = 'fake.tria-dns.test';
const ROUTING_A_TARGET = '203.0.113.10';

const counters = { addDomain: 0, getDnsRecords: 0, verify: 0, removeDomain: 0 };

/** Test seam: how many times each provider method ran in this process (no duplicate registration). */
export function fakeDomainProviderStats(): {
  addDomain: number;
  getDnsRecords: number;
  verify: number;
  removeDomain: number;
} {
  return { ...counters };
}

const apexOf = (host: string): string => host.split('.').slice(-2).join('.');

function recordsFor(host: string): DnsRecord[] {
  const labels = host.split('.');
  const records: DnsRecord[] =
    labels.length >= 3
      ? [{ type: 'CNAME', name: host, value: ROUTING_CNAME_TARGET, purpose: 'routing' }]
      : [{ type: 'A', name: host, value: ROUTING_A_TARGET, purpose: 'routing' }];
  if (host.includes('needs-txt')) {
    records.push({
      type: 'TXT',
      name: `_vercel.${apexOf(host)}`,
      value: `vc-domain-verify=${host},fake`,
      purpose: 'ownership',
    });
  }
  return records;
}

export function createFakeDomainProvider(): DomainProvider {
  return {
    name: 'fake',
    async addDomain(host): Promise<DomainCheck> {
      counters.addDomain += 1;
      return {
        ownershipVerified: !host.includes('needs-txt'),
        configured: false,
        records: recordsFor(host),
      };
    },
    async getDnsRecords(host): Promise<DnsRecord[]> {
      counters.getDnsRecords += 1;
      return recordsFor(host);
    },
    async verify(host): Promise<DomainCheck> {
      counters.verify += 1;
      return {
        ownershipVerified: true,
        configured: !host.includes('never-verifies'),
        records: recordsFor(host),
      };
    },
    async removeDomain(): Promise<void> {
      counters.removeDomain += 1;
    },
  };
}
