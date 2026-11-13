import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatBrl } from '@rede-social/contracts/money';
import { describe, expect, it } from 'vitest';
import {
  eventFormTicket,
  formatTicketPrice,
  parseTicketPrice,
  safeCheckoutHref,
  type TicketSectionInput,
  ticketFieldErrors,
  ticketPriceText,
  ticketSectionState,
} from './event-ticket';

/**
 * Phase 10.1-08 — the paid event's pure helpers: the purchase-link guard (T-10.1-24), the price label
 * (EP-23) and the Ingresso section's state machine (UI-D-742, UI-D-743).
 */

describe('safeCheckoutHref (T-10.1-24, UI-D-766)', () => {
  it('returns an https URL and nothing else', () => {
    expect(safeCheckoutHref('https://pay.example/x')).toBe('https://pay.example/x');
    expect(safeCheckoutHref('https://pay.example/x?a=1&b=2')).toBe('https://pay.example/x?a=1&b=2');
  });

  it('refuses http, javascript, data, relative paths and garbage', () => {
    for (const bad of [
      'http://x',
      'http://pay.example/x',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//pay.example/x',
      '/relative',
      'not a url',
      '',
      'https://',
    ]) {
      expect(safeCheckoutHref(bad), bad).toBeNull();
    }
  });

  it('refuses a missing value and credentials in the URL', () => {
    expect(safeCheckoutHref(null)).toBeNull();
    expect(safeCheckoutHref(undefined)).toBeNull();
    expect(safeCheckoutHref('https://user:pass@pay.example/x')).toBeNull();
  });

  it('returns the parsed href, so no control character reaches the anchor', () => {
    expect(safeCheckoutHref('https://pay.example/a\tb')).toBe('https://pay.example/ab');
  });
});

describe('formatTicketPrice: integer cents through formatBrl (EP-23)', () => {
  it('formats 8000, 1 and 10000000 exactly', () => {
    expect(formatTicketPrice(8000)).toBe('R$ 80,00');
    expect(formatTicketPrice(1)).toBe('R$ 0,01');
    expect(formatTicketPrice(10_000_000)).toBe('R$ 100.000,00');
    expect(formatTicketPrice(8000)).toBe(formatBrl(8000));
  });

  it('reads no price, a zero or a malformed one as no label', () => {
    for (const bad of [null, undefined, 0, -5, 80.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatTicketPrice(bad), String(bad)).toBeNull();
    }
  });
});

describe('the price field: parseTicketPrice and ticketPriceText (UI-D-741)', () => {
  it('an empty field is valid and means no reference price', () => {
    expect(parseTicketPrice('')).toEqual({ ok: true, cents: null });
    expect(parseTicketPrice('   ')).toEqual({ ok: true, cents: null });
  });

  it('parses pt-BR prices to integer cents', () => {
    expect(parseTicketPrice('80,00')).toEqual({ ok: true, cents: 8000 });
    expect(parseTicketPrice('80')).toEqual({ ok: true, cents: 8000 });
    expect(parseTicketPrice('1.234,50')).toEqual({ ok: true, cents: 123450 });
    expect(parseTicketPrice('0,01')).toEqual({ ok: true, cents: 1 });
    expect(parseTicketPrice('R$ 80,00')).toEqual({ ok: true, cents: 8000 });
  });

  it('refuses typos, zero, negatives and a price above the contract cap', () => {
    for (const bad of ['abc', '19.90', '0', '0,00', '-1', '80,999', '100.000,01']) {
      expect(parseTicketPrice(bad), bad).toEqual({ ok: false });
    }
    expect(parseTicketPrice('100.000,00')).toEqual({ ok: true, cents: 10_000_000 });
  });

  it('echoes cents back as the field text, and nothing for no price', () => {
    expect(ticketPriceText(8000)).toBe('80,00');
    expect(ticketPriceText(123450)).toBe('1.234,50');
    expect(ticketPriceText(1)).toBe('0,01');
    expect(ticketPriceText(null)).toBe('');
    expect(ticketPriceText(undefined)).toBe('');
    // What the form shows is what the form parses back.
    expect(parseTicketPrice(ticketPriceText(123450))).toEqual({ ok: true, cents: 123450 });
  });
});

describe('ticketSectionState: the precedence of UI-D-742, first match wins', () => {
  const input = (overrides: Partial<TicketSectionInput> = {}): TicketSectionInput => ({
    linked: false,
    moduleOn: true,
    gatewayConnected: true,
    canManagePayments: true,
    soldCount: 0,
    ...overrides,
  });

  it('(a) locked: at least one paid presence disables the switch and the product fields, never the price', () => {
    const state = ticketSectionState(input({ linked: true, soldCount: 3 }));
    expect(state).toMatchObject({
      kind: 'locked',
      switchDisabled: true,
      fieldsDisabled: true,
      priceDisabled: false,
      soldCount: 3,
    });
  });

  it('(a) beats every other state, even with the module off', () => {
    expect(ticketSectionState(input({ linked: true, soldCount: 1, moduleOn: false })).kind).toBe(
      'locked',
    );
    expect(
      ticketSectionState(input({ linked: true, soldCount: 1, recurring: true })),
    ).toMatchObject({ kind: 'locked', recurringHint: true });
  });

  it('(b) module off with nothing linked disables the switch', () => {
    expect(ticketSectionState(input({ moduleOn: false }))).toMatchObject({
      kind: 'moduleOff',
      switchDisabled: true,
      fieldsDisabled: false,
      openPaymentsLink: false,
    });
    // Module off wins over "not connected" when nothing is linked.
    expect(ticketSectionState(input({ moduleOn: false, gatewayConnected: false })).kind).toBe(
      'moduleOff',
    );
  });

  it('(c) module on but not connected: the switch is disabled and "Abrir Pagamentos" needs payments.manage', () => {
    expect(ticketSectionState(input({ gatewayConnected: false }))).toMatchObject({
      kind: 'notConnected',
      switchDisabled: true,
      openPaymentsLink: true,
    });
    expect(
      ticketSectionState(input({ gatewayConnected: false, canManagePayments: false })),
    ).toMatchObject({ kind: 'notConnected', openPaymentsLink: false });
  });

  it('(d) a product is linked but the module is off: switch on, everything disabled', () => {
    expect(ticketSectionState(input({ linked: true, moduleOn: false }))).toMatchObject({
      kind: 'linkedUnavailable',
      switchDisabled: true,
      fieldsDisabled: true,
    });
  });

  it('(d) a product is linked but the gateway is disconnected', () => {
    expect(ticketSectionState(input({ linked: true, gatewayConnected: false })).kind).toBe(
      'linkedUnavailable',
    );
  });

  it('(e) the recurring hint keeps the fields editable and only the save answer can raise it', () => {
    expect(ticketSectionState(input({ linked: true, recurring: true }))).toMatchObject({
      kind: 'recurring',
      recurringHint: true,
      fieldsDisabled: false,
      switchDisabled: false,
    });
    expect(ticketSectionState(input({ linked: true, recurring: false })).recurringHint).toBe(false);
  });

  it('(f) free: nothing linked, module on and connected is fully editable', () => {
    expect(ticketSectionState(input())).toEqual({
      kind: 'free',
      switchDisabled: false,
      fieldsDisabled: false,
      priceDisabled: false,
      soldCount: 0,
      openPaymentsLink: false,
      recurringHint: false,
    });
    // Linked with everything on is the same editable state.
    expect(ticketSectionState(input({ linked: true })).kind).toBe('free');
  });

  it('reads a malformed sold count as zero', () => {
    expect(ticketSectionState(input({ soldCount: Number.NaN })).kind).toBe('free');
    expect(ticketSectionState(input({ soldCount: -2 })).kind).toBe('free');
  });
});

describe('ticketFieldErrors: the server’s refusals as the form’s keys (UI-D-743)', () => {
  it('maps each mapping issue to its field and catalog key', () => {
    expect(ticketFieldErrors({ issue: 'gateway_product_id_required' })).toEqual({
      id: 'idRequired',
    });
    expect(ticketFieldErrors({ issue: 'link_required' })).toEqual({ link: 'linkRequired' });
    expect(ticketFieldErrors({ issue: 'link_invalid' })).toEqual({ link: 'linkInvalid' });
    expect(ticketFieldErrors({ issue: 'gateway_product_taken' })).toEqual({ id: 'idTaken' });
    expect(ticketFieldErrors({ issue: 'ticket_locked' })).toEqual({ section: 'locked' });
  });

  it('ignores an issue the form has no field for, so the caller shows the generic toast', () => {
    expect(ticketFieldErrors({ issue: 'provider_unavailable' })).toEqual({});
    expect(ticketFieldErrors({ issue: null })).toEqual({});
    expect(ticketFieldErrors({})).toEqual({});
  });

  it('flags a price that does not parse, and accepts an empty one', () => {
    expect(ticketFieldErrors({ priceText: 'abc' })).toEqual({ price: 'priceInvalid' });
    expect(ticketFieldErrors({ priceText: '' })).toEqual({});
    expect(ticketFieldErrors({ priceText: '80,00' })).toEqual({});
    expect(ticketFieldErrors({ issue: 'link_invalid', priceText: '19.90' })).toEqual({
      link: 'linkInvalid',
      price: 'priceInvalid',
    });
  });
});

describe('eventFormTicket: the server facts of the Ingresso section (10.1-11, A-11-GATEWAY)', () => {
  const OVERVIEW = { gatewayName: 'Gateway Exemplo', connected: true };
  const STORED = {
    externalProductId: 'PRD-48213',
    checkoutUrl: 'https://pagamento.exemplo.invalid/ingresso',
    gatewayOpen: true,
    soldCount: 3,
    gatewayName: 'Gateway Exemplo',
  };

  it('create mode, module on and a connected gateway: free, the overview names the gateway', () => {
    expect(
      eventFormTicket({ moduleOn: true, canManagePayments: true, integration: OVERVIEW }),
    ).toEqual({
      moduleOn: true,
      gatewayConnected: true,
      canManagePayments: true,
      gatewayName: 'Gateway Exemplo',
      saved: null,
      soldCount: 0,
      hasConfirmed: false,
    });
  });

  it('create mode, module on, gateway not connected', () => {
    const ticket = eventFormTicket({
      moduleOn: true,
      canManagePayments: true,
      integration: { gatewayName: 'Gateway Exemplo', connected: false },
    });
    expect(ticket.gatewayConnected).toBe(false);
    expect(ticket.gatewayName).toBe('Gateway Exemplo');
  });

  it('module off or an unreadable overview: not connected and no gateway word (the neutral fallback)', () => {
    for (const input of [
      { moduleOn: false, canManagePayments: false, integration: null },
      { moduleOn: true, canManagePayments: false, integration: null },
      { moduleOn: true, canManagePayments: true, integration: null },
    ]) {
      const ticket = eventFormTicket(input);
      expect(ticket.gatewayConnected).toBe(false);
      expect(ticket.gatewayName).toBeNull();
    }
  });

  it('a module that is off is never connected, even if an overview slipped through', () => {
    expect(
      eventFormTicket({ moduleOn: false, canManagePayments: true, integration: OVERVIEW })
        .gatewayConnected,
    ).toBe(false);
  });

  it('edit mode with a linked product: the stored pair, the count, gatewayOpen and the read’s own name', () => {
    const ticket = eventFormTicket({
      moduleOn: true,
      canManagePayments: true,
      integration: null,
      edit: { ticket: STORED, confirmedCount: 5 },
    });
    expect(ticket.saved).toEqual({
      externalProductId: 'PRD-48213',
      checkoutUrl: 'https://pagamento.exemplo.invalid/ingresso',
    });
    expect(ticket.soldCount).toBe(3);
    expect(ticket.gatewayConnected).toBe(true);
    expect(ticket.gatewayName).toBe('Gateway Exemplo');
    expect(ticket.hasConfirmed).toBe(true);
  });

  it('a linked product with the module off still speaks with the gateway name and reads as not open', () => {
    const ticket = eventFormTicket({
      moduleOn: false,
      canManagePayments: false,
      integration: null,
      edit: { ticket: { ...STORED, gatewayOpen: false }, confirmedCount: 0 },
    });
    expect(ticket.gatewayConnected).toBe(false);
    expect(ticket.gatewayName).toBe('Gateway Exemplo');
    expect(ticket.hasConfirmed).toBe(false);
  });

  it('a stored row with no link reads as an empty link, never null', () => {
    const ticket = eventFormTicket({
      moduleOn: true,
      canManagePayments: true,
      integration: OVERVIEW,
      edit: { ticket: { ...STORED, checkoutUrl: null, gatewayName: null }, confirmedCount: 0 },
    });
    expect(ticket.saved?.checkoutUrl).toBe('');
    expect(ticket.gatewayName).toBe('Gateway Exemplo');
  });

  it('edit mode with nothing linked asks the overview for the connection', () => {
    const ticket = eventFormTicket({
      moduleOn: true,
      canManagePayments: true,
      integration: OVERVIEW,
      edit: { ticket: null, confirmedCount: 2 },
    });
    expect(ticket.saved).toBeNull();
    expect(ticket.gatewayConnected).toBe(true);
    expect(ticket.hasConfirmed).toBe(true);
  });
});

describe('event-ticket.ts is clock-free', () => {
  it('reads no clock', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./event-ticket.ts', import.meta.url)),
      'utf8',
    );
    // Strip comments so the doc block may say the word.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now|new Date\(\)/);
  });
});
