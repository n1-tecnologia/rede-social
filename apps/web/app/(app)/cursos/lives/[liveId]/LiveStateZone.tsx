import { buttonClasses, Card } from '@rede-social/ui';
import { CalendarClock, CircleX, ExternalLink } from 'lucide-react';
import { MemberMaterials } from '@/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberMaterials';
import {
  CourseActionZone,
  type LockedCourseZone,
} from '@/app/(app)/cursos/[courseId]/CourseActionZone';
import { ReminderToggle } from '@/app/(app)/cursos/ReminderToggle';
import type { LiveZoneView } from '@/lib/courses-member-view';
import { LiveReplayButton } from './LiveReplay';

/**
 * The live page's state zone (08.5-09, UI-D-435, D-431..D-434, COURSE-24): EXACTLY ONE of six,
 * chosen by the API's `state` — the page never decides it with the browser clock (UI-D-436).
 *
 *  - `cancelled` → a `Card p-4` with `CircleX` 20 tertiary and "Esta live foi cancelada." — no
 *    link, no replay, no buy, at any time (a cancelled live keeps its page, D-431);
 *  - `locked` → the plan-07 locked markup (`CourseActionZone`'s locked variants) with the live's
 *    words from `lockedLiveView`: one product → the "Comprar para liberar" LINK to
 *    `/loja/{id}?live={liveId}`, several → the "Opções de acesso" sheet, none → "Esta live não está
 *    à venda no momento.", the store read failed → (d) with its retry. A tap only navigates (PR-4);
 *  - `before` → a `Card p-4 flex gap-3`: `CalendarClock` 20, "Começa em {date}, às {time}." (or
 *    "Começa hoje, às {time}.") 14/700 and the hint 12/400 tertiary — and, under it (`mt-3`), the
 *    reminder toggle (08.6-11, UI-D-453) when the host passes `reminder` (the API's `before` state
 *    only: inside the window, after the start, cancelled, ended or locked there is none, because the
 *    reminder fires at the window's opening and the API refuses it afterwards);
 *  - `open` → the brand `<a target="_blank" rel="noopener noreferrer">` "Entrar na live"
 *    (`ExternalLink` 18) to the API's `joinUrl`, and its helper. The link exists only here: outside
 *    the window, and for a locked live, the API sends no link and nothing here can build one
 *    (PR-1, T-08.5-07); `rel` keeps the third-party room from reaching back (T-08.5-16);
 *  - `replay` → "Assistir ao replay" (`LiveReplay`), then "Materiais da gravação" when the replay
 *    lesson has materials (absent with none, E10 zero-one-many);
 *  - `ended` → a `Card p-4` with "Esta live já aconteceu. A gravação não está disponível.".
 *
 * Every word arrives finished (`livePageView`); all of it is React text.
 */
export interface LiveStateZoneProps {
  zone: LiveZoneView;
  /** The composed buy section; read only in the `locked` state. */
  locked: LockedCourseZone | null;
  /**
   * The reminder toggle's inputs (08.6-11), drawn only in the `before` zone; null elsewhere. The
   * initial state is the server's (`GET …/reminder`, R-A12); `preview` disables it (UI-D-459).
   */
  reminder?: { liveId: string; liveTitle: string; initialOn: boolean; preview: boolean } | null;
}

/**
 * The brand fill as a LINK (the shipped `Button` is a `<button>`, and the room is a route away), built
 * by `buttonClasses` (`md` already carries `gap-2`).
 */
const BRAND_LINK = buttonClasses({ variant: 'brand', size: 'md', fullWidth: true });

export function LiveStateZone({ zone, locked, reminder = null }: LiveStateZoneProps) {
  if (zone.state === 'locked') {
    return (
      <div data-testid="live-state-zone" data-state="locked" className="flex flex-col">
        <CourseActionZone action={null} locked={locked} />
      </div>
    );
  }

  if (zone.state === 'replay') {
    return (
      <>
        <div data-testid="live-state-zone" data-state="replay" className="px-4 pt-4">
          {zone.video ? (
            <LiveReplayButton label={zone.label} />
          ) : (
            <Card className="p-4">
              <p className="text-sm font-normal text-text-secondary">{zone.noVideoText}</p>
            </Card>
          )}
        </div>
        {zone.materials.length > 0 ? (
          <div data-testid="live-replay-materials" className="pt-6">
            <MemberMaterials
              lessonId={zone.lessonId}
              materials={zone.materials}
              countLabel={zone.materialsCount}
              title={zone.materialsTitle}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div data-testid="live-state-zone" data-state={zone.state} className="px-4 pt-4">
      {zone.state === 'cancelled' ? (
        <Card className="flex items-center gap-3 p-4">
          <CircleX aria-hidden size={20} className="shrink-0 text-text-tertiary" />
          <p className="text-sm font-normal text-text-secondary">{zone.text}</p>
        </Card>
      ) : zone.state === 'before' ? (
        <>
          <Card className="flex gap-3 p-4">
            <CalendarClock aria-hidden size={20} className="mt-0.5 shrink-0 text-text-secondary" />
            <div className="flex min-w-0 flex-col gap-1">
              <p data-testid="live-starts" className="text-sm font-bold text-text">
                {zone.line}
              </p>
              <p className="text-xs font-normal text-text-tertiary">{zone.hint}</p>
            </div>
          </Card>
          {reminder ? (
            <ReminderToggle
              key={`${reminder.liveId}:${reminder.initialOn}:${reminder.preview}`}
              liveId={reminder.liveId}
              liveTitle={reminder.liveTitle}
              initialOn={reminder.initialOn}
              preview={reminder.preview}
              className="mt-3"
            />
          ) : null}
        </>
      ) : zone.state === 'open' ? (
        <div className="flex flex-col gap-2">
          <a
            href={zone.href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="live-join"
            className={BRAND_LINK}
          >
            <ExternalLink aria-hidden size={18} />
            {zone.label}
          </a>
          <p data-testid="live-join-helper" className="text-xs font-normal text-text-tertiary">
            {zone.helper}
          </p>
        </div>
      ) : (
        <Card className="p-4">
          <p className="text-sm font-normal text-text-secondary">{zone.text}</p>
        </Card>
      )}
    </div>
  );
}
