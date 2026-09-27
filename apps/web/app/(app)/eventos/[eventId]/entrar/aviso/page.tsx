import { EmptyState, PageHeader } from '@tria/ui';
import { CalendarClock, CalendarX2, Lock, type LucideIcon } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ENTER_NOTICE_REASONS, type EnterNoticeReason, EVENT_ID_RE } from '@/lib/events-view';

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
 *
 * `motivo` is accepted ONLY as one of those three exact single strings; anything else (unknown,
 * repeated, absent) redirects to the detail silently (D-93). The not-found outcome never lands here:
 * it goes to the detail, whose not-found screen answers (D-23).
 *
 * The page renders fixed catalog strings only: no user content (no title), no API read and no URL
 * (E12 long-text), so it is server-rendered with no client state (E12 loading). The body wraps inside
 * `EmptyState`'s `max-w-[260px]` (E12 overflow). No brand fill: the refusal is a state, not an action.
 */
const NOTICES: Readonly<
  Record<EnterNoticeReason, { icon: LucideIcon; key: 'ended' | 'cancelled' | 'confirmFirst' }>
> = {
  encerrado: { icon: CalendarClock, key: 'ended' },
  cancelado: { icon: CalendarX2, key: 'cancelled' },
  confirmar: { icon: Lock, key: 'confirmFirst' },
};

const isReason = (value: unknown): value is EnterNoticeReason =>
  typeof value === 'string' && (ENTER_NOTICE_REASONS as readonly string[]).includes(value);

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
          <a
            href={detailHref}
            data-testid="enter-notice-cta"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('enter.cta')}
          </a>
        }
      />
    </div>
  );
}
