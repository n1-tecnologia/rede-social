import { CalendarX2, Clock } from 'lucide-react';
import type { EventTicketSection } from '@/lib/events-view';

/**
 * A finished state with NO form (UI E08/partial): a centred 28px icon (`Clock`, or `CalendarX2` for a
 * cancelled event) and one sentence that reads as the EVENT's state, not as a broken form.
 */
export function CheckinState({
  section,
}: {
  section: Exclude<EventTicketSection, { kind: 'open' } | { kind: 'done' }>;
}) {
  const Icon = section.kind === 'cancelled' ? CalendarX2 : Clock;
  return (
    <div
      data-testid="checkin-state"
      data-kind={section.kind}
      className="flex flex-col items-center gap-3 py-2 text-center"
    >
      <Icon size={28} aria-hidden className="shrink-0 text-text-tertiary" />
      <p className="max-w-[280px] break-words text-sm text-text-secondary">{section.sentence}</p>
    </div>
  );
}
