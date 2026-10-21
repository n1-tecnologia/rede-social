import type { AccessProduct, PaymentsOverview } from '@rede-social/module-payments/contracts';
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
