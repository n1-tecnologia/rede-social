import { describe, expect, it } from 'vitest';
import { isLinkActionType } from '../server/mail/index';
import { decideMailTenant, type MailTenantFacts } from '../server/tenancy/mail-tenant';

/**
 * Send Email Hook — the flow-host decision table (D-315, D-317, D-23 kept for hostless link mails).
 * H is the tenant whose VERIFIED host is the `redirect_to` host, read uncached, so there is no
 * stale-cache case any more. Pure, no DB: one case per row 1-9 plus the precedence cases.
 */

const H = 'tenant-h';
const A = 'tenant-a';

function facts(over: Partial<MailTenantFacts> = {}): MailTenantFacts {
  const actionType = over.actionType ?? 'recovery';
  return {
    isPlatformAdmin: false,
    hostTenantId: null,
    hasMembershipInHost: false,
    hasOpenInviteInHost: false,
    actionType,
    linkRequired: isLinkActionType(actionType),
    belongsSomewhere: false,
    onlyMembershipTenantId: null,
    ...over,
  };
}

describe('decideMailTenant', () => {
  it('row 1: a platform admin gets the neutral mail', () => {
    expect(decideMailTenant(facts({ isPlatformAdmin: true }))).toEqual({
      kind: 'neutral',
      via: 'platform_admin',
    });
  });

  it('row order: a platform admin with a membership in H is still neutral', () => {
    expect(
      decideMailTenant(
        facts({ isPlatformAdmin: true, hostTenantId: H, hasMembershipInHost: true }),
      ),
    ).toEqual({ kind: 'neutral', via: 'platform_admin' });
  });

  it('row 2: a member of H is branded H by membership (any link type)', () => {
    for (const actionType of ['recovery', 'invite', 'magiclink']) {
      expect(
        decideMailTenant(facts({ actionType, hostTenantId: H, hasMembershipInHost: true })),
        actionType,
      ).toEqual({ kind: 'tenant', tenantId: H, via: 'membership' });
    }
  });

  it('row 2 beats row 4: a member’s recovery is `membership`, not `redirect_host`', () => {
    expect(
      decideMailTenant(
        facts({
          actionType: 'recovery',
          hostTenantId: H,
          hasMembershipInHost: true,
          hasOpenInviteInHost: true,
        }),
      ),
    ).toEqual({ kind: 'tenant', tenantId: H, via: 'membership' });
  });

  it('row 3: an open invite FOR H brands H by invite', () => {
    expect(
      decideMailTenant(facts({ actionType: 'invite', hostTenantId: H, hasOpenInviteInHost: true })),
    ).toEqual({ kind: 'tenant', tenantId: H, via: 'invite' });
  });

  it('row 4 (D-317): a recovery on H without membership or invite there is branded H', () => {
    expect(
      decideMailTenant(facts({ actionType: 'recovery', hostTenantId: H, belongsSomewhere: true })),
    ).toEqual({ kind: 'tenant', tenantId: H, via: 'redirect_host' });
  });

  it('row 5 (D-315): an invite on H without membership or invite there is refused', () => {
    expect(decideMailTenant(facts({ actionType: 'invite', hostTenantId: H }))).toEqual({
      kind: 'refused',
      reason: 'redirect_host_not_member',
    });
  });

  it('row 5: every other link type for a non-member on H is refused too', () => {
    for (const actionType of ['signup', 'email', 'magiclink', 'email_change']) {
      expect(decideMailTenant(facts({ actionType, hostTenantId: H })), actionType).toEqual({
        kind: 'refused',
        reason: 'redirect_host_not_member',
      });
    }
  });

  it('row 6: a non-link type tied to H for a non-member is neutral, never another brand', () => {
    expect(
      decideMailTenant(
        facts({ actionType: 'reauthentication', hostTenantId: H, onlyMembershipTenantId: A }),
      ),
    ).toEqual({ kind: 'neutral', via: 'no_tenant' });
  });

  it('row 7 (D-23 kept): a hostless link mail for someone who belongs somewhere is refused', () => {
    for (const actionType of ['recovery', 'invite']) {
      expect(decideMailTenant(facts({ actionType, belongsSomewhere: true })), actionType).toEqual({
        kind: 'refused',
        reason: 'redirect_host_not_tenant',
      });
    }
  });

  it('row 8: a hostless non-link mail wears the brand of the only membership', () => {
    expect(
      decideMailTenant(
        facts({
          actionType: 'password_changed_notification',
          belongsSomewhere: true,
          onlyMembershipTenantId: A,
        }),
      ),
    ).toEqual({ kind: 'tenant', tenantId: A, via: 'membership' });
  });

  it('row 8: a hostless non-link mail with two memberships (or none) is neutral', () => {
    expect(
      decideMailTenant(
        facts({ actionType: 'password_changed_notification', belongsSomewhere: true }),
      ),
    ).toEqual({ kind: 'neutral', via: 'no_tenant' });
    expect(decideMailTenant(facts({ actionType: 'reauthentication' }))).toEqual({
      kind: 'neutral',
      via: 'no_tenant',
    });
  });

  it('row 9: a hostless link mail for someone who belongs nowhere is neutral', () => {
    expect(decideMailTenant(facts({ actionType: 'recovery' }))).toEqual({
      kind: 'neutral',
      via: 'no_tenant',
    });
  });
});

describe('isLinkActionType', () => {
  it('is true for every GoTrue type whose mail carries a confirm link', () => {
    for (const type of ['invite', 'recovery', 'signup', 'email', 'magiclink', 'email_change']) {
      expect(isLinkActionType(type), type).toBe(true);
    }
  });

  it('is false for code-only and notification types', () => {
    for (const type of ['reauthentication', 'password_changed_notification']) {
      expect(isLinkActionType(type), type).toBe(false);
    }
  });
});
