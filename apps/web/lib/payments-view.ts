import type { PaymentsOverview } from '@rede-social/module-payments/contracts';
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

/** What the Configuração tab renders, in the order the admin does the setup. */
export interface SetupView {
  integration: IntegrationView;
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

/** The whole Configuração view from one overview read. */
export function overviewView(overview: PaymentsOverview, t: PaymentsTranslator): SetupView {
  return { integration: integrationView(overview, t) };
}
