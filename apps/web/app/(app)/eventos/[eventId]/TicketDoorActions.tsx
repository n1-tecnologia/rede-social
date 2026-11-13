import { Ticket } from 'lucide-react';
import { safeCheckoutHref } from '@/lib/event-ticket';
import { GOLD, OUTLINE_CTA } from './zone';

/**
 * The actions of the two closed doors of a paid event (Phase 10.1-13, D-742, UI-D-751, UI-D-752): the
 * online refusal screen (`/entrar/aviso?motivo=ingresso`) and the check-in ticket's `paid` section draw
 * the SAME stack: when the event can be bought, the brand "Comprar ingresso" anchor (the screen's one
 * brand fill), then the outline "Ver evento"; otherwise only the outline (A-UI-7).
 *
 * Props-only, so a server page can hand it finished strings. The buy link is re-validated HERE
 * (`safeCheckoutHref`, T-10.1-24): a value that is not a clean `https:` URL draws no anchor at all, never
 * a dead or unsafe one. The anchor is a plain external `<a target="_blank" rel="noopener noreferrer">`,
 * like the detail's buy control; nothing about it is a request on render.
 */
export function TicketDoorActions({
  buyHref,
  buyLabel,
  newTabLabel,
  detailHref,
  detailLabel,
}: {
  /** The validated `https:` purchase link while the sale is open, else null. */
  buyHref: string | null;
  buyLabel: string;
  /** The screen-reader suffix "(abre a página de pagamento em uma nova aba)". */
  newTabLabel: string;
  detailHref: string;
  detailLabel: string;
}) {
  const href = safeCheckoutHref(buyHref);
  return (
    <div data-testid="ticket-door-actions" className="flex w-full max-w-[280px] flex-col gap-2">
      {href !== null ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="ticket-door-buy"
          className={GOLD}
        >
          <Ticket size={16} aria-hidden className="shrink-0" />
          {buyLabel} <span className="sr-only">{newTabLabel}</span>
        </a>
      ) : null}
      <a href={detailHref} data-testid="enter-notice-cta" className={OUTLINE_CTA}>
        {detailLabel}
      </a>
    </div>
  );
}
