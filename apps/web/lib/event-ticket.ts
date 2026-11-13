import { formatBrl, parseBrlToCents } from '@rede-social/contracts/money';
import {
  EVENT_MAX_TICKET_PRICE_CENTS,
  EVENT_MIN_TICKET_PRICE_CENTS,
  type EventTicketAdmin,
} from '@rede-social/module-events/contracts';
import { priceInputText } from './store-view';

/**
 * The paid event's pure helpers (Phase 10.1-08, D-744, D-746, D-747, D-755, D-757, UI-D-741 to
 * UI-D-743, UI-D-766): the purchase-link guard, the price label and the form's section state.
 *
 * **Clock-free and side-effect-free.** Nothing here reads the clock, the environment or a
 * network: every value arrives as an argument and every answer is data or a finished value, so the
 * server and the hydration agree and a unit test needs no fake timers.
 *
 * **No arithmetic on the price.** The reference price is a label the member reads, never an amount
 * the platform charges (D-507): nothing in this file multiplies, divides or compares it with
 * another price. The only comparison is the admin's input against the contract's own bounds.
 */

/**
 * The ONE guard of every buy `href` (T-10.1-24, UI-D-766): the URL only when it parses, its
 * protocol is exactly `https:` and it carries no credentials; anything else (`http:`,
 * `javascript:`, `data:`, a relative path, garbage, a missing value) is `null`. A `null` turns the
 * buy control into the "sale unavailable" state, never into a link. The value is the PARSED href, so
 * the string that reaches the anchor has no control characters.
 *
 * The link is read per request from the API payload; it is never taken from a query string, a
 * cookie or client state.
 */
export function safeCheckoutHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * `8000` -> `R$ 80,00` (`formatBrl`, U+00A0 after the symbol), or `null` for no price. A value that is
 * not a positive integer (a null, an undefined, a float, a zero) reads as "no price": the label is
 * optional and a malformed one is not worth an error screen.
 */
export function formatTicketPrice(cents: number | null | undefined): string | null {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents <= 0) return null;
  return formatBrl(cents);
}

/** What the price field holds after a parse: a real price, none (an empty field is valid) or a typo. */
export type TicketPriceParse = { ok: true; cents: number | null } | { ok: false };

/**
 * The price field's text -> integer cents (UI-D-741): empty is valid and means "no reference price",
 * a pt-BR price within the contract's bounds is its cents (`parseBrlToCents`, integer arithmetic
 * only), everything else (`abc`, `19.90`, `0`, a price above the cap) is not a price.
 */
export function parseTicketPrice(text: string): TicketPriceParse {
  if (text.trim() === '') return { ok: true, cents: null };
  const cents = parseBrlToCents(text);
  if (cents === null) return { ok: false };
  if (cents < EVENT_MIN_TICKET_PRICE_CENTS || cents > EVENT_MAX_TICKET_PRICE_CENTS) {
    return { ok: false };
  }
  return { ok: true, cents };
}

/** The stored cents -> the field's text (`80,00`), the echo on blur and the edit form's initial value. */
export function ticketPriceText(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isSafeInteger(cents) && cents > 0
    ? priceInputText(cents)
    : '';
}

/* ── UI-D-742: the states of the Ingresso section ─────────────────────────────────────────────── */

/**
 * The section's state, first match wins (UI-D-742):
 *  - `locked` (a): at least one paid presence; the switch and the product fields are disabled and the
 *    price stays editable;
 *  - `moduleOff` (b): the Pagamentos module is off and nothing is linked;
 *  - `notConnected` (c): the module is on, the gateway is not connected and nothing is linked;
 *  - `linkedUnavailable` (d): a product is linked but the module is off or the gateway disconnected;
 *  - `recurring` (e): the save answer carried the subscription hint; the fields stay editable;
 *  - `free` (f): nothing linked, module on and connected (or a linked product with everything on).
 */
export type TicketSectionKind =
  | 'locked'
  | 'moduleOff'
  | 'notConnected'
  | 'linkedUnavailable'
  | 'recurring'
  | 'free';

export type TicketSectionInput = {
  /** Whether a product is linked to the event (the edit read's `ticket` object is non-null). */
  linked: boolean;
  /** The Pagamentos module flag of the tenant. */
  moduleOn: boolean;
  /** Whether the tenant has a connected gateway (meaningful only with the module on). */
  gatewayConnected: boolean;
  /** Whether the viewer holds `payments.manage` (the "Abrir Pagamentos" link needs it). */
  canManagePayments: boolean;
  /** Paid presences so far (courtesies and early Vou excluded, D-747). */
  soldCount: number;
  /** True ONLY when the last save answer carried the recurring hint (A-UI-10), never from a pre-check. */
  recurring?: boolean;
};

export type TicketSectionState = {
  kind: TicketSectionKind;
  /** The "Cobrar ingresso" switch cannot be flipped. */
  switchDisabled: boolean;
  /** The product id and the purchase link cannot be edited. */
  fieldsDisabled: boolean;
  /** The reference price cannot be edited (never: it is cosmetic, A-UI-3). */
  priceDisabled: boolean;
  /** The sold count the locked notice reads (0 outside `locked`). */
  soldCount: number;
  /** The "Abrir Pagamentos" text link exists (`notConnected` and `payments.manage` only). */
  openPaymentsLink: boolean;
  /** The non-blocking subscription warning under the id field. */
  recurringHint: boolean;
};

export function ticketSectionState(input: TicketSectionInput): TicketSectionState {
  const sold = Number.isFinite(input.soldCount) ? Math.max(0, Math.trunc(input.soldCount)) : 0;
  const base = {
    switchDisabled: false,
    fieldsDisabled: false,
    priceDisabled: false,
    soldCount: 0,
    openPaymentsLink: false,
    recurringHint: false,
  };

  if (sold > 0) {
    return {
      ...base,
      kind: 'locked',
      switchDisabled: true,
      fieldsDisabled: true,
      soldCount: sold,
      recurringHint: input.recurring === true,
    };
  }
  if (!input.linked && !input.moduleOn) {
    return { ...base, kind: 'moduleOff', switchDisabled: true };
  }
  if (!input.linked && !input.gatewayConnected) {
    return {
      ...base,
      kind: 'notConnected',
      switchDisabled: true,
      openPaymentsLink: input.canManagePayments,
    };
  }
  if (input.linked && (!input.moduleOn || !input.gatewayConnected)) {
    return { ...base, kind: 'linkedUnavailable', switchDisabled: true, fieldsDisabled: true };
  }
  if (input.recurring === true) {
    return { ...base, kind: 'recurring', recurringHint: true };
  }
  return { ...base, kind: 'free' };
}

/* ── UI-D-743: the server's refusals as the form's field errors ───────────────────────────────── */

/** The catalog keys under `form.ticket.errors.` the form can show. */
export type TicketErrorKey =
  | 'idRequired'
  | 'linkRequired'
  | 'linkInvalid'
  | 'idTaken'
  | 'priceInvalid'
  | 'locked';

/** Where each error is drawn: under its input, or as the alert row at the top of the section. */
export type TicketFieldErrors = {
  id?: TicketErrorKey;
  link?: TicketErrorKey;
  price?: TicketErrorKey;
  section?: TicketErrorKey;
};

const ISSUE_ERRORS: Readonly<
  Record<string, { field: keyof TicketFieldErrors; key: TicketErrorKey }>
> = {
  gateway_product_id_required: { field: 'id', key: 'idRequired' },
  product_id_required: { field: 'id', key: 'idRequired' },
  link_required: { field: 'link', key: 'linkRequired' },
  link_invalid: { field: 'link', key: 'linkInvalid' },
  gateway_product_taken: { field: 'id', key: 'idTaken' },
  ticket_locked: { field: 'section', key: 'locked' },
};

/**
 * The form's field errors from what failed (UI-D-743): the mapping endpoint's issue (a machine code
 * from `details.payments`, anything outside the map is ignored so the caller shows the generic
 * toast instead) and the price text. An empty price is valid; a price that does not parse (or leaves
 * the contract's bounds) shows under the price input. Errors clear on the next edit of their field,
 * which is the caller's: this function holds no state.
 */
export function ticketFieldErrors(input: {
  issue?: string | null;
  priceText?: string;
}): TicketFieldErrors {
  const errors: TicketFieldErrors = {};
  const mapped = input.issue ? ISSUE_ERRORS[input.issue] : undefined;
  if (mapped) errors[mapped.field] = mapped.key;
  if (input.priceText !== undefined && !parseTicketPrice(input.priceText).ok) {
    errors.price = 'priceInvalid';
  }
  return errors;
}

/* ── Phase 10.1-11: what the server hands the event form's Ingresso section ───────────────────── */

/** What the server knows about the event's ticket when it renders the form (the two pages build it). */
export type EventFormTicket = {
  /** The Pagamentos module flag of the tenant, off the bootstrap. */
  moduleOn: boolean;
  /** Module on AND a connected gateway (the edit read's `gatewayOpen`, else the Pagamentos overview). */
  gatewayConnected: boolean;
  /** The viewer holds `payments.manage` (the "Abrir Pagamentos" link needs it). */
  canManagePayments: boolean;
  /** The adapter's display name; `null` when the server has none (the catalog's neutral fallback). */
  gatewayName: string | null;
  /** The stored pair, or `null` when no product is linked. */
  saved: { externalProductId: string; checkoutUrl: string } | null;
  /** Paid presences so far, read once per page render (never ticking). */
  soldCount: number;
  /** The event already has confirmed presences (the D-748 note). */
  hasConfirmed: boolean;
};

export type EventFormTicketInput = {
  /** The Pagamentos module flag of the tenant, off the bootstrap. */
  moduleOn: boolean;
  /** The viewer holds `payments.manage`. */
  canManagePayments: boolean;
  /**
   * The Pagamentos overview's integration, read only while the module is on AND the viewer holds
   * `payments.manage` (the route's own guard); `null` when it was not asked or could not be read.
   */
  integration: { gatewayName: string; connected: boolean } | null;
  /** Edit mode only: the edit read's `ticket` object and the event's confirmed count. */
  edit?: { ticket: EventTicketAdmin | null; confirmedCount: number } | null;
};

/**
 * The Ingresso section's server facts (UI-D-741, UI-D-742, A-11-GATEWAY), the one mapping both pages
 * share. A linked event takes its connection from the edit read (`gatewayOpen`, already "module on and a
 * connected gateway") and its gateway word from the read's own `gatewayName`, so the section can speak
 * with the module off; an unlinked one asks the Pagamentos overview, which only a `payments.manage`
 * holder with the module on can read. Whatever the server cannot know is the safe reading: not
 * connected, no gateway name (the catalog's neutral fallback), nothing sold.
 */
export function eventFormTicket(input: EventFormTicketInput): EventFormTicket {
  const stored = input.edit?.ticket ?? null;
  return {
    moduleOn: input.moduleOn,
    gatewayConnected: stored
      ? stored.gatewayOpen
      : input.moduleOn && input.integration?.connected === true,
    canManagePayments: input.canManagePayments,
    gatewayName: stored?.gatewayName ?? input.integration?.gatewayName ?? null,
    saved: stored
      ? { externalProductId: stored.externalProductId, checkoutUrl: stored.checkoutUrl ?? '' }
      : null,
    soldCount: stored?.soldCount ?? 0,
    hasConfirmed: (input.edit?.confirmedCount ?? 0) > 0,
  };
}
