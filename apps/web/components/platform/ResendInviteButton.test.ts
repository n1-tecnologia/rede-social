import { describe, expect, it } from 'vitest';
import { RESEND_REFUSAL_REASONS, resendReasonCopy } from './ResendInviteButton';

/**
 * The resend toast's reason mapping (WR-02/WR-03, 02-REVIEW IN-04 fixed in 08-08). The Admins tab
 * passes `no_verified_primary` the helper line's copy ("needs a verified domain"), so a resend on a
 * tenant that lost its verified primary host no longer toasts the generic "Tente novamente".
 */
const reasons = {
  email_in_use: 'copy-email-in-use',
  user_in_other_tenant: 'copy-other-tenant',
  no_verified_primary: 'copy-helper',
};

describe('resendReasonCopy', () => {
  it('maps every documented refusal, no_verified_primary included, to its copy', () => {
    expect(RESEND_REFUSAL_REASONS).toContain('no_verified_primary');
    expect(resendReasonCopy('email_in_use', reasons)).toBe('copy-email-in-use');
    expect(resendReasonCopy('user_in_other_tenant', reasons)).toBe('copy-other-tenant');
    expect(resendReasonCopy('no_verified_primary', reasons)).toBe('copy-helper');
  });

  it('falls back (undefined) for an unknown or absent reason, or a host that passed no copy', () => {
    expect(resendReasonCopy('already_accepted', reasons)).toBeUndefined();
    expect(resendReasonCopy('__proto__', reasons)).toBeUndefined();
    expect(resendReasonCopy(undefined, reasons)).toBeUndefined();
    expect(resendReasonCopy('no_verified_primary', undefined)).toBeUndefined();
    expect(resendReasonCopy('no_verified_primary', { email_in_use: 'x' })).toBeUndefined();
  });
});
