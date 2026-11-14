'use client';

import { Button } from '@rede-social/ui';
import { Info, Lock, Ticket } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import { useCountdownClock } from '@/components/events/useCountdownClock';
import { useLiveRefresh } from '@/components/useLiveRefresh';
import { safeCheckoutHref } from '@/lib/event-ticket';
import type { EventPhase, EventSaleState, EventSoonView } from '@/lib/events-view';
import { SoonZone } from './SoonZone';
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
 * | `soon` (the opening is ahead, Phase 10.2) | the `Em breve` zone (`SoonZone`): the count, the exact opening, the zone, the price and the hint; NO control of any kind, whatever link prop arrives (D-789) |
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
 *
 * **The live swap (D-756, PAY-34, UI-D-748).** The zone sits inside a PERSISTENT `aria-live="polite"`
 * wrapper that exists from the first render of a paid event the member is not in, and `useLiveRefresh`
 * (the machine `GatewayPurchase` shares) calls `router.refresh()` when the buyer's own user topic
 * signals `notifications.changed`, so the SERVER answers a presence. The signal only requests a refetch,
 * it never carries state, and there is no toast: the announced "Presença confirmada" block and the bell
 * row are the confirmation. When the server does answer a presence (`waiting` false) the wrapper stays
 * and holds `children`, the shipped zone for a member who is in, so the swap is announced, not just
 * painted; the hook is gone by then. A cancelled or ended event has nothing to wait for: no wrapper, no
 * hook.
 *
 * **The `soon` zone (Phase 10.2, UI-D-784, UI-D-787, UI-D-789).** `SoonZone` is a SIBLING of the polite
 * wrapper, never inside it, so a changing digit is never spoken. The wrapper and its `useLiveRefresh`
 * listener stay mounted through `soon` (an early payer's presence swaps the zone to the confirmed block,
 * count and all) and hold ONLY visually hidden sentences: the status sentence that changes at three
 * thresholds (the last 24 hours, the last hour, the last minute) and, once, "As inscrições abriram." when
 * THIS client saw the zone go from `soon` to `buy` (never on a first load of an already-open event). That
 * is at most four polite announcements in the whole wait. The count's own `role="timer"` sits outside the
 * wrapper and changes silently.
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
  /**
   * The member has no presence yet (the default): the zone and the listener are drawn. False once the
   * server answered a presence: only `children` (the shipped zone) is drawn, inside the same live region.
   */
  waiting?: boolean;
  /** The viewer's own ids: the topic is `tenant:{id}:user:{id}`; absent, only the visibility refresh runs. */
  tenantId?: string | null;
  userId?: string | null;
  /**
   * Phase 10.2: the `Em breve` block (the opening and the server seed as ISO strings, the finished
   * opening labels, the zone name and the reference price), present only while `zone` is `soon`.
   */
  soon?: EventSoonView | null;
  children?: ReactNode;
}

/** The unit thresholds of the polite status sentence (UI-D-787). */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

export function PaidEventZone({
  zone,
  phase,
  format,
  cancelled,
  checkoutHref,
  priceLabel,
  refundedNote = null,
  waiting = true,
  tenantId = null,
  userId = null,
  soon = null,
  children,
}: PaidEventZoneProps) {
  const t = useTranslations('events');
  // The count draws only while the server says `soon` AND sent its block; the zone never has a link.
  const showSoon = waiting && zone === 'soon' && soon !== null;
  // Whether THIS client has seen the `Em breve` zone: only then does the swap to the buy zone announce
  // "As inscrições abriram." (A-UI-16); a first load of an already-open event never does.
  const [seenSoon, setSeenSoon] = useState(false);
  if (showSoon && !seenSoon) setSeenSoon(true);

  // (1) cancelled and (2) ended: the zone is empty, and so is the wait.
  const empty = cancelled || phase === 'P3' || zone === null || zone === 'none';
  if (waiting && empty) return null;

  return (
    <>
      {showSoon ? <SoonZone soon={soon} phase={phase} format={format} /> : null}
      <div aria-live="polite" data-testid="event-actions-live">
        {waiting ? (
          <>
            <LiveRefresh tenantId={tenantId} userId={userId} />
            {showSoon ? <SoonStatus opensAt={soon.opensAt} serverNow={soon.serverNow} /> : null}
            {seenSoon && zone === 'buy' ? (
              <p className="sr-only" data-testid="event-actions-opened">
                {t('ticket.soon.opened')}
              </p>
            ) : null}
            {showSoon ? null : (
              <PaidZone
                zone={zone}
                phase={phase}
                format={format}
                checkoutHref={checkoutHref}
                priceLabel={priceLabel}
                refundedNote={refundedNote}
              />
            )}
          </>
        ) : (
          children
        )}
      </div>
    </>
  );
}

/**
 * The visually hidden status sentence inside the polite wrapper (UI-D-787): "As inscrições abrem em
 * menos de 1 dia / 1 hora / 1 minuto." It changes at three thresholds only (the last 24 hours begin, the
 * last hour, the last minute), so a person using a screen reader hears at most three sentences in the
 * whole wait, and nothing earlier than 24 hours or at zero (the swap speaks for itself). It follows the
 * seeded clock, never the device's. The count blocks are NOT here.
 */
function SoonStatus({ opensAt, serverNow }: { opensAt: string; serverNow: string | null }) {
  const t = useTranslations('events');
  const { remainingMs } = useCountdownClock(opensAt, serverNow);
  const left = remainingMs;
  const sentence =
    left === null || left <= 0 || left >= DAY_MS
      ? null
      : left < MINUTE_MS
        ? t('ticket.soon.milestone.minute')
        : left < HOUR_MS
          ? t('ticket.soon.milestone.hour')
          : t('ticket.soon.milestone.day');
  return (
    <p className="sr-only" data-testid="event-soon-status">
      {sentence}
    </p>
  );
}

/** The buyer's wait: a `notifications.changed` signal makes the server answer the presence (UI-D-748). */
function LiveRefresh({ tenantId, userId }: { tenantId: string | null; userId: string | null }) {
  const router = useRouter();
  useLiveRefresh(tenantId, userId, () => router.refresh());
  return null;
}

function PaidZone({
  zone,
  phase,
  format,
  checkoutHref,
  priceLabel,
  refundedNote,
}: Pick<
  PaidEventZoneProps,
  'zone' | 'phase' | 'format' | 'checkoutHref' | 'priceLabel' | 'refundedNote'
>) {
  const t = useTranslations('events');

  const href = zone === 'buy' ? safeCheckoutHref(checkoutHref) : null;
  // A "buy" zone whose link does not survive the guard is the unavailable state, never a link.
  const state: 'buy' | 'salesClosed' | 'unavailable' | 'soldOut' =
    zone === 'salesClosed' || zone === 'soldOut'
      ? zone
      : zone === 'buy' && href !== null
        ? 'buy'
        : 'unavailable';
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
