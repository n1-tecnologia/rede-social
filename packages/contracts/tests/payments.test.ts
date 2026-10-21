import { describe, expect, it } from 'vitest';
import { ERROR_CODES, REAL_TENANT_DEFAULT_MODULES, TOGGLEABLE_MODULES } from '../src';
import { publicTenantSchema } from '../src/auth';
import type { DomainEventName, EventMap } from '../src/events';
import {
  ACCESS_EFFECTIVE_STATES,
  ACCESS_ROW_STATUSES,
  ACCESS_SOURCES,
  ACCESS_STATES,
  subscriptionStatusSchema,
} from '../src/payments';

/**
 * 09.1-02 (D-485, D-497, D-501): the published contract of the payment gate. The cut code is
 * one-way (the web app branches on it), the module key is appended LAST and stays out of the
 * default set, and the neutral enums are the vocabulary every later plan reads.
 */
describe('09.1 - the cut error code (D-497)', () => {
  it('SUBSCRIPTION_PENDING is a published error code, a sibling of MEMBERSHIP_BLOCKED', () => {
    expect(ERROR_CODES).toContain('SUBSCRIPTION_PENDING');
    expect(ERROR_CODES).toContain('MEMBERSHIP_BLOCKED');
  });
});

describe('09.1 - the payments module key (D-501)', () => {
  it('is appended LAST to TOGGLEABLE_MODULES', () => {
    expect(TOGGLEABLE_MODULES[TOGGLEABLE_MODULES.length - 1]).toBe('payments');
  });

  it('is not part of the default set of a new real tenant', () => {
    expect(REAL_TENANT_DEFAULT_MODULES as readonly string[]).not.toContain('payments');
  });
});

describe('09.1 - the neutral access vocabulary (D-485)', () => {
  it('names the two sources, the row statuses, the effective states and the request states', () => {
    expect(ACCESS_SOURCES).toEqual(['manual', 'gateway']);
    expect(ACCESS_ROW_STATUSES).toEqual(['active', 'inactive', 'blocked']);
    expect(ACCESS_EFFECTIVE_STATES).toEqual(['active', 'inactive', 'blocked', 'none']);
    expect(ACCESS_STATES).toEqual(['open', 'granted', 'cut', 'blocked']);
  });
});

describe('09.1 - the payment domain events', () => {
  it('membership.access_cut is a typed event carrying ids only', () => {
    const name: DomainEventName = 'membership.access_cut';
    const payload: EventMap['membership.access_cut'] = {
      tenantId: 'a',
      userId: 'b',
      membershipId: 'c',
    };
    expect(name).toBe('membership.access_cut');
    expect(Object.keys(payload).sort()).toEqual(['membershipId', 'tenantId', 'userId']);
  });

  it('payments.purchase_confirmed names the product, never the money', () => {
    const name: DomainEventName = 'payments.purchase_confirmed';
    const payload: EventMap['payments.purchase_confirmed'] = {
      tenantId: 'a',
      userId: 'b',
      productId: 'c',
      productName: 'Curso',
    };
    expect(name).toBe('payments.purchase_confirmed');
    expect(Object.keys(payload).sort()).toEqual(['productId', 'productName', 'tenantId', 'userId']);
  });
});

describe('09.1-10 - the member-facing reads (D-493, D-497, UI-D-532)', () => {
  it('the subscription status is exactly the tenant name and one nullable link', () => {
    expect(
      subscriptionStatusSchema.parse({
        tenantName: 'Rede Lab',
        checkoutUrl: 'https://pay.example.com',
      }),
    ).toEqual({ tenantName: 'Rede Lab', checkoutUrl: 'https://pay.example.com' });
    expect(subscriptionStatusSchema.parse({ tenantName: 'Rede Lab', checkoutUrl: null })).toEqual({
      tenantName: 'Rede Lab',
      checkoutUrl: null,
    });
    expect(subscriptionStatusSchema.safeParse({ tenantName: 'Rede Lab' }).success).toBe(false);
    expect(
      subscriptionStatusSchema.safeParse({ tenantName: 'x', checkoutUrl: null, extra: 1 }).success,
    ).toBe(false);
  });

  it('the public tenant record gains one optional link and still parses an old answer', () => {
    const base = {
      slug: 'rede-lab',
      displayName: 'Rede Lab',
      rulesText: 'r',
      rulesVersion: 1,
      termsVersion: 1,
    };
    expect(publicTenantSchema.parse(base)).toEqual(base);
    expect(
      publicTenantSchema.parse({ ...base, accessCheckoutUrl: 'https://pay.example.com' }),
    ).toEqual({ ...base, accessCheckoutUrl: 'https://pay.example.com' });
    expect(publicTenantSchema.safeParse({ ...base, accessCheckoutUrl: 42 }).success).toBe(false);
  });
});
