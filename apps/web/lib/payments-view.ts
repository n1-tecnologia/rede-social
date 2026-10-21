import { PAYMENTS_MAX_QUERY } from '@rede-social/contracts/payments';
import {
  ACCESS_ITEM_STATES,
  type AccessItem,
  type AccessItemState,
  type AccessProduct,
  type EventItem,
  type EventItemState,
  type PaymentsOverview,
} from '@rede-social/module-payments/contracts';
import type { getTranslations } from 'next-intl/server';
import { paymentsTabHref } from '@/app/(app)/configuracoes/pagamentos/tabs';
import { relativeFrom } from '@/lib/relative-time';

/**
 * THE formatter module for the Pagamentos screen (09.1-13, UI-D-514): every line the screen prints
 * from the overview is built here, from the overview and the SERVER's own clock (`serverNow`), so the
 * client components format nothing and never read a clock in render (UI-D-14).
 *
 * The view never decides who has access or whether the gate can be switched on: it renders the
 * server's flags (`connected`, `canEnable`) and the admin's intent travels the other way.
 *
 * Side-effect-free and clock-free. Keys are FULL (`payments.…`), like `lib/store-view.ts`.
 */

/** The same untyped translator every `lib/*-view` module takes. */
type Translator = Awaited<ReturnType<typeof getTranslations>>;
/** Exported for the client hosts that pass their root `useTranslations()` and for the tests. */
export type PaymentsTranslator = Translator;

/** The Integração card (UI-D-514): finished strings and flags. */
export interface IntegrationView {
  provider: string;
  /** The adapter's display name, the `{gateway}` of the admin copy. */
  gatewayName: string;
  connected: boolean;
  webhookUrl: string;
  /** "Último evento recebido há 3 min." or "Nenhum evento recebido ainda.", already finished. */
  lastEvent: string;
  /** The "Ver eventos" link exists only when an event was received. */
  showEventsLink: boolean;
  eventsHref: string;
}

/**
 * One access product row (UI-D-515): finished strings and flags. The raw `checkoutUrl` is kept for the
 * edit sheet's field only; it is never an `href` on this screen (T-09.1-62).
 */
export interface AccessProductView {
  id: string;
  name: string;
  externalProductId: string;
  checkoutUrl: string | null;
  /** "ID a1b2c3". */
  idMeta: string;
  hasLink: boolean;
  /** True on exactly one row of a list: the oldest product with a link feeds "Assinar" (A-UI-7). */
  feedsButton: boolean;
}

/** The gate flags exactly as the server sent them: the screen renders them, it never derives them. */
export interface GateView {
  required: boolean;
  canEnable: boolean;
}

/** What the Configuração tab renders, in the order the admin does the setup. */
export interface SetupView {
  /** The tenant's display name, for the helper line and the confirmation titles. */
  tenantName: string;
  integration: IntegrationView;
  /** Creation order, oldest first (the web never sorts). */
  products: AccessProductView[];
  gate: GateView;
}

/**
 * The relative formatter ends a sentence of its own ("há 3 min."); the catalog line adds its full
 * stop, so the formatter's is dropped to keep "Último evento recebido há 3 min." with a single one.
 */
function whenText(iso: string, serverNow: string): string {
  return relativeFrom(iso, new Date(serverNow).getTime()).replace(/\.$/, '');
}

export function integrationView(
  overview: PaymentsOverview,
  t: PaymentsTranslator,
): IntegrationView {
  const { integration, serverNow } = overview;
  const received = integration.lastEventAt !== null;
  return {
    provider: integration.provider,
    gatewayName: integration.gatewayName,
    connected: integration.connected,
    webhookUrl: integration.webhookUrl,
    lastEvent: received
      ? t('payments.setup.lastEvent', {
          when: whenText(integration.lastEventAt as string, serverNow),
        })
      : t('payments.setup.noEvent'),
    showEventsLink: received,
    eventsHref: paymentsTabHref('events'),
  };
}

export function accessProductView(
  product: AccessProduct,
  t: PaymentsTranslator,
): AccessProductView {
  return {
    id: product.id,
    name: product.name,
    externalProductId: product.externalProductId,
    checkoutUrl: product.checkoutUrl,
    idMeta: t('payments.products.idMeta', { externalId: product.externalProductId }),
    hasLink: product.checkoutUrl !== null,
    feedsButton: product.feedsSubscribeButton,
  };
}

/**
 * Re-marks a list after a local write (A-UI-7): exactly the FIRST product with a link, in the order
 * given, feeds "Assinar"; none when no product has a link. The server computes the same rule on every
 * read; this keeps the list honest between reads, since a single write answers only the row it
 * touched. Pure: the input is not mutated.
 */
export function withFeedsMark(products: readonly AccessProductView[]): AccessProductView[] {
  const feeder = products.find((product) => product.hasLink)?.id ?? null;
  return products.map((product) => ({ ...product, feedsButton: product.id === feeder }));
}

/** The gate flags, as sent. */
export function gateView(gate: PaymentsOverview['gate']): GateView {
  return { required: gate.required, canEnable: gate.canEnable };
}

/** The whole Configuração view from one overview read. */
export function overviewView(
  overview: PaymentsOverview,
  t: PaymentsTranslator,
  ctx: { tenantName: string },
): SetupView {
  return {
    tenantName: ctx.tenantName,
    integration: integrationView(overview, t),
    products: overview.accessProducts.map((product) => accessProductView(product, t)),
    gate: gateView(overview.gate),
  };
}

/* ── 09.1-14: the Acessos tab (UI-D-517, UI-D-518, UI-D-520) ───────────────────────────────────── */

/** The filter chips of the Acessos tab, in their order: "Todos" and the three real states. */
export const ACCESS_FILTERS = ['all', ...ACCESS_ITEM_STATES] as const;
export type AccessFilter = (typeof ACCESS_FILTERS)[number];

/**
 * `?status=` as the screen reads it: one of the chips, and anything else (unknown, repeated, empty,
 * another screen's value) reads as "Todos", never as a 400 from the URL.
 */
export function accessFilterFromParam(value: string | string[] | undefined): AccessFilter {
  if (typeof value !== 'string') return 'all';
  return (ACCESS_FILTERS as readonly string[]).includes(value) ? (value as AccessFilter) : 'all';
}

/**
 * `?q=` as the screen reads it: trimmed and capped at the contract's length BEFORE the API call, so a
 * hand-typed URL carrying a megabyte of "query" never reaches the API (which answers 400 over the cap).
 * Absent, repeated, empty and spaces-only are the same request.
 */
export function accessQueryFromParam(value: string | string[] | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, PAYMENTS_MAX_QUERY).trim();
}

/** The canonical Acessos URL for a query: `URLSearchParams` encoding; no search and "Todos" is the bare tab. */
export function accessListHref(q: string, status: AccessFilter): string {
  const base = paymentsTabHref('access');
  const search = new URLSearchParams();
  if (q) search.set('q', q);
  if (status !== 'all') search.set('status', status);
  const query = search.toString();
  return query ? `${base}&${query}` : base;
}

/** What the Acessos views need besides the item: the display name, the tenant clock zone, the server clock. */
export interface AccessViewCtx {
  /** The adapter's display name: the source word of every row that did not come from an admin. */
  gatewayName: string;
  /** The tenant's IANA zone, the only zone a date is ever written in. */
  timeZone: string;
  /** The server's clock for "Atualizado {when}": nothing here reads the browser's. */
  serverNow: string;
  /** The gate is on (`overview.gate.required`): with it off a block only counts once the gate is (A-P10). */
  gateRequired: boolean;
}

/** One Acessos row, finished (UI-D-517). */
export interface AccessRowView {
  id: string;
  email: string;
  state: AccessItemState;
  stateLabel: string;
  sourceLabel: string;
  /** As the server sent it; the row draws the "Ainda sem conta" pill only for `false`. */
  hasAccount: boolean;
  noAccountLabel: string;
  validityLabel: string;
}

const STATE_WORD: Record<AccessItemState, string> = {
  active: 'payments.states.active',
  subscription_pending: 'payments.states.pending',
  blocked: 'payments.states.blocked',
};

/** "12 de nov. de 2026": the long date in the tenant zone, `Intl` only. */
function longDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'medium' }).format(new Date(iso));
}

function validityText(validUntil: string | null, t: PaymentsTranslator, timeZone: string): string {
  return validUntil === null
    ? t('payments.access.noValidity')
    : t('payments.access.validUntil', { date: longDate(validUntil, timeZone) });
}

function sourceText(item: AccessItem, t: PaymentsTranslator, gatewayName: string): string {
  return item.source === 'manual' ? t('payments.access.sourceManual') : gatewayName;
}

/**
 * Finished strings for one access row. The state, the source, the account flag and the end date are the
 * SERVER's answer (`app.access_effective`, D-489): this only words them.
 */
export function accessRowView(
  item: AccessItem,
  t: PaymentsTranslator,
  ctx: Pick<AccessViewCtx, 'gatewayName' | 'timeZone'>,
): AccessRowView {
  return {
    id: item.id,
    email: item.email,
    state: item.state,
    stateLabel: t(STATE_WORD[item.state]),
    sourceLabel: sourceText(item, t, ctx.gatewayName),
    hasAccount: item.hasAccount,
    noAccountLabel: t('payments.access.noAccount'),
    validityLabel: validityText(item.validUntil, t, ctx.timeZone),
  };
}

/** The access sheet, finished (UI-D-518): the heading data, the three rows, the notes and the actions. */
export interface AccessSheetView {
  email: string;
  state: AccessItemState;
  stateLabel: string;
  sourceLabel: string;
  hasAccount: boolean;
  noAccountLabel: string;
  /** Origem, Situação and Validade: always three, never blank. */
  rows: { key: 'origin' | 'situation' | 'validity'; label: string; value: string }[];
  /** "Atualizado há 3 min", from the server's clock. */
  updated: string;
  /** The 12/400 notes by case, in order. */
  notes: string[];
  /** Which actions this case offers (D-489, D-504): the sheet draws exactly these. */
  actions: { block: boolean; unblock: boolean; removeRelease: boolean };
}

/**
 * The sheet's view of one row. **The actions follow the server's state and source, not a rule of the
 * web's:** a blocked row is only ever unblocked; a row that came from the gateway is only ever blocked
 * (the gateway owns it, so it cannot be removed by hand); a manual release can be blocked or removed.
 */
export function accessSheetView(
  item: AccessItem,
  t: PaymentsTranslator,
  ctx: AccessViewCtx,
): AccessSheetView {
  const blocked = item.state === 'blocked';
  const manual = item.source === 'manual';
  const stateLabel = t(STATE_WORD[item.state]);
  const sourceLabel = sourceText(item, t, ctx.gatewayName);
  const validity = validityText(item.validUntil, t, ctx.timeZone);

  const notes: string[] = [];
  if (blocked) {
    notes.push(t('payments.access.sheet.blockedNote'));
    // A-P10: a block is enforced by the gate, so with the gate off it holds nothing yet. The line is
    // the whole disclosure; the block is still stored and applies the moment the gate is switched on.
    if (!ctx.gateRequired) notes.push(t('payments.access.sheet.blockOffNote'));
  } else if (!manual) {
    notes.push(t('payments.access.sheet.gatewayNote', { gateway: ctx.gatewayName }));
  }

  return {
    email: item.email,
    state: item.state,
    stateLabel,
    sourceLabel,
    hasAccount: item.hasAccount,
    noAccountLabel: t('payments.access.noAccount'),
    rows: [
      { key: 'origin', label: t('payments.access.sheet.origin'), value: sourceLabel },
      { key: 'situation', label: t('payments.access.sheet.situation'), value: stateLabel },
      { key: 'validity', label: t('payments.access.sheet.validity'), value: validity },
    ],
    updated: t('payments.access.sheet.updated', { when: whenText(item.updatedAt, ctx.serverNow) }),
    notes,
    actions: {
      block: !blocked,
      unblock: blocked,
      removeRelease: manual && item.state === 'active',
    },
  };
}

/* ── 09.1-14: the Eventos tab (UI-D-519, UI-D-520, D-503) ──────────────────────────────────────── */

/** One Eventos row, finished (UI-D-519): the neutral event word, the e-mail, the product and the effect. */
export interface EventRowView {
  id: string;
  state: EventItemState;
  stateLabel: string;
  /** The catalog word for the gateway-NEUTRAL type, never the gateway's own trigger name. */
  name: string;
  /** The buyer's address, or "E-mail não informado" when the delivery carried none. */
  email: string;
  /** The mapped name, else "ID {externalId}" for an unmapped product, else `null` (no product line). */
  product: string | null;
  /** What the event did, from the outcome code; `null` when the server sends none. */
  effect: string | null;
  /** "recebido há 3 min", from the SERVER's clock. */
  received: string;
  /** "Liberar manualmente" exists on a no-account row only (the store grant). */
  canGrant: boolean;
  /** "Cadastrar produto" exists on an unknown-product row only. */
  canRegister: boolean;
}

const EVENT_STATE_WORD: Record<EventItemState, string> = {
  applied: 'payments.states.applied',
  no_account: 'payments.states.noAccount',
  unknown_product: 'payments.states.unknownProduct',
  ignored: 'payments.states.ignored',
};

/**
 * The effect line of an outcome. `currency_unsupported` (a store purchase in a currency other than BRL, so
 * nothing was granted) has NO approved wording in the Copywriting Contract, so it reads as the contract's
 * "Evento sem efeito no acesso", which is true of it. A closer line needs the design team (SUMMARY).
 */
const EFFECT_KEY: Record<NonNullable<EventItem['outcome']>, string> = {
  access_granted: 'access_granted',
  access_cut: 'access_cut',
  product_granted: 'product_granted',
  product_revoked: 'product_revoked',
  stale: 'stale',
  no_effect: 'no_effect',
  currency_unsupported: 'no_effect',
};

/**
 * Finished strings for one event. The state, the outcome and the type are the SERVER's words (the apply
 * job settled them, plan 07): this only writes them. No payload, header, signature or gateway message is
 * an input, so none can be an output (T-09.1-65).
 */
export function eventRowView(
  item: EventItem,
  t: PaymentsTranslator,
  ctx: { serverNow: string },
): EventRowView {
  const product =
    item.productName ??
    (item.externalProductId === null
      ? null
      : t('payments.events.idMeta', { externalId: item.externalProductId }));
  return {
    id: item.id,
    state: item.state,
    stateLabel: t(EVENT_STATE_WORD[item.state]),
    name: t(`payments.events.types.${item.type}`),
    email: item.email ?? t('payments.events.noEmail'),
    product,
    effect: item.outcome === null ? null : t(`payments.events.effects.${EFFECT_KEY[item.outcome]}`),
    received: t('payments.events.received', { when: whenText(item.receivedAt, ctx.serverNow) }),
    canGrant: item.state === 'no_account',
    canRegister: item.state === 'unknown_product',
  };
}

/** "Mostrando os últimos {count, plural, one {# evento} other {# eventos}}." */
export function eventsHeaderView(count: number, t: PaymentsTranslator): string {
  return t('payments.events.showing', { count });
}
