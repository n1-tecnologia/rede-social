import { describe, expect, it } from 'vitest';
import { ERROR_CODES, REAL_TENANT_DEFAULT_MODULES, TOGGLEABLE_MODULES } from '../src';
import { publicTenantSchema } from '../src/auth';
import type { DomainEventName, EventMap } from '../src/events';
import {
  ACCESS_EFFECTIVE_STATES,
  ACCESS_ROW_STATUSES,
  ACCESS_SOURCES,
  ACCESS_STATES,
  EVENT_ITEM_STATES,
  eventItemSchema,
  PAYMENT_EVENT_OUTCOMES,
  PAYMENT_PRODUCT_KINDS,
  PAYMENTS_ISSUES,
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
  it('was appended LAST by Phase 09.1 and is now the key directly before the last one', () => {
    // 12-02 (D-596) appends `profile_form` after it; the record of its position must survive.
    expect(TOGGLEABLE_MODULES[TOGGLEABLE_MODULES.length - 2]).toBe('payments');
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

  it('payments.ticket_confirmed names the event, never the money or the order (Phase 10.1, D-756)', () => {
    const name: DomainEventName = 'payments.ticket_confirmed';
    const payload: EventMap['payments.ticket_confirmed'] = {
      tenantId: 'a',
      userId: 'b',
      eventId: 'c',
      eventTitle: 'Encontro',
    };
    expect(name).toBe('payments.ticket_confirmed');
    expect(Object.keys(payload).sort()).toEqual(['eventId', 'eventTitle', 'tenantId', 'userId']);
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

describe('10.1 - the closed vocabularies of the event ticket (D-740, D-741, TICK-23)', () => {
  it('a mapping has three kinds: access, store_product, event', () => {
    expect([...PAYMENT_PRODUCT_KINDS]).toEqual(['access', 'store_product', 'event']);
  });

  it('the outcome list keeps the old values in order and appends the six ticket ones', () => {
    expect([...PAYMENT_EVENT_OUTCOMES]).toEqual([
      'access_granted',
      'access_cut',
      'product_granted',
      'product_revoked',
      'stale',
      'no_effect',
      'currency_unsupported',
      'ticket_granted',
      'ticket_granted_over_limit',
      'ticket_revoked',
      'ticket_kept',
      'event_ended',
      'event_cancelled',
    ]);
  });

  it('the Eventos list states are the four old ones plus event_ended and event_cancelled', () => {
    expect([...EVENT_ITEM_STATES]).toEqual([
      'applied',
      'no_account',
      'unknown_product',
      'ignored',
      'event_ended',
      'event_cancelled',
    ]);
  });

  it('the refusal list gains link_required, ticket_locked, event_ended and event_cancelled', () => {
    for (const code of ['link_required', 'ticket_locked', 'event_ended', 'event_cancelled']) {
      expect(PAYMENTS_ISSUES as readonly string[], code).toContain(code);
    }
  });

  it('the Eventos item stays strict: kind and eventTitle are the only keys added, both optional (D-758)', () => {
    const base = {
      id: '1d000000-0000-4000-8000-000000000001',
      type: 'purchase_approved',
      state: 'applied',
      email: null,
      productName: null,
      externalProductId: null,
      outcome: null,
      receivedAt: '2026-11-12T00:00:00.000000Z',
    };
    expect(eventItemSchema.safeParse(base).success).toBe(true);
    expect(
      eventItemSchema.safeParse({ ...base, kind: 'event', eventTitle: 'Encontro' }).success,
    ).toBe(true);
    expect(eventItemSchema.safeParse({ ...base, kind: 'event', eventTitle: null }).success).toBe(
      true,
    );
    expect(eventItemSchema.safeParse({ ...base, orderRef: 'x' }).success).toBe(false);
    expect(Object.keys(eventItemSchema.shape).sort()).toEqual([
      'email',
      'eventTitle',
      'externalProductId',
      'id',
      'kind',
      'outcome',
      'productName',
      'receivedAt',
      'state',
      'type',
    ]);
    expect(eventItemSchema.shape.kind.isOptional()).toBe(true);
    expect(eventItemSchema.shape.eventTitle.isOptional()).toBe(true);
  });

  it('no new value is anything but lowercase snake case (the neutrality walk owns the brand rule, TICK-20)', () => {
    for (const code of [...PAYMENT_PRODUCT_KINDS, ...PAYMENT_EVENT_OUTCOMES, ...PAYMENTS_ISSUES]) {
      expect(code, code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
