'use client';

import { cn } from '@rede-social/ui';
import { useState } from 'react';
import { ExampleTag } from '@/components/events/ExampleTag';
import type { ScheduleDayView } from '@/lib/events-view';

export interface EventScheduleProps {
  days: ScheduleDayView[];
  labels: { title: string; daysLabel: string; note: string; example: string };
}

/**
 * REINE's "Programação" (2026-10-06): one tab per day, the day's timeline below. The system has no
 * programme, so the days and times are the event's own and the titles are ILLUSTRATIVE: the title
 * wears the "Exemplo" tag and a line under the timeline says so.
 */
export function EventSchedule({ days, labels }: EventScheduleProps) {
  const [index, setIndex] = useState(0);
  const day = days[Math.min(index, days.length - 1)];
  if (!day) return null;

  return (
    <section data-testid="event-schedule" aria-labelledby="event-schedule-title" className="px-4">
      <h2
        id="event-schedule-title"
        className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-brand"
      >
        {labels.title}
        <ExampleTag label={labels.example} />
      </h2>
      <div className="rounded-xl border border-border bg-card p-4">
        {days.length > 1 ? (
          <fieldset className="mb-4 flex min-w-0 gap-2 border-0 p-0">
            <legend className="sr-only">{labels.daysLabel}</legend>
            {days.map((item, i) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  'flex-1 rounded-xl py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  i === index ? 'bg-brand text-on-brand' : 'bg-bg-input text-text-secondary',
                )}
              >
                <span className="block text-xs font-bold">{item.label}</span>
                <span
                  className={cn(
                    'mt-0.5 block text-[10px] font-semibold uppercase tracking-wider',
                    i === index ? 'text-on-brand' : 'text-text-tertiary',
                  )}
                >
                  {item.date}
                </span>
              </button>
            ))}
          </fieldset>
        ) : null}
        <ol className="flex flex-col">
          {day.items.map((item, i) => (
            <li key={`${item.time}-${item.title}`} className="flex gap-3">
              <div className="flex w-10 shrink-0 flex-col items-center">
                <span className="text-[11px] font-bold tabular-nums text-brand">{item.time}</span>
                {i < day.items.length - 1 ? (
                  <span aria-hidden className="my-1 w-px flex-1 bg-border" />
                ) : null}
              </div>
              <p
                className={cn(
                  'text-sm font-semibold leading-snug text-text',
                  i < day.items.length - 1 && 'pb-4',
                )}
              >
                {item.title}
              </p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-text-tertiary">{labels.note}</p>
      </div>
    </section>
  );
}
