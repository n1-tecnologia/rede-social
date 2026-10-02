import { describe, expect, it } from 'vitest';
import { decideAccessChange, type LockedTarget } from '../server/tenancy/member-admin';

/**
 * 08-04 (MODER-02, D-332, T-08-20): the pure guard decision behind block and unblock. The integration
 * suite proves the same branches through the API and under concurrency; this pins every branch and
 * their ORDER without a database.
 */

const ACTOR = 'actor-user';
const ADMIN_A = 'm-admin-a';
const ADMIN_B = 'm-admin-b';

const target = (over: Partial<LockedTarget> = {}): LockedTarget => ({
  id: 'm-target',
  userId: 'target-user',
  role: 'member',
  invited: false,
  blocked: false,
  ...over,
});

describe('decideAccessChange — block', () => {
  it('blocks an active member', () => {
    expect(decideAccessChange(target(), [ADMIN_A], ACTOR, 'block')).toEqual({ outcome: 'write' });
  });

  it('refuses the actor aiming at their own membership (self), before anything else', () => {
    expect(decideAccessChange(target({ userId: ACTOR }), [ADMIN_A], ACTOR, 'block')).toEqual({
      outcome: 'refuse',
      refusal: 'self',
    });
    // Self wins even over invited, blocked and last-admin.
    expect(
      decideAccessChange(
        target({ id: ADMIN_A, userId: ACTOR, role: 'admin_tenant', invited: true, blocked: true }),
        [ADMIN_A],
        ACTOR,
        'block',
      ),
    ).toEqual({ outcome: 'refuse', refusal: 'self' });
  });

  it('refuses an invited membership (not_active), even when the column also says blocked', () => {
    expect(decideAccessChange(target({ invited: true }), [ADMIN_A], ACTOR, 'block')).toEqual({
      outcome: 'refuse',
      refusal: 'not_active',
    });
    expect(
      decideAccessChange(target({ invited: true, blocked: true }), [ADMIN_A], ACTOR, 'block'),
    ).toEqual({ outcome: 'refuse', refusal: 'not_active' });
  });

  it('an already-blocked membership is a no-op (idempotent, no log row)', () => {
    expect(decideAccessChange(target({ blocked: true }), [ADMIN_A], ACTOR, 'block')).toEqual({
      outcome: 'noop',
    });
  });

  it('refuses blocking the only active admin (last_admin)', () => {
    const only = target({ id: ADMIN_A, role: 'admin_tenant' });
    expect(decideAccessChange(only, [ADMIN_A], ACTOR, 'block')).toEqual({
      outcome: 'refuse',
      refusal: 'last_admin',
    });
  });

  it('lets an admin block another admin while a second active admin remains', () => {
    const other = target({ id: ADMIN_B, role: 'admin_tenant' });
    expect(decideAccessChange(other, [ADMIN_A, ADMIN_B], ACTOR, 'block')).toEqual({
      outcome: 'write',
    });
  });

  it('the last-admin rule reads the active-admin SET, not the role column', () => {
    // A blocked admin is not in the active set, so blocking a member while one admin remains is fine,
    // and a target that holds the role but is not an active admin is no last-admin case.
    const blockedAdmin = target({ id: ADMIN_B, role: 'admin_tenant', blocked: true });
    expect(decideAccessChange(blockedAdmin, [ADMIN_A], ACTOR, 'block')).toEqual({
      outcome: 'noop',
    });
    expect(decideAccessChange(target(), [], ACTOR, 'block')).toEqual({ outcome: 'write' });
  });
});

describe('decideAccessChange — unblock', () => {
  it('unblocks a blocked membership', () => {
    expect(decideAccessChange(target({ blocked: true }), [ADMIN_A], ACTOR, 'unblock')).toEqual({
      outcome: 'write',
    });
  });

  it('an already-active membership is a no-op (idempotent, no log row)', () => {
    expect(decideAccessChange(target(), [ADMIN_A], ACTOR, 'unblock')).toEqual({ outcome: 'noop' });
  });

  it('refuses self and invited exactly like a block', () => {
    expect(
      decideAccessChange(target({ userId: ACTOR, blocked: true }), [ADMIN_A], ACTOR, 'unblock'),
    ).toEqual({ outcome: 'refuse', refusal: 'self' });
    expect(decideAccessChange(target({ invited: true }), [ADMIN_A], ACTOR, 'unblock')).toEqual({
      outcome: 'refuse',
      refusal: 'not_active',
    });
  });

  it('has no last-admin check: unblocking an admin with an empty active set is allowed', () => {
    const admin = target({ id: ADMIN_B, role: 'admin_tenant', blocked: true });
    expect(decideAccessChange(admin, [], ACTOR, 'unblock')).toEqual({ outcome: 'write' });
  });
});
