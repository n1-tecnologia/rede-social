import { describe, expect, it } from 'vitest';
import { isLinkActionType } from '../server/mail/index';
import { decideLinkHostRefusal } from '../server/tenancy/mail-tenant';

/**
 * Send Email Hook — the link-host guard (quick 260929-g0s, T-02-26 kept, T-g0s-02). A tenant
 * recipient's LINK mail whose `redirect_to` host is not a verified host of that tenant is GoTrue's
 * `site_url` fallback (a redirect it dropped because the allow-list entry was not applied yet): the
 * hook refuses it instead of mailing a link on the wrong origin. Pure decision table, no DB.
 */

describe('decideLinkHostRefusal', () => {
  it('a redirect host verified for ANOTHER tenant is a mismatch for every type (D-23 kept)', () => {
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: 'B',
        linkRequired: false,
        redirectHostVerifiedForRecipient: false,
      }),
    ).toBe('tenant_host_mismatch');
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: 'B',
        linkRequired: true,
        redirectHostVerifiedForRecipient: false,
      }),
    ).toBe('tenant_host_mismatch');
  });

  it('a link on a host that is no tenant host (the site_url fallback) is refused', () => {
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: null,
        linkRequired: true,
        redirectHostVerifiedForRecipient: false,
      }),
    ).toBe('redirect_host_not_tenant');
  });

  it('a link on a verified host of the recipient tenant passes', () => {
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: 'A',
        linkRequired: true,
        redirectHostVerifiedForRecipient: true,
      }),
    ).toBeNull();
  });

  it('a non-link mail (notification, reauthentication code) is never refused for its host', () => {
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: null,
        linkRequired: false,
        redirectHostVerifiedForRecipient: false,
      }),
    ).toBeNull();
  });

  it('the database verdict wins over a stale negative host-cache entry', () => {
    expect(
      decideLinkHostRefusal({
        recipientTenantId: 'A',
        hostTenantId: null,
        linkRequired: true,
        redirectHostVerifiedForRecipient: true,
      }),
    ).toBeNull();
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
