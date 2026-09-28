import { cn } from '@rede-social/ui';
import { CalendarDays, Clock, MapPin, Users, Video } from 'lucide-react';

/**
 * The detail page's info grid (UI-D-204), ported from the prototype's `Info` cell.
 *
 * `layout="grid"` is the detail's `grid grid-cols-2 gap-3`: four cells (Data, Horário, Local, and
 * Confirmados, which the host relabels Presentes once the event is past).
 *
 * `layout="ticket"` (06-05, UI-D-208) is the check-in boarding pass's 3-column details row [proto]:
 * `grid grid-cols-3 px-2 py-4`, three CENTRED cells (Data, Horário, Local), the middle one carrying
 * `border-x border-border`. Unlike the detail grid, a ticket value does NOT wrap: every cell is
 * `min-w-0` and its value is `truncate`d, so a 60-character venue ends in an ellipsis on one line and
 * never widens its column, and the Data and Horário cells keep their width at 320px (UI E08
 * overflow / long-text).
 *
 * Each cell is a 16px icon in `text-text-tertiary` (the prototype's `text-accent` normalised to
 * neutral, UI-D-42), a label 12/700 uppercase tracking-wider tertiary (proto 10px normalised up) and a
 * value 14/700 that WRAPS inside its cell: a multi-day range or a long venue never truncates here.
 *
 * `ariaLiveIndex` marks ONE cell `aria-live="polite"`: the count, so a screen reader hears it change
 * after an RSVP refresh. Presentational and props-only; it **ships no words** (PWA-03).
 */
export type EventInfoIcon = 'date' | 'time' | 'place' | 'online' | 'people';

export interface EventInfoCell {
  icon: EventInfoIcon;
  label: string;
  value: string;
}

export interface EventInfoGridProps {
  layout: 'grid' | 'ticket';
  cells: readonly EventInfoCell[];
  /** The index of the cell announced politely when its value changes (the count). */
  ariaLiveIndex?: number;
}

const ICONS = {
  date: CalendarDays,
  time: Clock,
  place: MapPin,
  online: Video,
  people: Users,
} as const;

export function EventInfoGrid({ layout, cells, ariaLiveIndex }: EventInfoGridProps) {
  if (layout === 'ticket') {
    return (
      <div
        data-testid="event-info-grid"
        data-layout="ticket"
        className="grid grid-cols-3 px-2 py-4"
      >
        {cells.map((cell, index) => {
          const Icon = ICONS[cell.icon];
          return (
            <div
              key={`${cell.icon}-${cell.label}`}
              data-testid="event-info-cell"
              className={cn(
                'flex min-w-0 flex-col items-center gap-1 px-1 text-center',
                index === 1 && 'border-x border-border',
              )}
            >
              <Icon size={16} aria-hidden className="shrink-0 text-text-tertiary" />
              <p className="w-full truncate text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {cell.label}
              </p>
              <p
                data-testid="event-info-value"
                title={cell.value}
                className="w-full truncate text-sm font-bold text-text tabular-nums"
              >
                {cell.value}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div data-testid="event-info-grid" className="grid grid-cols-2 gap-3">
      {cells.map((cell, index) => {
        const Icon = ICONS[cell.icon];
        return (
          <div
            key={`${cell.icon}-${cell.label}`}
            data-testid="event-info-cell"
            className="flex min-w-0 items-start gap-2"
          >
            <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-text-tertiary" />
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                {cell.label}
              </p>
              <p
                data-testid="event-info-value"
                className="break-words text-sm font-bold text-text tabular-nums"
                aria-live={index === ariaLiveIndex ? 'polite' : undefined}
              >
                {cell.value}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
