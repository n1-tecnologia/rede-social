'use client';

import type { EventItem } from '@rede-social/module-payments/contracts';
import { EventRow } from '@rede-social/module-payments/ui';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PullToRefresh,
  SectionTitle,
  useToast,
} from '@rede-social/ui';
import { ChevronRight, ShoppingBag, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useId, useState } from 'react';
import {
  type EventRowView,
  eventRowView,
  eventsHeaderView,
  type PaymentsTranslator,
} from '@/lib/payments-view';
import { type GrantEventOutcome, grantEventAction, loadEventsAction } from './actions';
import { paymentsTabHref } from './tabs';

export interface EventsListProps {
  /** The latest events (up to 50), read on the server in the API's own order. */
  initialItems: EventItem[];
  /** The API's own clock: "recebido {when}" never reads the browser's. */
  serverNow: string;
  /** The adapter's display name, the `{gateway}` of the empty state. */
  gatewayName: string;
  /** The tenant's display name, for the "no account yet" sentence. */
  tenantName: string;
}

/** The event a "Liberar manualmente" dialog is asking about: the item as the server sent it and its finished view. */
interface GrantTarget {
  item: EventItem;
  view: EventRowView;
}

/**
 * The Eventos tab (09.1-14, PAY-21, UI-D-519, D-503): the last 50 things the gateway sent, in the
 * integration's own neutral words. It is the admin's test of the integration and the support desk for "I
 * paid and nothing happened", so it names each delivery's state in a glyph, a word and a colour, and
 * NEVER shows a request body, a header, a signing hash or a gateway message: the view takes only the
 * contract's fields (T-09.1-65).
 *
 * - **Never paged, never searched.** The server caps the list at 50; a pull-to-refresh asks again.
 * - **"Liberar manualmente"** exists on a no-account row only. It opens a brand dialog, sends only the
 *   event id and settles the row IN PLACE from the server's answer (no optimistic state). A 409
 *   `no_membership` toasts the sentence with the tenant name and leaves the row as it was.
 * - **"Cadastrar produto"** exists on an unknown-product row only and is a LINK to the Configuração tab
 *   (a route is a link, UI-D-529).
 */
export function EventsList({ initialItems, serverNow, gatewayName, tenantName }: EventsListProps) {
  const t = useTranslations();
  const tView = t as unknown as PaymentsTranslator;
  const router = useRouter();
  const toast = useToast();
  const titleId = useId();

  const [items, setItems] = useState(initialItems);
  const [clock, setClock] = useState(serverNow);

  // The server rendered a NEW page (router.refresh): re-seed from it during render.
  const [seeded, setSeeded] = useState(initialItems);
  if (seeded !== initialItems) {
    setSeeded(initialItems);
    setItems(initialItems);
    setClock(serverNow);
  }

  const forbidden = useCallback(() => {
    toast.show({ tone: 'error', message: t('admin.errors.forbidden') });
    router.refresh();
  }, [router, t, toast]);

  /** The pull: the latest events again. A failure keeps every row and says so. */
  const refresh = useCallback(async () => {
    try {
      const page = await loadEventsAction();
      if (!page.ok) {
        if (page.code === 'forbidden') forbidden();
        else toast.show({ tone: 'error', message: t('payments.errors.events') });
        return;
      }
      setItems(page.items);
      setClock(page.serverNow);
    } catch (error) {
      console.error('payments.events.refresh_failed', { error: String(error) });
      toast.show({ tone: 'error', message: t('payments.errors.events') });
    }
  }, [forbidden, t, toast]);

  /* ── "Liberar manualmente" ─────────────────────────────────────────────────────────────────── */

  const [target, setTarget] = useState<GrantTarget | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);

  async function confirmGrant() {
    if (!target) return;
    const { item, view } = target;
    let outcome: GrantEventOutcome = { ok: false, code: 'generic' };
    try {
      outcome = await grantEventAction(item.id);
    } catch {
      // A network failure reads like any other failed write.
    }

    if (outcome.ok) {
      const granted = outcome.event;
      setItems((rows) => rows.map((row) => (row.id === granted.id ? granted : row)));
      setClock(outcome.serverNow);
      toast.show({
        tone: 'success',
        message: t('payments.toasts.granted', {
          product: item.productName ?? view.product ?? '',
          email: item.email ?? '',
        }),
      });
      return;
    }
    switch (outcome.code) {
      case 'no_membership':
        // The buyer still has no account: nothing changed, the row stays exactly as it was.
        toast.show({
          tone: 'error',
          message: t('payments.errors.noMembership', { tenant: tenantName }),
        });
        return;
      case 'forbidden':
        forbidden();
        return;
      case 'gone':
        setItems((rows) => rows.filter((row) => row.id !== item.id));
        toast.show({ tone: 'error', message: t('payments.errors.generic') });
        router.refresh();
        return;
      case 'not_grantable':
        // The event moved on since this page was rendered (the apply job settled it): read it again.
        toast.show({ tone: 'error', message: t('payments.errors.generic') });
        router.refresh();
        return;
      default:
        toast.show({ tone: 'error', message: t('payments.errors.generic') });
    }
  }

  const asking = useCallback((next: GrantTarget) => {
    setTarget(next);
    setGrantOpen(true);
  }, []);

  /* ── Render ────────────────────────────────────────────────────────────────────────────────── */

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div data-testid="payments-events" className="flex flex-col gap-2 px-4 pb-6 md:px-0">
          <div>
            <SectionTitle id={titleId}>{t('payments.events.title')}</SectionTitle>
            {items.length > 0 ? (
              <p className="mt-1 text-xs font-normal text-text-tertiary">
                {eventsHeaderView(items.length, tView)}
              </p>
            ) : null}
          </div>

          {items.length === 0 ? (
            <EmptyState
              variant="card"
              icon={Webhook}
              title={t('payments.events.empty.title')}
              body={t('payments.events.empty.body', { gateway: gatewayName })}
            />
          ) : (
            <Card className="p-0">
              <ul aria-label={t('payments.events.listLabel')} className="divide-y divide-divider">
                {items.map((item) => {
                  const view = eventRowView(item, tView, { serverNow: clock });
                  let action: ReactNode;
                  if (view.canGrant) {
                    action = (
                      <Button
                        variant="outline"
                        size="sm"
                        hitArea
                        onClick={() => asking({ item, view })}
                      >
                        {t('payments.events.grant')}
                      </Button>
                    );
                  } else if (view.canRegister) {
                    action = (
                      <Link
                        href={paymentsTabHref('setup')}
                        className="inline-flex min-h-11 items-center gap-1 text-xs font-bold text-brand"
                      >
                        {t('payments.events.register')}
                        <ChevronRight aria-hidden size={14} />
                      </Link>
                    );
                  }
                  return (
                    <EventRow
                      key={item.id}
                      state={view.state}
                      stateLabel={view.stateLabel}
                      name={view.name}
                      email={view.email}
                      product={view.product}
                      effect={view.effect}
                      received={view.received}
                      action={action}
                    />
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </PullToRefresh>

      <ConfirmDialog
        open={grantOpen}
        tone="brand"
        icon={ShoppingBag}
        title={t('payments.events.grantDialog.title', {
          product: target?.item.productName ?? target?.view.product ?? '',
          email: target?.item.email ?? '',
        })}
        body={t('payments.events.grantDialog.body')}
        confirmLabel={t('payments.events.grantDialog.confirm')}
        cancelLabel={t('payments.events.grantDialog.cancel')}
        onConfirm={confirmGrant}
        onClose={() => setGrantOpen(false)}
      />
    </>
  );
}
