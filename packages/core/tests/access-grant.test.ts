import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Tx } from '../db/tenant-tx';
import { grantManualAccess } from '../server/tenancy/access';

/**
 * `grantManualAccess` (09.1-04, D-492), unit level: the statement it sends and how it reads the
 * answer. The behaviour against a real database (idempotency, a block beside a release, concurrency)
 * is proved in `apps/api/tests/integration/first-admin-access.test.ts`.
 */

const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

function fakeTx(rows: unknown[]) {
  const sent: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const built = new PgDialect().sqlToQuery(query);
      sent.push({ sql: built.sql, params: built.params });
      return rows;
    },
  } as unknown as Tx;
  return { tx, sent };
}

describe('grantManualAccess', () => {
  it('inserts a manual active row, normalising the e-mail in SQL, and answers true when a row came back', async () => {
    const { tx, sent } = fakeTx([{ id: 'a' }]);
    const inserted = await grantManualAccess(tx, {
      tenantId: TENANT_ID,
      email: '  Admin@Cliente.com.br ',
      createdBy: ADMIN_ID,
    });
    expect(inserted).toBe(true);
    expect(sent).toHaveLength(1);
    const { sql, params } = sent[0] ?? { sql: '', params: [] };
    expect(sql).toContain('insert into public.access_grants');
    expect(sql).toContain('lower(btrim($2))');
    expect(sql).toContain(`'manual', 'active'`);
    expect(params).toEqual([TENANT_ID, '  Admin@Cliente.com.br ', ADMIN_ID]);
  });

  it('is idempotent by construction: on conflict on the manual unique index it does nothing and answers false', async () => {
    const { tx, sent } = fakeTx([]);
    const inserted = await grantManualAccess(tx, {
      tenantId: TENANT_ID,
      email: 'admin@cliente.com.br',
      createdBy: null,
    });
    expect(inserted).toBe(false);
    expect(sent[0]?.sql).toContain(
      `on conflict (tenant_id, email, status) where source = 'manual' do nothing`,
    );
    expect(sent[0]?.params[2]).toBeNull();
  });

  it('never writes a blocked row and never reads or updates one', async () => {
    const { tx, sent } = fakeTx([]);
    await grantManualAccess(tx, { tenantId: TENANT_ID, email: 'a@b.test', createdBy: null });
    const text = sent[0]?.sql ?? '';
    expect(text).not.toContain('blocked');
    expect(text).not.toMatch(/\bupdate\b|\bdelete\b|\bselect\b/);
  });
});
