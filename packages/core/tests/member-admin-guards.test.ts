import { describe, expect, it } from 'vitest';
import {
  decideAccessChange,
  decideRoleChange,
  type LockedTarget,
} from '../server/tenancy/member-admin';

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

/**
 * 08-05 (ADMIN-02, D-332, T-08-26/27): the role-change decision. Same locked inputs as a block; the
 * integration suite proves the branches through `PUT …/role` and under concurrency.
 */
describe('decideRoleChange', () => {
  it('promotes a member to support or admin', () => {
    expect(decideRoleChange(target(), [ADMIN_A], ACTOR, 'support_tenant')).toEqual({
      outcome: 'write',
    });
    expect(decideRoleChange(target(), [ADMIN_A], ACTOR, 'admin_tenant')).toEqual({
      outcome: 'write',
    });
  });

  it('refuses the actor changing their own role (self), before anything else', () => {
    const own = target({ id: ADMIN_A, userId: ACTOR, role: 'admin_tenant' });
    expect(decideRoleChange(own, [ADMIN_A, ADMIN_B], ACTOR, 'member')).toEqual({
      outcome: 'refuse',
      refusal: 'self',
    });
    // Self wins even over invited, blocked, same role and last admin.
    expect(
      decideRoleChange({ ...own, invited: true, blocked: true }, [ADMIN_A], ACTOR, 'admin_tenant'),
    ).toEqual({ outcome: 'refuse', refusal: 'self' });
  });

  it('the self rule compares identities, never names: another person is acted on', () => {
    // Two memberships can share a display name; only the actor's own user id is refused.
    expect(
      decideRoleChange(target({ userId: 'someone-else' }), [ADMIN_A], ACTOR, 'support_tenant'),
    ).toEqual({ outcome: 'write' });
  });

  it('refuses an invited membership (not_active), even when the column also says blocked', () => {
    expect(decideRoleChange(target({ invited: true }), [ADMIN_A], ACTOR, 'admin_tenant')).toEqual({
      outcome: 'refuse',
      refusal: 'not_active',
    });
    expect(
      decideRoleChange(target({ invited: true, blocked: true }), [ADMIN_A], ACTOR, 'member'),
    ).toEqual({ outcome: 'refuse', refusal: 'not_active' });
  });

  it('refuses a blocked membership (blocked): unblock first', () => {
    expect(decideRoleChange(target({ blocked: true }), [ADMIN_A], ACTOR, 'admin_tenant')).toEqual({
      outcome: 'refuse',
      refusal: 'blocked',
    });
    // Even the role it already holds: a blocked membership is refused, never a silent no-op.
    expect(decideRoleChange(target({ blocked: true }), [ADMIN_A], ACTOR, 'member')).toEqual({
      outcome: 'refuse',
      refusal: 'blocked',
    });
  });

  it('the same role is a no-op (idempotent, no log row)', () => {
    expect(decideRoleChange(target(), [ADMIN_A], ACTOR, 'member')).toEqual({ outcome: 'noop' });
    const admin = target({ id: ADMIN_B, role: 'admin_tenant' });
    expect(decideRoleChange(admin, [ADMIN_B], ACTOR, 'admin_tenant')).toEqual({ outcome: 'noop' });
  });

  it('refuses demoting the only active admin (last_admin), to either lower role', () => {
    const only = target({ id: ADMIN_A, role: 'admin_tenant' });
    for (const role of ['member', 'support_tenant'] as const) {
      expect(decideRoleChange(only, [ADMIN_A], ACTOR, role)).toEqual({
        outcome: 'refuse',
        refusal: 'last_admin',
      });
    }
  });

  it('lets an admin demote another admin while a second active admin remains', () => {
    const other = target({ id: ADMIN_B, role: 'admin_tenant' });
    expect(decideRoleChange(other, [ADMIN_A, ADMIN_B], ACTOR, 'member')).toEqual({
      outcome: 'write',
    });
    expect(decideRoleChange(other, [ADMIN_A, ADMIN_B], ACTOR, 'support_tenant')).toEqual({
      outcome: 'write',
    });
  });

  it('the last-admin rule reads the active-admin SET: a non-admin target never trips it', () => {
    const support = target({ role: 'support_tenant' });
    expect(decideRoleChange(support, [], ACTOR, 'member')).toEqual({ outcome: 'write' });
    expect(decideRoleChange(support, [ADMIN_A], ACTOR, 'admin_tenant')).toEqual({
      outcome: 'write',
    });
  });
});
