'use client';

import { Clock, Lock, Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LiveCountdown } from '@/components/events/LiveCountdown';
import type { EventPhase, EventSoonView } from '@/lib/events-view';
import { Zone } from './zone';

/**
 * The `Em breve` zone of a paid event before its registration opening (Phase 10.2, OPEN-08, OPEN-10,
 * D-785, D-786, D-787, D-788, D-789, UI-D-784; sketch 022 `zona-em-breve-*`). It REPLACES the buy zone
 * inside the shipped `Zone` shell, top to bottom:
 *
 * 1. the heading row: `Clock` and "As inscrições abrem em";
 * 2. the count (`LiveCountdown` `blocks`: one cell per non-zero unit, `Menos de 1 min`, `Abrindo agora`);
 *    with no seed (an older API) there is no count and no tick, only the lines below;
 * 3. the exact opening, "Abertura: 20 nov, 10:00", in the tenant's zone, finished by the server;
 * 4. the zone line, "Fuso horário: {long name}", always shown, wrapping to as many lines as it needs;
 * 5. the reference price, ONLY when the admin filled it (D-786: the price stays visible);
 * 6. the hint that the buy control arrives by itself;
 * 7. an online event adds, last, the shipped Lock hint (there is no `Entrar` without a presence).
 *
 * **There is no control here, ever.** No button, no anchor, no brand fill, whatever props arrive: the
 * buy link crosses only in the server's `buy` answer, through the boundary refresh (D-789, T-10.2-01).
 * The zone has no skeleton and no loading state of its own: the page renders it on the server with the
 * seed. Every string is a catalog fragment or finished server text rendered as a React text node.
 *
 * The component is a SIBLING of the persistent polite wrapper in `PaidEventZone`, never inside it: the
 * count must not be spoken every minute (UI-D-787).
 */
export interface SoonZoneProps {
  soon: EventSoonView;
  phase: EventPhase;
  format: 'in_person' | 'online';
}

export function SoonZone({ soon, phase, format }: SoonZoneProps) {
  const t = useTranslations('events');

  return (
    <Zone phase={phase}>
      <div data-testid="event-soon-zone" className="contents">
        <div className="flex items-center gap-2">
          <Clock size={16} aria-hidden className="shrink-0 text-text-tertiary" />
          <h2 className="text-sm font-bold text-text">{t('ticket.soon.title')}</h2>
        </div>

        <LiveCountdown
          variant="blocks"
          kind="opening"
          targetIso={soon.opensAt}
          seedIso={soon.serverNow}
        />

        <p data-testid="event-soon-opens-at" className="break-words text-sm font-bold text-text">
          {t('ticket.soon.opensAt', { date: soon.dateLabel, time: soon.timeLabel })}
        </p>
        <p data-testid="event-soon-zone-label" className="break-words text-xs text-text-tertiary">
          {t('ticket.soon.zone', { zone: soon.zoneLabel })}
        </p>
        {soon.price ? (
          <p
            data-testid="event-soon-price"
            className="flex items-center gap-2 text-sm tabular-nums text-text"
          >
            <Ticket size={16} aria-hidden className="shrink-0 text-text-tertiary" />
            <span className="min-w-0 break-words">
              {t('ticket.soon.price', { price: soon.price })}
            </span>
          </p>
        ) : null}
        <p data-testid="event-soon-hint" className="break-words text-xs text-text-tertiary">
          {t('ticket.soon.hint')}
        </p>
        {format === 'online' ? (
          <p
            data-testid="event-actions-online-hint"
            className="flex items-start gap-2 break-words text-xs text-text-tertiary"
          >
            <Lock size={16} aria-hidden className="shrink-0" />
            <span className="min-w-0">{t('ticket.hint.onlineLink')}</span>
          </p>
        ) : null}
      </div>
    </Zone>
  );
}
