import { describe, expect, it } from 'vitest';
import { RESEND_REFUSAL_REASONS, resendReasonCopy } from './ResendInviteButton';

/**
 * The resend toast's reason mapping (D-316, 02-REVIEW IN-04 fixed in 08-08). The Admins tab
 * passes `no_verified_primary` the helper line's copy ("needs a verified domain"), so a resend on a
 * tenant that lost its verified primary host no longer toasts the generic "Tente novamente".
 * 08.1-06 (D-314): the single-tenant refusal is retired, so the only identity refusal left is
 * `email_in_use` (a platform account).
 */
const reasons = {
  email_in_use: 'copy-email-in-use',
  no_verified_primary: 'copy-helper',
};

describe('resendReasonCopy', () => {
  it('maps every documented refusal, no_verified_primary included, to its copy', () => {
    expect(RESEND_REFUSAL_REASONS).toContain('no_verified_primary');
    expect(resendReasonCopy('email_in_use', reasons)).toBe('copy-email-in-use');
    expect(resendReasonCopy('no_verified_primary', reasons)).toBe('copy-helper');
  });

  it('falls back (undefined) for an unknown or absent reason, or a host that passed no copy', () => {
    expect(resendReasonCopy('already_accepted', reasons)).toBeUndefined();
    // The retired single-tenant reason is not a documented refusal any more (D-314).
    expect(RESEND_REFUSAL_REASONS).toEqual(['email_in_use', 'no_verified_primary']);
    expect(resendReasonCopy('__proto__', reasons)).toBeUndefined();
    expect(resendReasonCopy(undefined, reasons)).toBeUndefined();
    expect(resendReasonCopy('no_verified_primary', undefined)).toBeUndefined();
    expect(resendReasonCopy('no_verified_primary', { email_in_use: 'x' })).toBeUndefined();
  });
});
