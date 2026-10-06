import { describe, expect, it } from 'vitest';
import { type Membership, pickGenericMembership } from '../server/tenancy/membership';

/**
 * 08.1-01 (D-308, D-06): the generic-host rule `requireAuth` applies when the host is not a tenant
 * host (localhost, Vercel Preview, the platform host, no header). Pure, so every branch is pinned
 * here without a database; the 08.1-03 picker reuses the same function.
 */
const row = (
  tenantSlug: string,
  status: Membership['status'] = 'active',
  role: Membership['role'] = 'member',
): Membership => ({
  tenantId: `id-${tenantSlug}`,
  tenantSlug,
  tenantDisplayName: `Nome ${tenantSlug}`,
  role,
  status,
  tenantStatus: 'active',
});

const demo = row('rede-demo');
const lab = row('rede-lab', 'active', 'admin_tenant');

describe('pickGenericMembership — the generic-host choice rule', () => {
  it('1. a choice naming one of the rows selects it even when several exist', () => {
    expect(pickGenericMembership([demo, lab], 'rede-lab')).toEqual({
      kind: 'selected',
      membership: lab,
    });
    expect(pickGenericMembership([demo, lab], 'rede-demo')).toEqual({
      kind: 'selected',
      membership: demo,
    });
  });

  it('2. the choice is trimmed and lower-cased before it is compared', () => {
    expect(pickGenericMembership([demo, lab], '  REDE-LAB ')).toEqual({
      kind: 'selected',
      membership: lab,
    });
  });

  it('3. a choice naming no row of the caller is ignored, never an error', () => {
    expect(pickGenericMembership([demo, lab], 'outra-comunidade')).toEqual({
      kind: 'choice_required',
    });
    expect(pickGenericMembership([demo], 'rede-lab')).toEqual({
      kind: 'selected',
      membership: demo,
    });
  });

  it('4. an empty or whitespace choice is treated as absent', () => {
    expect(pickGenericMembership([demo, lab], '')).toEqual({ kind: 'choice_required' });
    expect(pickGenericMembership([demo, lab], '   ')).toEqual({ kind: 'choice_required' });
    expect(pickGenericMembership([demo, lab], null)).toEqual({ kind: 'choice_required' });
  });

  it.each([
    ['active', row('rede-demo', 'active')],
    ['invited', row('rede-demo', 'invited')],
    ['blocked', row('rede-demo', 'blocked')],
  ] as const)('5. one %s row is selected (single-tenant behaviour, unchanged)', (_, only) => {
    expect(pickGenericMembership([only], null)).toEqual({ kind: 'selected', membership: only });
  });

  it('6. zero rows is none', () => {
    expect(pickGenericMembership([], null)).toEqual({ kind: 'none' });
    expect(pickGenericMembership([], 'rede-demo')).toEqual({ kind: 'none' });
  });

  it('7. one active plus one blocked selects the active one', () => {
    const blocked = row('rede-demo', 'blocked');
    expect(pickGenericMembership([blocked, lab], null)).toEqual({
      kind: 'selected',
      membership: lab,
    });
  });

  it('8. two active rows without a valid choice is choice_required', () => {
    expect(pickGenericMembership([demo, lab], null)).toEqual({ kind: 'choice_required' });
  });

  it('9. two blocked rows is all_blocked', () => {
    expect(
      pickGenericMembership([row('rede-demo', 'blocked'), row('rede-lab', 'blocked')], null),
    ).toEqual({ kind: 'all_blocked' });
  });

  it('10. a choice still selects a blocked row it names (requireAuth then answers that block)', () => {
    const blocked = row('rede-demo', 'blocked');
    expect(pickGenericMembership([blocked, lab], 'rede-demo')).toEqual({
      kind: 'selected',
      membership: blocked,
    });
  });
});
