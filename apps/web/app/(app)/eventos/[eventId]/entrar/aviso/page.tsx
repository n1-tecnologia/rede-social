import { EmptyState, PageHeader } from '@rede-social/ui';
import { CalendarClock, CalendarX2, Lock, type LucideIcon, Ticket } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { loadEvent } from '@/lib/events';
import {
  ENTER_NOTICE_REASONS,
  type EnterNoticeReason,
  EVENT_ID_RE,
  eventPhase,
  eventSaleState,
} from '@/lib/events-view';
import { TicketDoorActions } from '../../TicketDoorActions';

/**
 * `/eventos/[eventId]/entrar/aviso?motivo=` (06-06, UI-D-209, sketch 006 surface 4
 * "entrar-recusas-…") — the ONE refusal layout `/eventos/{id}/entrar` redirects to when the gate says
 * no: `PageHeader` back to the detail, `EmptyState` (`plain`) with an icon, a title and a body that
 * NAME the reason, and an outline "Ver evento".
 *
 * | `motivo`    | Gate outcome    | Icon            | Copy                               |
 * |-------------|-----------------|-----------------|------------------------------------|
 * | `encerrado` | `ended`         | `CalendarClock` | `events.enter.ended.*`             |
 * | `cancelado` | `cancelled`     | `CalendarX2`    | `events.enter.cancelled.*`         |
 * | `confirmar` | `confirm_first` | `Lock`          | `events.enter.confirmFirst.*`      |
 * | `ingresso`  | `ticket_required` | `Ticket`      | `events.enter.ticketRequired.*`    |
 *
 * `motivo` is accepted ONLY as one of those four exact single strings; anything else (unknown,
 * repeated, absent) redirects to the detail silently (D-93, T-10.1-33). The not-found outcome never
 * lands here: it goes to the detail, whose not-found screen answers (D-23).
 *
 * The first three render fixed catalog strings only: no user content (no title), no API read and no URL
 * (E12 long-text), so they are server-rendered with no client state (E12 loading). The body wraps
 * inside `EmptyState`'s `max-w-[260px]` (E12 overflow). No brand fill: the refusal is a state, not an
 * action.
 *
 * **`ingresso` (Phase 10.1-13, D-742, UI-D-751, A-UI-7)** is the one reason that reads the event, ONCE
 * (`loadEvent`), to find the purchase link: when the sale is open (`eventSaleState` is `buy`, the link
 * re-validated as `https:`) the brand "Comprar ingresso" anchor leads the actions, then the outline "Ver
 * evento"; any failure (not found, a transport error) or a sale that cannot be bought draws the screen
 * with only "Ver evento". The screen still never carries the meeting URL, the venue code or the title.
 */
const NOTICES: Readonly<
  Record<
    EnterNoticeReason,
    { icon: LucideIcon; key: 'ended' | 'cancelled' | 'confirmFirst' | 'ticketRequired' }
  >
> = {
  encerrado: { icon: CalendarClock, key: 'ended' },
  cancelado: { icon: CalendarX2, key: 'cancelled' },
  confirmar: { icon: Lock, key: 'confirmFirst' },
  ingresso: { icon: Ticket, key: 'ticketRequired' },
};

const isReason = (value: unknown): value is EnterNoticeReason =>
  typeof value === 'string' && (ENTER_NOTICE_REASONS as readonly string[]).includes(value);

/** The purchase link of an event that can be bought right now, else null (A-UI-7: never an error). */
async function buyHrefOf(eventId: string): Promise<string | null> {
  const result = await loadEvent(eventId);
  if (result.status !== 'ok') return null;
  const { event } = result;
  const sale = eventSaleState(event, eventPhase(event.startsAt, event.endsAt, Date.now()));
  return sale.kind === 'buy' ? sale.href : null;
}

export default async function EnterNoticePage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ eventId }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations('events'),
  ]);
  const detailHref = `/eventos/${encodeURIComponent(eventId)}`;
  const motivo = query.motivo;
  // D-93: only the exact single value is a screen; the rest falls back to the detail, silently.
  if (!EVENT_ID_RE.test(eventId) || !isReason(motivo)) redirect(detailHref);

  const notice = NOTICES[motivo];
  const buyHref = motivo === 'ingresso' ? await buyHrefOf(eventId) : null;
  return (
    <div
      className="mx-auto flex w-full max-w-[680px] flex-col"
      data-testid="enter-notice"
      data-reason={motivo}
    >
      <PageHeader backHref={detailHref} backLabel={t('checkin.back')} />
      <EmptyState
        variant="plain"
        icon={notice.icon}
        title={t(`enter.${notice.key}.title`)}
        body={t(`enter.${notice.key}.body`)}
        action={
          motivo === 'ingresso' ? (
            <TicketDoorActions
              buyHref={buyHref}
              buyLabel={t('ticket.cta.buy')}
              newTabLabel={t('ticket.cta.newTab')}
              detailHref={detailHref}
              detailLabel={t('enter.cta')}
            />
          ) : (
            <a
              href={detailHref}
              data-testid="enter-notice-cta"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t('enter.cta')}
            </a>
          )
        }
      />
    </div>
  );
}
