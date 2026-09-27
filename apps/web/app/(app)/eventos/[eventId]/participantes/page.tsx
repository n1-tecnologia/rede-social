import { type AttendanceList, EVENT_PERMISSIONS } from '@tria/module-events/contracts';
import { CheckinCodeCard } from '@tria/module-events/ui';
import { Chip, EmptyState, PageHeader } from '@tria/ui';
import { CircleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadAttendance, loadAttendanceSummary } from '@/lib/events';
import {
  attendanceListFromParam,
  attendeeView,
  participantsHref,
  spelledCode,
} from '@/lib/events-view';
import { ActiveChipInView } from './ActiveChipInView';
import { ParticipantsList } from './ParticipantsList';
import { RegenerateCodeControl } from './RegenerateCodeControl';

/** The chip nav's DOM id, shared with `ActiveChipInView`. */
const CHIPS_ID = 'participants-chips';

/**
 * `/eventos/[eventId]/participantes` (EVENT-05, D-215, UI-D-213, sketch 006 Surface 6) — the
 * organiser's attendance screen, reached from the "Participantes" row of the detail's manage card.
 *
 * **Admin only, by PERMISSION.** Without the composed `events.attendance.read` in
 * `bootstrap.permissions` (admin_tenant only in V1; never a role comparison) the page is
 * `notFound()`, the same screen as an unknown event (D-23). The API's literal guard on both reads is
 * the independent second gate (T-06-44).
 *
 * Top to bottom:
 *  1. `PageHeader` "Participantes", back to the detail;
 *  2. the CODE CARD first (D-208: the organiser opens this at the door to read it aloud): the code,
 *     spelled for screen readers, from the admin-only summary read; online, the online note instead.
 *     "Gerar novo código" sits in its action slot only with `events.event.manage` (D-217);
 *  3. the chip nav: three `Chip` links carrying the counts (`pendingConfirmedCount`, `presentCount`,
 *     `notGoingCount`: Pitfall 11, the Confirmados chip is `going` ONLY), `whitespace-nowrap` and
 *     `tabular-nums`, scrolling horizontally when four-digit counts exceed a 320px row (UI E11
 *     backstop), with the active chip kept in view;
 *  4. `ParticipantsList`, keyed by the chip, so a switch starts from the server's page 1.
 *
 * **D-93: a bad `?lista=` is silent.** Only exactly `presentes` or `nao-vao` select those chips;
 * anything else is Confirmados. The summary and page 1 load in parallel; every row string is built
 * here, in the TENANT's timezone, from ONE request instant (UI-D-203).
 */
export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ lista?: string | string[] }>;
}) {
  const [{ eventId }, query, bootstrap, t] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
    getTranslations('events'),
  ]);

  if (!bootstrap.permissions.includes(EVENT_PERMISSIONS.attendanceRead)) notFound();

  const list: AttendanceList = attendanceListFromParam(query.lista);
  const [summaryResult, page] = await Promise.all([
    loadAttendanceSummary(eventId),
    loadAttendance(eventId, list),
  ]);

  if (summaryResult.status === 'not-found') notFound();

  const detailHref = `/eventos/${encodeURIComponent(eventId)}`;
  const header = (
    <PageHeader
      backHref={detailHref}
      backLabel={t('checkin.back')}
      title={t('participants.title')}
    />
  );

  if (summaryResult.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-[680px] pb-6">
        {header}
        <div className="px-4 pt-4">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            title={t('errors.title')}
            body={t('errors.generic')}
            action={
              <a
                href={participantsHref(eventId, list)}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
              >
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }

  const { summary } = summaryResult;
  const canManage = bootstrap.permissions.includes(EVENT_PERMISSIONS.manage);
  const tz = bootstrap.tenant.timezone;
  // ONE clock read for the whole page.
  const nowMs = Date.now();
  const rows = (page?.items ?? []).map((attendee) =>
    attendeeView(attendee, list, { tz, nowMs, t }),
  );

  const chips: { list: AttendanceList; label: string }[] = [
    {
      list: 'confirmed',
      label: t('participants.filter.confirmed', { count: summary.pendingConfirmedCount }),
    },
    { list: 'present', label: t('participants.filter.present', { count: summary.presentCount }) },
    {
      list: 'not_going',
      label: t('participants.filter.notGoing', { count: summary.notGoingCount }),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[680px] pb-6" data-participants>
      {header}
      <CheckinCodeCard
        label={t('participants.code.label')}
        code={summary.checkinCode}
        codeAriaLabel={
          summary.checkinCode
            ? t('participants.code.aria', { spelled: spelledCode(summary.checkinCode) })
            : ''
        }
        helper={t('participants.code.helper')}
        onlineNote={t('participants.online')}
        action={canManage ? <RegenerateCodeControl eventId={eventId} /> : undefined}
      />

      <nav
        id={CHIPS_ID}
        aria-label={t('participants.filter.label')}
        className="relative flex gap-2 overflow-x-auto px-4 pt-4 pb-3 scrollbar-none"
      >
        {chips.map((chip) => (
          <Chip
            key={chip.list}
            href={participantsHref(eventId, chip.list)}
            active={chip.list === list}
            className="tabular-nums"
          >
            {chip.label}
          </Chip>
        ))}
      </nav>
      <ActiveChipInView navId={CHIPS_ID} />

      <ParticipantsList
        key={list}
        eventId={eventId}
        list={list}
        initialItems={rows}
        initialCursor={page?.nextCursor ?? null}
        initialError={page === null}
      />
    </div>
  );
}
