import { CalendarX2, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EventDetailView } from '@/lib/events-view';

/**
 * The banner at the top of the detail card's body: cancelled (danger, UI-D-202), checked in (UI-D-207),
 * or, since Phase 10.1-12, "Presença confirmada" (UI-D-749) for a viewer holding a presence in a paid
 * event who has not checked in. The confirmed kind IS the checked-in banner's geometry (`border-success/30
 * bg-success/10`, `CircleCheck` 20), with its line chosen by where the presence came from (paid, courtesy,
 * before the ticket); the checked-in kind gains the refunded line when the read carries it. Every string
 * arrives finished from `eventDetailView`; `{tenant}` was already interpolated as a React text node.
 *
 * The `action` slot carries the manager's "Reativar evento" on a cancelled event before its start and,
 * since 2026-10-20, "Excluir evento" with "Em breve" on any cancelled one (a placeholder: the API
 * cannot delete an event yet).
 */
export function EventBanner({
  banner,
  action,
}: {
  banner: NonNullable<EventDetailView['banner']>;
  action?: ReactNode;
}) {
  const cancelled = banner.kind === 'cancelled';
  const Icon = cancelled ? CalendarX2 : CircleCheck;
  return (
    <div
      data-testid="event-banner"
      data-kind={banner.kind}
      data-variant={banner.kind === 'confirmed' ? banner.variant : undefined}
      className={
        cancelled
          ? 'flex gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-3'
          : 'flex gap-3 rounded-xl border border-success/30 bg-success/10 px-3 py-3'
      }
    >
      <Icon
        size={20}
        aria-hidden
        className={cancelled ? 'shrink-0 text-danger' : 'shrink-0 text-success'}
      />
      <div className="min-w-0">
        <p className="text-sm font-bold text-text">{banner.title}</p>
        <p
          className={
            cancelled
              ? 'break-words text-xs text-text-secondary'
              : 'break-words text-xs text-text-tertiary'
          }
        >
          {banner.body}
        </p>
        {banner.kind === 'checkedIn' && banner.note ? (
          <p data-testid="event-banner-note" className="break-words text-xs text-text-tertiary">
            {banner.note}
          </p>
        ) : null}
        {action ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">{action}</div>
        ) : null}
      </div>
    </div>
  );
}
