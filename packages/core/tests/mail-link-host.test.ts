import { resolveBranding } from '@rede-social/contracts';
import { describe, expect, it } from 'vitest';
import { publicWebOrigin } from '../server/env';
import { isLinkActionType, rehomedSignupRedirect, SIGNUP_CONFIRM_PATH } from '../server/mail/index';
import {
  decideMailTenant,
  type MailTenantFacts,
  type MailTenantResolution,
} from '../server/tenancy/mail-tenant';

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

  it('row 6a: a hostless signup mail for an identity with exactly one membership wears that tenant', () => {
    expect(
      decideMailTenant(
        facts({ actionType: 'signup', belongsSomewhere: true, onlyMembershipTenantId: A }),
      ),
    ).toEqual({ kind: 'tenant', tenantId: A, via: 'membership' });
  });

  it('row 6a: with two memberships a hostless signup mail is still refused (row 7)', () => {
    expect(
      decideMailTenant(
        facts({ actionType: 'signup', belongsSomewhere: true, onlyMembershipTenantId: null }),
      ),
    ).toEqual({ kind: 'refused', reason: 'redirect_host_not_tenant' });
  });

  it('row 6a is signup only: a hostless magiclink with one membership is still refused', () => {
    expect(
      decideMailTenant(
        facts({ actionType: 'magiclink', belongsSomewhere: true, onlyMembershipTenantId: A }),
      ),
    ).toEqual({ kind: 'refused', reason: 'redirect_host_not_tenant' });
  });

  it('row 6a does not touch row 5: a signup on host H without membership there is refused', () => {
    expect(
      decideMailTenant(facts({ actionType: 'signup', hostTenantId: H, onlyMembershipTenantId: A })),
    ).toEqual({ kind: 'refused', reason: 'redirect_host_not_member' });
  });

  it('row 6a does not beat row 1: a platform admin stays neutral', () => {
    expect(
      decideMailTenant(
        facts({
          actionType: 'signup',
          isPlatformAdmin: true,
          belongsSomewhere: true,
          onlyMembershipTenantId: A,
        }),
      ),
    ).toEqual({ kind: 'neutral', via: 'platform_admin' });
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

/**
 * quick 261012-s0v: the re-home of a `site_url`-fallback signup link. Pure: the host comes from the
 * resolution (`primaryHost`, a verified AND primary `tenant_domains` row), never from a payload.
 */
function tenantResolution(over: Partial<MailTenantResolution> = {}): MailTenantResolution {
  return {
    kind: 'tenant',
    via: 'membership',
    tenantId: A,
    slug: 'a',
    displayName: 'Tenant A',
    status: 'active',
    branding: resolveBranding(null),
    primaryHost: 'h.example',
    hostMatched: false,
    ...over,
  } as MailTenantResolution;
}

describe('rehomedSignupRedirect', () => {
  it('re-homes a hostless signup link onto the verified primary host at the confirm path', () => {
    expect(rehomedSignupRedirect(tenantResolution(), 'signup')).toBe(
      `${publicWebOrigin('h.example')}${SIGNUP_CONFIRM_PATH}`,
    );
    expect(rehomedSignupRedirect(tenantResolution(), 'signup')).toBe(
      `${publicWebOrigin('h.example')}/auth/confirm?next=/inicio`,
    );
  });

  it('never rewrites a link whose host already was a verified tenant host (hostMatched)', () => {
    expect(rehomedSignupRedirect(tenantResolution({ hostMatched: true }), 'signup')).toBeNull();
  });

  it('leaves the link alone when the tenant has no verified primary host', () => {
    expect(rehomedSignupRedirect(tenantResolution({ primaryHost: null }), 'signup')).toBeNull();
  });

  it('is signup only: recovery, invite and magiclink are untouched', () => {
    for (const actionType of ['recovery', 'invite', 'magiclink']) {
      expect(rehomedSignupRedirect(tenantResolution(), actionType), actionType).toBeNull();
    }
  });

  it('does nothing for a neutral or a refused resolution', () => {
    expect(rehomedSignupRedirect({ kind: 'neutral', via: 'no_tenant' }, 'signup')).toBeNull();
    expect(
      rehomedSignupRedirect({ kind: 'refused', reason: 'redirect_host_not_tenant' }, 'signup'),
    ).toBeNull();
  });
});
