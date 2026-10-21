import {
  type AccessPage,
  type EventsResponse,
  PAYMENTS_PERMISSIONS,
  type PaymentsOverview,
} from '@rede-social/module-payments/contracts';
import { buttonClasses, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getAccesses, getEvents, getOverview, PaymentsApiError } from '@/lib/payments';
import {
  type AccessFilter,
  accessFilterFromParam,
  accessQueryFromParam,
  overviewView,
  type PaymentsTranslator,
  type SetupView,
} from '@/lib/payments-view';
import { AccessList } from './AccessList';
import { EventsList } from './EventsList';
import { PaymentsTabs } from './PaymentsTabs';
import { SetupPanel } from './SetupPanel';
import { PAYMENTS_TABS, paymentsTabFromParam, paymentsTabHref } from './tabs';

/** What reading the overview came to: the view, a navigation, the screen not existing, or a failure. */
type SetupResult =
  | { status: 'ok'; view: SetupView }
  | { status: 'redirect'; path: string }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * Reads the overview and the finished view. Nothing here throws: a refusal the bootstrap knows is a
 * navigation, the module off or the permission lost since the bootstrap is the screen not existing
 * (the API answers 404 `MODULE_DISABLED` / 403 `FORBIDDEN`), and anything else is the error card.
 * The callers act on the result OUTSIDE any try/catch (Next 16: `notFound()` and `redirect()` throw).
 */
async function loadSetup(t: PaymentsTranslator, tenantName: string): Promise<SetupResult> {
  try {
    return { status: 'ok', view: overviewView(await getOverview(), t, { tenantName }) };
  } catch (error) {
    if (error instanceof ApiClientError) {
      const path = bootstrapRedirectPath(error);
      if (path) return { status: 'redirect', path };
    }
    if (error instanceof PaymentsApiError && (error.status === 404 || error.status === 403)) {
      return { status: 'not-found' };
    }
    // Shape only: nothing of the integration reaches a log line.
    console.error('payments.overview_failed', {
      ...(error instanceof PaymentsApiError || error instanceof ApiClientError
        ? { status: error.status, code: error.code }
        : { error: String(error) }),
    });
    return { status: 'error' };
  }
}

/** What reading the Acessos tab came to. A failed PAGE read still renders the list, as its error card. */
type AccessResult =
  | { status: 'ok'; page: AccessPage | null; overview: PaymentsOverview }
  | { status: 'redirect'; path: string }
  | { status: 'not-found' }
  | { status: 'error' };

/** How one failed read is handled: a navigation, the screen not existing, or an error. */
function classify(
  error: unknown,
  label: string,
): { status: 'redirect'; path: string } | { status: 'not-found' } | { status: 'error' } {
  if (error instanceof ApiClientError) {
    const path = bootstrapRedirectPath(error);
    if (path) return { status: 'redirect', path };
  }
  if (error instanceof PaymentsApiError && (error.status === 404 || error.status === 403)) {
    return { status: 'not-found' };
  }
  // Shape only: neither an e-mail nor a search term reaches a log line (T-09.1-69).
  console.error(`payments.${label}_failed`, {
    ...(error instanceof PaymentsApiError || error instanceof ApiClientError
      ? { status: error.status, code: error.code }
      : { error: String(error) }),
  });
  return { status: 'error' };
}

/**
 * Reads page 1 of the Acessos list for the URL's `q` and `status`, and the overview (the sheet needs
 * `gatewayName` and `gate.required`), in parallel. The caller acts on the result OUTSIDE any try/catch
 * (Next 16: `notFound()` and `redirect()` throw). A failed overview is the tab's error card; a failed
 * page read with a good overview is the list's own first-load error (UI-D-528).
 */
async function loadAccess(q: string, status: AccessFilter): Promise<AccessResult> {
  const [page, overview] = await Promise.allSettled([
    getAccesses({ q: q || undefined, status: status === 'all' ? undefined : status }),
    getOverview(),
  ]);
  if (overview.status === 'rejected') return classify(overview.reason, 'overview');
  if (page.status === 'rejected') {
    const handled = classify(page.reason, 'load_accesses');
    if (handled.status !== 'error') return handled;
    return { status: 'ok', page: null, overview: overview.value };
  }
  return { status: 'ok', page: page.value, overview: overview.value };
}

/** What reading the Eventos tab came to. Any failed read is the tab's error card (UI-D-528). */
type EventsResult =
  | { status: 'ok'; events: EventsResponse; overview: PaymentsOverview }
  | { status: 'redirect'; path: string }
  | { status: 'not-found' }
  | { status: 'error' };

/** The events and the overview (the empty state names the gateway), in parallel. */
async function loadEvents(): Promise<EventsResult> {
  const [events, overview] = await Promise.allSettled([getEvents(), getOverview()]);
  if (events.status === 'rejected') return classify(events.reason, 'load_events');
  if (overview.status === 'rejected') return classify(overview.reason, 'overview');
  return { status: 'ok', events: events.value, overview: overview.value };
}

/**
 * `/configuracoes/pagamentos` (09.1-13, UI-D-513, D-501, PAY-19): the admin's Pagamentos screen,
 * reached from the Configurações "Pagamentos" row and nowhere else. A frame (the shipped `PageHeader`,
 * the underline tabs Configuração · Acessos · Eventos) over a body per tab; this plan builds the
 * Configuração body, and plan 14 fills the other two.
 *
 * **`notFound()`, never a 403 screen** (the `/configuracoes/midia` precedent): the route answers the
 * app's own not-found page unless the bootstrap carries the composed `payments.manage`, which exists
 * only for `admin_tenant` while the `payments` module is on. A member or support user must not learn
 * that the screen exists. `notFound()` throws, so it sits outside any try/catch.
 *
 * `?aba=` is read here on the server (`paymentsTabFromParam`): an unknown, repeated or absent value
 * is Configuração, so a tab change, a refresh, back and a shared link land on the same tab.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [bootstrap, t, params] = await Promise.all([
    requireBootstrap(),
    getTranslations(),
    searchParams,
  ]);
  if (!bootstrap.permissions.includes(PAYMENTS_PERMISSIONS.manage)) notFound();

  const tab = paymentsTabFromParam(params.aba);
  const bodyClass = 'flex flex-col gap-6 px-4 pb-6 md:px-0';

  let body: ReactNode;
  if (tab === 'setup') {
    const setup = await loadSetup(t, bootstrap.tenant.displayName);
    if (setup.status === 'not-found') notFound();
    if (setup.status === 'redirect') redirect(setup.path);
    body =
      setup.status === 'ok' ? (
        <SetupPanel view={setup.view} />
      ) : (
        <div data-testid="payments-setup" className={bodyClass}>
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('payments.errors.title')}
            body={t('payments.errors.setup')}
            action={
              <Link
                href={paymentsTabHref(tab)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                {t('payments.errors.retry')}
              </Link>
            }
          />
        </div>
      );
  } else if (tab === 'access') {
    const q = accessQueryFromParam(params.q);
    const status = accessFilterFromParam(params.status);
    const access = await loadAccess(q, status);
    if (access.status === 'not-found') notFound();
    if (access.status === 'redirect') redirect(access.path);
    body =
      access.status === 'ok' ? (
        <AccessList
          q={q}
          status={status}
          initialItems={access.page?.items ?? []}
          initialCursor={access.page?.nextCursor ?? null}
          serverNow={access.page?.serverNow ?? access.overview.serverNow}
          initialError={access.page === null}
          gatewayName={access.overview.integration.gatewayName}
          tenantName={bootstrap.tenant.displayName}
          timeZone={bootstrap.tenant.timezone}
          gateRequired={access.overview.gate.required}
        />
      ) : (
        <div data-testid="payments-access" className={bodyClass}>
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('payments.errors.title')}
            body={t('payments.errors.access')}
            action={
              <Link
                href={paymentsTabHref(tab)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                {t('payments.errors.retry')}
              </Link>
            }
          />
        </div>
      );
  } else {
    const loaded = await loadEvents();
    if (loaded.status === 'not-found') notFound();
    if (loaded.status === 'redirect') redirect(loaded.path);
    body =
      loaded.status === 'ok' ? (
        <EventsList
          initialItems={loaded.events.items}
          serverNow={loaded.events.serverNow}
          gatewayName={loaded.overview.integration.gatewayName}
          tenantName={bootstrap.tenant.displayName}
        />
      ) : (
        <div data-testid="payments-events" className={bodyClass}>
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('payments.errors.title')}
            body={t('payments.errors.events')}
            action={
              <Link
                href={paymentsTabHref(tab)}
                className={buttonClasses({ variant: 'outline', size: 'md' })}
              >
                {t('payments.errors.retry')}
              </Link>
            }
          />
        </div>
      );
  }

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        title={t('payments.title')}
        backHref="/configuracoes"
        backLabel={t('payments.back')}
        className="md:static md:px-0"
      />
      <PaymentsTabs
        label={t('payments.tabs.label')}
        value={tab}
        items={PAYMENTS_TABS.map((key) => ({
          key,
          label: t(`payments.tabs.${key}`),
          href: paymentsTabHref(key),
        }))}
        className="mb-4 border-b border-divider"
      />
      {body}
    </div>
  );
}
