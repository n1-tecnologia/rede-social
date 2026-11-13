import { CalendarX2, Clock, Lock } from 'lucide-react';
import type { EventTicketSection } from '@/lib/events-view';
import { TicketDoorActions } from '../TicketDoorActions';

/**
 * A finished state with NO form (UI E08/partial): a centred 28px icon (`Clock`, or `CalendarX2` for a
 * cancelled event) and one sentence that reads as the EVENT's state, not as a broken form.
 *
 * Phase 10.1-13 (D-742, UI-D-752) adds the `paid` kind: a member of a paid event who holds no presence.
 * Same block with `Lock` 28 and the sentence "O check-in é só para quem tem ingresso.", then, under it
 * (`mt-4 flex flex-col gap-2`), the brand "Comprar ingresso" anchor when the sale is open and the outline
 * "Ver evento". It never carries the code form or the "abre 1 hora antes" sentence. The `labels` arrive
 * finished from the page, so this block stays props-only.
 */
export function CheckinState({
  section,
  paid,
}: {
  section: Exclude<EventTicketSection, { kind: 'open' } | { kind: 'done' }>;
  /** The labels and the detail link of the `paid` section's actions; ignored by every other kind. */
  paid?: { detailHref: string; buyLabel: string; newTabLabel: string; detailLabel: string };
}) {
  const Icon = section.kind === 'cancelled' ? CalendarX2 : section.kind === 'paid' ? Lock : Clock;
  return (
    <div
      data-testid="checkin-state"
      data-kind={section.kind}
      className="flex flex-col items-center gap-3 py-2 text-center"
    >
      <Icon size={28} aria-hidden className="shrink-0 text-text-tertiary" />
      <p className="max-w-[280px] break-words text-sm text-text-secondary">{section.sentence}</p>
      {section.kind === 'paid' && paid ? (
        <div className="mt-1 flex w-full flex-col items-center">
          <TicketDoorActions
            buyHref={section.buyHref}
            buyLabel={paid.buyLabel}
            newTabLabel={paid.newTabLabel}
            detailHref={paid.detailHref}
            detailLabel={paid.detailLabel}
          />
        </div>
      ) : null}
    </div>
  );
}
