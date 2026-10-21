import { PAYMENTS_PERMISSIONS } from '@rede-social/module-payments/contracts';
import { buttonClasses, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { getOverview, PaymentsApiError } from '@/lib/payments';
import { overviewView, type PaymentsTranslator, type SetupView } from '@/lib/payments-view';
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
  searchParams: Promise<{ aba?: string | string[] }>;
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
  } else {
    // Plan 14 fills these two bodies; until then the tab selects an empty, error-free container.
    body = <div data-testid={`payments-${tab}`} className={bodyClass} />;
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
