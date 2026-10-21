import { describe, expect, it } from 'vitest';
import {
  accessProductBodySchema,
  accessProductPatchSchema,
  gateBodySchema,
  isCheckoutLink,
  PAYMENTS_ISSUE_SET,
  PAYMENTS_ISSUES,
  PAYMENTS_PERMISSIONS,
  saveIntegrationBodySchema,
  storeMappingBodySchema,
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

describe('the checkout link rule (P43, T-09.1-45)', () => {
  it('accepts an https: URL with a host, a path, a query and a port', () => {
    for (const link of [
      'https://pay.example.com',
      'https://pay.example.com/checkout/abc?ref=1#top',
      'https://pay.example.com:8443/x',
      'https://sub.pay-example.com.br/p/123',
    ]) {
      expect(isCheckoutLink(link), link).toBe(true);
    }
  });

  it('refuses every other scheme, userinfo, whitespace, control characters and a missing host', () => {
    for (const link of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'http://pay.example.com',
      'ftp://pay.example.com',
      '//pay.example.com',
      'pay.example.com',
      'https://',
      'https:///path',
      'https://user:secret@pay.example.com',
      'https://@pay.example.com',
      'https://pay.example.com@evil.example.com',
      'https://pay.example .com',
      'https://pay.example.com/a b',
      'https://pay.example.com/\u0000',
      'https://pay.example.com/\n',
      `https://pay.example.com/${'a'.repeat(2048)}`,
      '',
    ]) {
      expect(isCheckoutLink(link), JSON.stringify(link)).toBe(false);
    }
  });

  it('accepts a link of exactly 2048 characters and refuses one of 2049', () => {
    const base = 'https://pay.example.com/';
    expect(isCheckoutLink(base + 'a'.repeat(2048 - base.length))).toBe(true);
    expect(isCheckoutLink(base + 'a'.repeat(2049 - base.length))).toBe(false);
  });
});

describe('accessProductBodySchema encodings (P42, P43)', () => {
  const ok = { name: 'Assinatura', externalProductId: 'prod-1' };

  it('trims the name and the gateway id and keeps their case', () => {
    expect(
      accessProductBodySchema.parse({ name: '  Plano  Ouro  ', externalProductId: '  AbC-1  ' }),
    ).toEqual({ name: 'Plano  Ouro', externalProductId: 'AbC-1' });
  });

  it('refuses a whitespace-only name with name_required and an empty id with product_id_required', () => {
    expect(issuesOf(accessProductBodySchema.safeParse({ ...ok, name: ' \t\n ' }))).toContain(
      'name_required',
    );
    expect(
      issuesOf(accessProductBodySchema.safeParse({ ...ok, externalProductId: '   ' })),
    ).toContain('product_id_required');
  });

  it('counts the gateway id in code points: 128 pass, 129 are product_id_too_long', () => {
    expect(
      accessProductBodySchema.safeParse({ ...ok, externalProductId: 'x'.repeat(128) }).success,
    ).toBe(true);
    expect(
      issuesOf(accessProductBodySchema.safeParse({ ...ok, externalProductId: 'x'.repeat(129) })),
    ).toContain('product_id_too_long');
    expect(
      accessProductBodySchema.safeParse({ ...ok, externalProductId: '😀'.repeat(128) }).success,
    ).toBe(true);
  });

  it('refuses a body without a name or without a gateway id and any unknown key', () => {
    expect(accessProductBodySchema.safeParse({ externalProductId: 'x' }).success).toBe(false);
    expect(accessProductBodySchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(accessProductBodySchema.safeParse({ ...ok, kind: 'store_product' }).success).toBe(false);
  });
});

describe('accessProductPatchSchema (P42, P44)', () => {
  it('accepts any single key', () => {
    expect(accessProductPatchSchema.safeParse({ name: 'Novo' }).success).toBe(true);
    expect(accessProductPatchSchema.safeParse({ externalProductId: 'p2' }).success).toBe(true);
    expect(accessProductPatchSchema.parse({ checkoutUrl: null })).toEqual({ checkoutUrl: null });
    expect(accessProductPatchSchema.parse({ checkoutUrl: '' })).toEqual({ checkoutUrl: null });
  });

  it('refuses an empty body with nothing_to_update, and a body of undefined keys', () => {
    expect(issuesOf(accessProductPatchSchema.safeParse({}))).toContain('nothing_to_update');
    expect(issuesOf(accessProductPatchSchema.safeParse({ name: undefined }))).toContain(
      'nothing_to_update',
    );
  });

  it('applies the creation rules to each key it carries', () => {
    expect(issuesOf(accessProductPatchSchema.safeParse({ name: '' }))).toContain('name_required');
    expect(issuesOf(accessProductPatchSchema.safeParse({ checkoutUrl: 'http://x.com' }))).toContain(
      'link_invalid',
    );
  });
});

describe('storeMappingBodySchema (A-P12, UI-D-524)', () => {
  it('accepts a gateway id alone and a gateway id with a link', () => {
    expect(storeMappingBodySchema.parse({ externalProductId: ' p-1 ' })).toEqual({
      externalProductId: 'p-1',
    });
    expect(
      storeMappingBodySchema.parse({
        externalProductId: 'p-1',
        checkoutUrl: 'https://pay.example.com/p-1',
      }),
    ).toEqual({ externalProductId: 'p-1', checkoutUrl: 'https://pay.example.com/p-1' });
  });

  it('refuses a link with no gateway id with gateway_product_id_required', () => {
    const noId = storeMappingBodySchema.safeParse({ checkoutUrl: 'https://pay.example.com/p' });
    expect(noId.success).toBe(false);
    expect(issuesOf(noId)).toContain('gateway_product_id_required');
    const blankId = storeMappingBodySchema.safeParse({
      externalProductId: '   ',
      checkoutUrl: 'https://pay.example.com/p',
    });
    expect(issuesOf(blankId)).toContain('gateway_product_id_required');
  });

  it('refuses a body with neither key: the API requires the explicit DELETE', () => {
    expect(issuesOf(storeMappingBodySchema.safeParse({}))).toContain('gateway_product_id_required');
  });

  it('refuses an invalid link and an over-long id with their own codes', () => {
    expect(
      issuesOf(
        storeMappingBodySchema.safeParse({ externalProductId: 'p', checkoutUrl: 'http://x.com' }),
      ),
    ).toContain('link_invalid');
    expect(
      issuesOf(storeMappingBodySchema.safeParse({ externalProductId: 'x'.repeat(129) })),
    ).toContain('product_id_too_long');
  });

  it('turns an empty link into no link', () => {
    expect(
      storeMappingBodySchema.parse({ externalProductId: 'p', checkoutUrl: '' }).checkoutUrl,
    ).toBeNull();
  });
});
