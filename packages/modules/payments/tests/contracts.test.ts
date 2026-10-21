import { describe, expect, it } from 'vitest';
import {
  accessProductBodySchema,
  gateBodySchema,
  PAYMENTS_ISSUE_SET,
  PAYMENTS_ISSUES,
  PAYMENTS_PERMISSIONS,
  saveIntegrationBodySchema,
} from '../contracts/index';
import { paymentsModule } from '../module';

/**
 * 09.1-09 (D-501, D-502, PAY-04, PAY-20): the admin API's contract surface and the manifest, with no
 * database. The schemas carry their issue code AS the Zod message, so a route `defaultHook` can lift
 * a failure into `details.payments` without a lookup table.
 */

const issuesOf = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('the manifest (D-501)', () => {
  it('has the payments key, no nav and no requires', () => {
    expect(paymentsModule.key).toBe('payments');
    expect(paymentsModule).not.toHaveProperty('nav');
    expect(paymentsModule).not.toHaveProperty('requires');
  });

  it('composes payments.manage for admin_tenant and no other role', () => {
    expect(PAYMENTS_PERMISSIONS.manage).toBe('payments.manage');
    expect(paymentsModule.defaultRolePermissions).toEqual({ admin_tenant: ['payments.manage'] });
  });

  it('names the event-prune sweep function', () => {
    expect(paymentsModule.sweepFunctions).toEqual(['payment_events_prune']);
  });
});

describe('the closed refusal vocabulary', () => {
  it('lists every code once and the Set mirrors it', () => {
    expect(new Set(PAYMENTS_ISSUES).size).toBe(PAYMENTS_ISSUES.length);
    expect([...PAYMENTS_ISSUE_SET].sort()).toEqual([...PAYMENTS_ISSUES].sort());
    for (const code of [
      'token_required',
      'provider_unavailable',
      'name_required',
      'name_too_long',
      'product_id_required',
      'product_id_too_long',
      'link_invalid',
      'gateway_product_id_required',
      'gateway_product_taken',
      'last_access_product',
      'gate_requires_setup',
      'nothing_to_update',
    ]) {
      expect(PAYMENTS_ISSUE_SET.has(code), code).toBe(true);
    }
  });
});

describe('saveIntegrationBodySchema (D-486, PAY-04)', () => {
  it('trims a token and accepts 1 to 512 characters', () => {
    expect(saveIntegrationBodySchema.parse({ token: '  abc  ' })).toEqual({ token: 'abc' });
    expect(saveIntegrationBodySchema.safeParse({ token: 'x'.repeat(512) }).success).toBe(true);
  });

  it('refuses an empty, whitespace-only and 513-character token', () => {
    const empty = saveIntegrationBodySchema.safeParse({ token: '' });
    expect(empty.success).toBe(false);
    expect(issuesOf(empty)).toContain('token_required');
    expect(saveIntegrationBodySchema.safeParse({ token: '   ' }).success).toBe(false);
    expect(saveIntegrationBodySchema.safeParse({ token: 'x'.repeat(513) }).success).toBe(false);
  });

  it('refuses an unknown key', () => {
    expect(saveIntegrationBodySchema.safeParse({ token: 'a', extra: 1 }).success).toBe(false);
  });
});

describe('accessProductBodySchema (D-502, PAY-20)', () => {
  const ok = { name: 'Assinatura', externalProductId: 'prod-1' };

  it('accepts a name and a gateway id with and without a link', () => {
    expect(accessProductBodySchema.safeParse(ok).success).toBe(true);
    expect(
      accessProductBodySchema.safeParse({ ...ok, checkoutUrl: 'https://pay.example.com/x' })
        .success,
    ).toBe(true);
  });

  it('turns an empty link into no link', () => {
    expect(accessProductBodySchema.parse({ ...ok, checkoutUrl: '' }).checkoutUrl).toBeNull();
    expect(accessProductBodySchema.parse({ ...ok, checkoutUrl: '   ' }).checkoutUrl).toBeNull();
  });

  it('refuses an http: link with link_invalid', () => {
    const result = accessProductBodySchema.safeParse({
      ...ok,
      checkoutUrl: 'http://pay.example.com',
    });
    expect(result.success).toBe(false);
    expect(issuesOf(result)).toContain('link_invalid');
  });

  it('refuses an 81 code-point name with name_too_long and counts an emoji once', () => {
    const long = accessProductBodySchema.safeParse({ ...ok, name: 'a'.repeat(81) });
    expect(issuesOf(long)).toContain('name_too_long');
    expect(accessProductBodySchema.safeParse({ ...ok, name: 'a'.repeat(80) }).success).toBe(true);
    expect(accessProductBodySchema.safeParse({ ...ok, name: '😀'.repeat(80) }).success).toBe(true);
    expect(accessProductBodySchema.safeParse({ ...ok, name: '😀'.repeat(81) }).success).toBe(false);
  });
});

describe('gateBodySchema (D-491, PAY-08)', () => {
  it('requires the boolean required', () => {
    expect(gateBodySchema.safeParse({}).success).toBe(false);
    expect(gateBodySchema.safeParse({ releaseExisting: true }).success).toBe(false);
    expect(gateBodySchema.safeParse({ required: 'true' }).success).toBe(false);
  });

  it('accepts required with or without releaseExisting and refuses unknown keys', () => {
    expect(gateBodySchema.parse({ required: true })).toEqual({ required: true });
    expect(gateBodySchema.parse({ required: true, releaseExisting: false })).toEqual({
      required: true,
      releaseExisting: false,
    });
    expect(gateBodySchema.safeParse({ required: false, extra: 1 }).success).toBe(false);
  });
});
