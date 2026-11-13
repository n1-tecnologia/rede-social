'use client';

import { Button } from '@rede-social/ui';
import { Info, Lock, Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { safeCheckoutHref } from '@/lib/event-ticket';
import type { EventPhase, EventSaleState } from '@/lib/events-view';
import { GOLD, Zone } from './zone';

/**
 * The paid branch of the detail's action zone (Phase 10.1-12, D-741, D-746, D-750, D-751, D-753, D-755,
 * UI-D-746, UI-D-747): what a member WITHOUT a presence sees in a paid event. `EventActions` hands it
 * the event only in that case; a member who is in keeps the shipped zone.
 *
 * **The SERVER decides the state** (`eventSaleState`, from the request instant) and this island draws
 * it. The precedence is the server's, first match wins:
 *
 * | Zone | What renders |
 * |------|--------------|
 * | cancelled, ended (`none`) | nothing (the cancelled banner explains) |
 * | `salesClosed` (under way) | the disabled brand "Vendas encerradas" + its hint |
 * | `unavailable` (module off, gateway down, no link) | the disabled "Venda indisponível" + its hint |
 * | `soldOut` | the disabled "Esgotado" + the shipped full hint |
 * | `buy` | the ONE external anchor "Comprar ingresso" + "Depois de pagar, sua presença aparece aqui sozinha." |
 *
 * An online event adds the Lock hint "O link da transmissão é só para quem tem ingresso." and never an
 * `Entrar` button; there is never a Vou, Garantir minha vaga, Cancelar inscrição or walk-in link here,
 * and at most one brand fill (the buy anchor, or the disabled brand button, never both).
 *
 * **Nothing is faked (D-506).** No processing state, no dialog, no optimistic confirmation, no request
 * on render: the anchor only navigates. Its href is `safeCheckoutHref` of the server payload, checked
 * again HERE (T-10.1-24): a non-`https:` value never reaches an anchor, it draws "Venda indisponível".
 * The control leaves at `starts_at` by the SERVER's instant, through `EventActions`' boundary refresh,
 * never by the device clock.
 */
export interface PaidEventZoneProps {
  /** `EventActionState.zone`: the sale zone the server computed, null for a viewer who is in. */
  zone: EventSaleState['kind'] | null;
  phase: EventPhase;
  format: 'in_person' | 'online';
  cancelled: boolean;
  /** The validated `https:` buy link (only in the `buy` zone); re-validated here. */
  checkoutHref: string | null;
  /** The optional "R$ 80,00" of the event's reference price. */
  priceLabel: string | null;
  /** "Seu ingresso foi reembolsado e a presença saiu da lista." (A-UI-8), only when the read says it. */
  refundedNote?: string | null;
}

export function PaidEventZone({
  zone,
  phase,
  format,
  cancelled,
  checkoutHref,
  priceLabel,
  refundedNote = null,
}: PaidEventZoneProps) {
  const t = useTranslations('events');

  // (1) cancelled and (2) ended: the zone is empty.
  if (cancelled || phase === 'P3' || zone === null || zone === 'none') return null;

  const href = zone === 'buy' ? safeCheckoutHref(checkoutHref) : null;
  // A "buy" zone whose link does not survive the guard is the unavailable state, never a link.
  const state: 'buy' | 'salesClosed' | 'unavailable' | 'soldOut' =
    zone === 'buy' && href === null ? 'unavailable' : zone;
  const online = format === 'online';

  return (
    <Zone phase={phase}>
      {refundedNote ? (
        <p
          data-testid="event-actions-refunded"
          className="flex items-start gap-1.5 break-words text-xs text-text-tertiary"
        >
          <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0">{refundedNote}</span>
        </p>
      ) : null}

      {state === 'buy' && href !== null ? (
        <>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="event-actions-buy"
            className={`${GOLD} tabular-nums`}
          >
            <Ticket size={16} aria-hidden className="shrink-0" />
            {priceLabel ? t('ticket.cta.buyPrice', { price: priceLabel }) : t('ticket.cta.buy')}{' '}
            <span className="sr-only">{t('ticket.cta.newTab')}</span>
          </a>
          <p data-testid="event-actions-hint" className="break-words text-xs text-text-tertiary">
            {t('ticket.hint.afterPay')}
          </p>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="brand"
            size="lg"
            fullWidth
            disabled
            aria-disabled="true"
            data-testid="event-actions-disabled"
          >
            {t(
              state === 'salesClosed'
                ? 'ticket.cta.salesClosed'
                : state === 'soldOut'
                  ? 'ticket.cta.soldOut'
                  : 'ticket.cta.unavailable',
            )}
          </Button>
          <p data-testid="event-actions-hint" className="break-words text-xs text-text-tertiary">
            {t(
              state === 'salesClosed'
                ? 'ticket.hint.salesClosed'
                : state === 'soldOut'
                  ? 'rsvp.fullHint'
                  : 'ticket.hint.unavailable',
            )}
          </p>
        </>
      )}

      {online ? (
        <p
          data-testid="event-actions-online-hint"
          className="flex items-start gap-2 break-words text-xs text-text-tertiary"
        >
          <Lock size={16} aria-hidden className="shrink-0" />
          <span className="min-w-0">{t('ticket.hint.onlineLink')}</span>
        </p>
      ) : null}
    </Zone>
  );
}
