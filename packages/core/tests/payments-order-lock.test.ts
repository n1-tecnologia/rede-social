import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../db/tenant-tx';
import { appliedRefundExists, lockPaymentOrder } from '../server/payments/order-lock';

/**
 * WR-01 / EP-G5 (Phase 10.1, plan 17): the order lock key is a convention between API revisions. During a
 * rolling deploy an old revision's apply job and the new revision's manual release must still serialise, so
 * the key text and the hash seed are PINNED here by rendering the helper's SQL, not by a live database.
 * The integration cases in `apps/api/tests/integration/payments-events.test.ts` prove the same key against
 * a real lock held under the literal text.
 */

const TENANT = '2decdec5-0778-4620-bede-4fd47caa0d00';
const EVENT = '5d4e1454-8897-4e7d-a99b-ffdada283171';

/** A fake transaction that records the drizzle query object of every `execute` and answers a canned result. */
function fakeTx(result: unknown) {
  const calls: SQL[] = [];
  const tx = {
    execute: async (query: SQL) => {
      calls.push(query);
      return result;
    },
  } as unknown as Tx;
  return { tx, calls };
}

const render = (query: SQL) => new PgDialect().sqlToQuery(query);

describe('lockPaymentOrder', () => {
  it('runs exactly one statement: a transaction advisory lock on the hashed key text, seed 0', async () => {
    const { tx, calls } = fakeTx([]);
    await lockPaymentOrder(tx, TENANT, 'kiwify', 'ord-1');
    expect(calls).toHaveLength(1);
    const { sql: text } = render(calls[0] as SQL);
    const flat = text.replace(/\s+/g, ' ').trim();
    expect(flat).toContain('pg_advisory_xact_lock(');
    expect(flat).toContain('hashtextextended(');
    // tenant, provider and reference as text, joined by a colon: the key every revision builds
    expect(flat).toContain("$1::text || ':' || $2::text || ':' || $3::text, 0)");
    expect(flat.match(/::text \|\| ':' \|\| /g)).toHaveLength(2);
  });

  it('binds the tenant, the provider and the external reference, in that order', async () => {
    const { tx, calls } = fakeTx([]);
    await lockPaymentOrder(tx, TENANT, 'kiwify', 'ord-1');
    expect(render(calls[0] as SQL).params).toEqual([TENANT, 'kiwify', 'ord-1']);
  });
});

describe('appliedRefundExists', () => {
  it('binds the tenant, the provider, the reference and the excluded event id, and names the terminal facts', async () => {
    const { tx, calls } = fakeTx([{ found: false }]);
    await appliedRefundExists(tx, TENANT, 'kiwify', 'ord-1', EVENT);
    expect(calls).toHaveLength(1);
    const { sql: text, params } = render(calls[0] as SQL);
    expect(params).toEqual([TENANT, 'kiwify', 'ord-1', EVENT]);
    expect(text).toContain("state = 'applied'");
    expect(text).toContain("'purchase_refunded'");
    expect(text).toContain("'chargeback'");
    expect(text).toContain('id <> $4::uuid');
  });

  it('answers true when the statement returns found true', async () => {
    const { tx } = fakeTx([{ found: true }]);
    expect(await appliedRefundExists(tx, TENANT, 'kiwify', 'ord-1', EVENT)).toBe(true);
  });

  it('answers false when the statement returns found false or no row', async () => {
    expect(
      await appliedRefundExists(fakeTx([{ found: false }]).tx, TENANT, 'kiwify', 'ord-1', EVENT),
    ).toBe(false);
    expect(await appliedRefundExists(fakeTx([]).tx, TENANT, 'kiwify', 'ord-1', EVENT)).toBe(false);
  });
});
