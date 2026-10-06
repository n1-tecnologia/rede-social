'use client';

import { Button, Input } from '@rede-social/ui';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SelectMenu } from '@/components/forms/SelectMenu';
import {
  EXTRAS_CAPS,
  isScheduleTime,
  normaliseSchedule,
  type ScheduleItem,
} from '@/lib/event-extras';

const DAY_MS = 86_400_000;

/** Calendar days only: both dates are the same tenant wall clock, read as UTC midnights. */
const DAY_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * How many calendar days `startDate`..`endDate` (`YYYY-MM-DD`) spans: 1 while either is unset or
 * the end comes first, at most `EXTRAS_CAPS.scheduleDays`.
 */
export function eventSpanDays(startDate: string, endDate: string): number {
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const to = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 1;
  return Math.min(Math.round((to - from) / DAY_MS) + 1, EXTRAS_CAPS.scheduleDays);
}

/** "seg., 20 de out." for the event's `day` (1 = the start date), or null without a start date. */
function dayDate(startDate: string, day: number): string | null {
  const from = Date.parse(`${startDate}T12:00:00Z`);
  return Number.isNaN(from) ? null : DAY_FORMAT.format(new Date(from + (day - 1) * DAY_MS));
}

export interface ScheduleEditorProps {
  /** The moments so far, sorted by day and time (`normaliseSchedule`). */
  items: ScheduleItem[];
  onChange: (items: ScheduleItem[]) => void;
  /** The event's start date (`YYYY-MM-DD`, '' while unset): it dates the days. */
  startDate: string;
  /** How many calendar days the event spans (`eventSpanDays`); one day shows no day field. */
  days: number;
}

/**
 * Step 2's "Cronograma" (2026-10-06): the event's programme, one moment at a time: the time and
 * what happens then, plus the day for an event over several days (`SelectMenu`, each day with its
 * date). "Adicionar ao cronograma" adds it (Enter in the text does too, never submitting the form)
 * once the time and the text are there; the same moment twice is added once. Below, the moments
 * sorted by day and time, grouped by day when there are several, each with its own remove control.
 * At most `EXTRAS_CAPS.scheduleItems` moments of up to `EXTRAS_CAPS.scheduleTitle` characters.
 */
export function ScheduleEditor({ items, onChange, startDate, days }: ScheduleEditorProps) {
  const t = useTranslations('events');
  const ids = useId();
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('');
  const [text, setText] = useState('');

  // A moment stored on a day the dates no longer reach still has its day to show.
  const dayCount = Math.max(days, ...items.map((moment) => moment.day));
  const severalDays = dayCount > 1;
  const chosenDay = Math.min(day, dayCount);
  const full = items.length >= EXTRAS_CAPS.scheduleItems;
  const what = text.replace(/\s+/g, ' ').trim();
  const ready = !full && isScheduleTime(time) && what !== '';
  const dayLabel = (n: number) => {
    const date = dayDate(startDate, n);
    return date
      ? t('form.extras.schedule.dayOption', { n, date })
      : t('form.extras.schedule.dayOnly', { n });
  };

  const add = () => {
    if (!ready) return;
    const moment = { day: severalDays ? chosenDay : 1, time, title: what };
    const known = items.some(
      (other) =>
        other.day === moment.day && other.time === moment.time && other.title === moment.title,
    );
    if (!known) onChange(normaliseSchedule([...items, moment]));
    setText('');
    setTime('');
  };

  const groups = severalDays
    ? [...new Set(items.map((moment) => moment.day))].map((n) => ({
        day: n,
        moments: items.filter((moment) => moment.day === n),
      }))
    : [{ day: 1, moments: items }];

  return (
    <div data-schedule-editor className="flex flex-col gap-3">
      {severalDays ? (
        <div className="flex flex-col gap-2">
          <span id={`${ids}-day-label`} className="text-sm font-normal text-text-secondary">
            {t('form.extras.schedule.day')}
          </span>
          <SelectMenu
            options={Array.from({ length: dayCount }, (_, index) => ({
              id: String(index + 1),
              label: dayLabel(index + 1),
            }))}
            value={String(chosenDay)}
            onChange={(id) => setDay(Number(id))}
            labelId={`${ids}-day-label`}
            optionAttribute="schedule-day-option"
          />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[8rem_minmax(0,1fr)]">
        <Input
          id="event-schedule-time"
          type="time"
          step={300}
          label={t('form.extras.schedule.time')}
          value={time}
          disabled={full}
          onChange={(event) => setTime(event.target.value)}
        />
        <Input
          id="event-schedule-what"
          label={t('form.extras.schedule.what')}
          placeholder={t('form.extras.schedule.whatPlaceholder')}
          value={text}
          maxLength={EXTRAS_CAPS.scheduleTitle}
          disabled={full}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="md"
        fullWidth
        data-schedule-add
        onClick={add}
        disabled={!ready}
      >
        <Plus aria-hidden size={16} />
        {t('form.extras.schedule.add')}
      </Button>

      {items.length > 0 ? (
        <div data-schedule-list className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.day} className="flex flex-col gap-1.5">
              {severalDays ? (
                <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
                  {dayLabel(group.day)}
                </p>
              ) : null}
              <ol className="flex flex-col gap-1.5">
                {group.moments.map((moment) => {
                  const index = items.indexOf(moment);
                  return (
                    <li
                      key={`${moment.day}-${moment.time}-${moment.title}`}
                      data-schedule-item={moment.time}
                      className="flex items-center gap-3 rounded-xl bg-bg-input py-1.5 pr-1 pl-3"
                    >
                      <span className="w-11 shrink-0 text-xs font-bold tabular-nums text-brand">
                        {moment.time}
                      </span>
                      <span className="min-w-0 flex-1 break-words text-sm text-text">
                        {moment.title}
                      </span>
                      <button
                        type="button"
                        aria-label={t('form.extras.schedule.remove', {
                          time: moment.time,
                          what: moment.title,
                        })}
                        onClick={() => onChange(items.filter((_, other) => other !== index))}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <X aria-hidden size={14} />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ) : null}
      {full ? (
        <p className="text-xs text-text-tertiary">
          {t('form.extras.schedule.limit', { max: EXTRAS_CAPS.scheduleItems })}
        </p>
      ) : null}
    </div>
  );
}
