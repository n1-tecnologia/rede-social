import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Review WR-03: the two readers that disclose a member's answers to OTHER people (the public block of a member
 * viewer, and the CSV export) carry the branch-chain visibility predicate, so an answer under a branch that is
 * CLOSED for its owner is never returned whatever is stored. The transaction helpers are mocked and the executed
 * statement is rendered to text; the behavior against real rows is covered by the integration suites of
 * `profile-form-answers` and `profile-form-export`.
 */
const dialect = new PgDialect();
const executed: string[] = [];

const tx = {
  execute: vi.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
    const text = dialect.sqlToQuery(statement).sql;
    executed.push(text);
    // targetOf and the exporter's own membership: one row; the file date: a day; everything else: no rows.
    if (text.includes('from memberships') || text.includes('public.memberships m')) {
      return [{ id: 'target' }];
    }
    if (text.includes('to_char(')) return [{ day: '2026-11-07' }];
    return [];
  }),
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [{ id: 'own' }] }) }),
  }),
};

vi.mock('../db/tenant-tx', () => ({
  withTenantTx: async (_ctx: unknown, run: (tx: unknown) => unknown) => run(tx),
}));
vi.mock('../db/admin-tx', () => ({
  withAdminTx: async (_ctx: unknown, run: (tx: unknown) => unknown) => run(tx),
}));
vi.mock('../server/profile-form/member', () => ({ liveModuleOn: async () => true }));
vi.mock('../server/moderation/log', () => ({ recordModerationAction: async () => undefined }));

import { publicAnswersOf } from '../server/profile-form/answers';
import { exportAnswers } from '../server/profile-form/export';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ctx = {
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: TENANT,
  role: 'member' as const,
};

/** The marks of the shared chain-visibility fragment (`visibility-sql.ts`). */
const CHAIN = ['app.profile_form_answer_tokens', 'public.profile_form_branches pfb1'];

describe('WR-03: readers that disclose answers to other people apply the branch chain', () => {
  beforeEach(() => {
    executed.length = 0;
    tx.execute.mockClear();
  });

  it('publicAnswersOf filters the answers by the chain of the question, keyed to the target membership', async () => {
    await publicAnswersOf(ctx, 'target');
    const statement = executed[executed.length - 1] ?? '';
    for (const mark of CHAIN) expect(statement).toContain(mark);
    expect(statement).toContain('q.show_on_profile');
    expect(statement).toContain('pfa1.membership_id = a.membership_id');
    expect(statement).toContain('pfb1.id = q.branch_id');
  });

  it('the export filters every member cell by the chain of the question for that member', async () => {
    const file = await exportAnswers(
      { ...ctx, role: 'admin_tenant', requestId: 'req-1' },
      { pageSize: 1 },
    );
    const reader = file.body.getReader();
    await reader.read(); // the header
    await reader.read(); // the first page
    const page = executed.find((text) => text.includes('jsonb_object_agg')) ?? '';
    expect(page).not.toBe('');
    for (const mark of CHAIN) expect(page).toContain(mark);
    expect(page).toContain('pfa1.membership_id = m.id');
    expect(page).toContain('pfb1.id = q.branch_id');
    await reader.cancel();
  });
});
