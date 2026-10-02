import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import type { EventPage } from '@rede-social/module-events/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixtureApp } from '../src/app';
import { passwordSession } from '../src/session';

/**
 * MOD-05 (D-347), against the seeded LOCAL stack: a rede-demo member's real session reads the seeded
 * events through the fixture app, so the kernel's auth, tenancy, module flag and tenant-lane
 * transaction all ran with nothing but the kernel contracts and the events module behind them.
 * Read-only: it writes nothing, so it needs no sweep.
 */

const DEMO_HOST = process.env.TENANT_DEMO_HOST ?? 'rede-demo.localhost';

/** `scripts/seed.ts` SEED_EVENT_IDS: e01..e07 per tenant (rede-demo `0d…`, rede-lab `0e…`). */
const demoEvent = (n: number) => `0d000000-0000-4000-8000-000000000e0${n}`;

let token = '';

async function list(period: 'upcoming' | 'past'): Promise<EventPage> {
  const res = await fixtureApp.request(`/v1/events?period=${period}&limit=25`, {
    headers: { authorization: `Bearer ${token}`, [TENANT_HOST_HEADER]: DEMO_HOST },
  });
  expect(res.status, `GET /v1/events?period=${period}`).toBe(200);
  return (await res.json()) as EventPage;
}

beforeAll(async () => {
  token = await passwordSession('member@rede-demo.local');
});

describe('reuse fixture against the seeded stack (MOD-05)', () => {
  it('1. a rede-demo member session lists the seeded events, and only rede-demo ones', async () => {
    const upcoming = await list('upcoming');
    const past = await list('past');
    const ids = new Set([...upcoming.items, ...past.items].map((event) => event.id));

    // Upcoming in person with a cover, online, cancelled-upcoming, long title; past and cancelled-past.
    for (const n of [1, 2, 5, 7]) expect(upcoming.items.map((e) => e.id)).toContain(demoEvent(n));
    for (const n of [4, 6]) expect(past.items.map((e) => e.id)).toContain(demoEvent(n));
    expect([...ids].some((id) => id.startsWith('0e000000-'))).toBe(false);
  });
});
