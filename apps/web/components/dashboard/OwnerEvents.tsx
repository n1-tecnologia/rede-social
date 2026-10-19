import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import {
  type EngagementBandsAnswer,
  EVENT_FORMATS,
  type EventFormatId,
  type OwnerEventsReady,
  type OwnerPastEventAnswer,
} from '@rede-social/module-dashboard/contracts';
import {
  attendancePercent,
  BarList,
  Collapsible,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  engagedPercent,
  percentOf,
  RISE,
  SURFACE,
  sumOf,
  topBy,
} from '@rede-social/module-dashboard/ui';
import { EventCover } from '@rede-social/module-events/ui';
import { Card, cn } from '@rede-social/ui';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getOwnerEvents, getOwnerMembers } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';
import { localDate, localMoment } from '@/lib/owner-list-view';
import { OWNER_PANEL_ANCHOR, ownerAreaHref } from '@/lib/owner-panel';
import { EventCard } from './BandScopeCards';
import { ComingSoonBlock, ComingSoonPill } from './ComingSoon';
import { bandLabel, type DashboardT, formatCount, formatDayMonth, formatPercent } from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

/**
 * The closed analyses of the past events: one cell each at two columns; at four, one stack two
 * cells wide beside the waiting list, starting on the line of its cards (under its title row).
 */
const CLOSED_STACK =
  'flex flex-col gap-6 @4xl:contents @min-[100rem]:col-span-2 @min-[100rem]:flex @min-[100rem]:gap-3 @min-[100rem]:pt-11';

/** D-461: an event row opens the shipped attendee list of that event. */
function attendeesHref(eventId: string): string {
  return `/eventos/${eventId}/participantes`;
}

/**
 * The cards' 16:10 cover as a 56 px thumbnail before an event's bar (quick 261013-p31 D-03), from the
 * event's live cover. Decorative: the row's text already names the event.
 */
function EventThumb({ coverAssetId }: { coverAssetId: string | null }) {
  return (
    <span
      aria-hidden
      data-event-thumb
      className="block aspect-[16/10] h-14 shrink-0 overflow-hidden rounded-lg"
    >
      <EventCover
        geometry="hero"
        coverAssetId={coverAssetId}
        coverVariantWidths={PURPOSE_WIDTHS.cover}
        coverAlt=""
      />
    </span>
  );
}

/** One block's empty sentence, inside its card (UI-D-481). */
function Empty({ id, text }: { id: string; text: string }) {
  return (
    <Card className={cn(SURFACE, RISE, 'p-4')}>
      <p data-owner-empty={id} className="text-xs font-normal text-text-secondary">
        {text}
      </p>
    </Card>
  );
}

/**
 * An event's attendance as the shipped `attendancePercent` reads it (EP-36, UI-D-485's rule): the
 * presences (check-ins + walk-ins) over everyone who was in (confirmed + walk-ins). A walk-in is a
 * presence in both, never a confirmed RSVP (EP-33), so the share never passes 100%.
 */
function presenceRow(event: Pick<OwnerPastEventAnswer, 'confirmed' | 'checkIns' | 'walkIns'>) {
  return { checkIns: event.checkIns + event.walkIns, confirmed: event.confirmed + event.walkIns };
}

/** "24/10, 19h" or "25/10, 20h30": the event's start in the tenant's zone. */
function whenText(t: DashboardT, startsAt: string, timeZone: string): string {
  const [hour = '0', minutes = '00'] = localMoment(
    startsAt,
    timeZone,
    Date.parse(startsAt),
  ).time.split(':');
  return t('tenantOwner.upcoming.when', {
    date: formatDayMonth(localDate(startsAt, timeZone)),
    hour: Number(hour),
    minutes: minutes === '00' ? 'none' : minutes,
  });
}

export interface OwnerEventsViewProps {
  t: DashboardT;
  /** `GET /v1/dashboard/owner/events`, ready. */
  answer: OwnerEventsReady;
  /** Membros' bands of the same build, for "Quem vai aos eventos"' sentence; null leaves it out. */
  engagement: EngagementBandsAnswer | null;
  /** `bootstrap.tenant.timezone`: an event's date and hour are the tenant's. */
  timeZone: string;
}

/**
 * Level 4, "Eventos", on the snapshot (08.7-08, INSIGHT-11), on the member report's look:
 * - the next events as the bands' event cards side by side, rising one after the other: Inscritos,
 *   the seats left (none with no capacity, "Lotado" when full) and "Receita" as the "Em breve" line
 *   (D-455: no ticket price is stored); each card opens the event's attendee list (D-461);
 * - "Lista de espera" as an "Em breve" block, its "Ver lista de espera" disabled with the pill
 *   (D-455, UI-D-478: no waiting list is recorded);
 * - then closed: attendance per past event (presences over everyone who was in) with its cover,
 *   each row opening its attendee list; in person against online; and who comes by the band the
 *   member was in on the day before the event (UI-D-489 c).
 * Counts only: no member is named. A block with no rows shows its sentence (UI-D-481).
 */
export function OwnerEventsView({ t, answer, engagement, timeZone }: OwnerEventsViewProps) {
  const { upcoming, past, attendanceByBand } = answer;
  const comingSoon = t('report.comingSoon.value');
  const eventPercent = (row: OwnerPastEventAnswer) =>
    Math.round(attendancePercent([presenceRow(row)]));
  const best = topBy(past, eventPercent);
  const formats = EVENT_FORMATS.map((format: EventFormatId) => {
    const rows = past.filter((row) => row.format === format);
    return {
      format,
      percent: attendancePercent(rows.map(presenceRow)),
      events: rows.length,
      full: rows.filter((row) => row.capacity !== null && row.confirmed >= row.capacity).length,
    };
  });
  const formatOf = (format: EventFormatId) =>
    formatPercent(formats.find((row) => row.format === format)?.percent ?? 0);
  const presences = sumOf(ENGAGEMENT_BAND_ORDER, (band) => attendanceByBand[band]);

  return (
    <>
      <PanelSection title={t('tenantOwner.upcoming.title')} className={SPAN_ALL}>
        {upcoming.length === 0 ? (
          <Empty id="upcoming" text={t('tenantOwner.upcoming.empty')} />
        ) : (
          // From a 100rem container the cards are wider: the cover goes 16:7 to keep its height.
          <ul
            data-dash-stagger
            className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3 @min-[100rem]:[&_[data-geometry=hero]]:aspect-[16/7]"
          >
            {upcoming.map((row) => (
              <li key={row.id} className="grid min-w-0">
                <EventCard
                  t={t}
                  event={{ name: row.title, format: row.format, coverAssetId: row.coverAssetId }}
                  href={attendeesHref(row.id)}
                  detail={whenText(t, row.startsAt, timeZone)}
                  cells={[
                    {
                      label: t('tenantOwner.upcoming.columns.confirmed'),
                      value: formatCount(row.confirmed),
                    },
                    {
                      label: t('tenantOwner.upcoming.columns.left'),
                      value:
                        row.capacity === null
                          ? t('tenantOwner.upcoming.unlimited')
                          : row.capacity - row.confirmed <= 0
                            ? t('tenantOwner.upcoming.full')
                            : formatCount(row.capacity - row.confirmed),
                    },
                    {
                      label: t('tenantOwner.scopeCards.event.revenue'),
                      value: comingSoon,
                      node: <ComingSoonPill label={comingSoon} />,
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title={t('tenantOwner.waitlist.title')} className={SPAN_HALF}>
        <div className="flex flex-col gap-3">
          <ComingSoonBlock label={comingSoon} note={t('report.comingSoon.block')} />
          <DisabledAction variant="outline" pill={comingSoon}>
            {t('tenantOwner.waitlist.see')}
          </DisabledAction>
        </div>
      </PanelSection>

      <div className={CLOSED_STACK}>
        <Collapsible
          title={t('tenantOwner.attendance.title')}
          summary={
            past.length === 0 ? undefined : (
              <CountUp
                value={t('tenantOwner.attendance.summary', {
                  percent: formatPercent(attendancePercent(past.map(presenceRow))),
                })}
              />
            )
          }
        >
          {past.length === 0 ? (
            <Empty id="attendance" text={t('tenantOwner.attendance.empty')} />
          ) : (
            <BarList
              max={100}
              rows={past.map((row) => {
                const shares = presenceRow(row);
                return {
                  id: row.id,
                  label: row.title,
                  value: eventPercent(row),
                  display: formatPercent(eventPercent(row)),
                  rate: t('tenantOwner.attendance.rate', {
                    checkIns: formatCount(shares.checkIns),
                    confirmed: formatCount(shares.confirmed),
                  }),
                  highlight: row.id === best?.id,
                  leading: <EventThumb coverAssetId={row.coverAssetId} />,
                  href: attendeesHref(row.id),
                };
              })}
            />
          )}
        </Collapsible>

        <Collapsible
          title={t('tenantOwner.formatsCompared.title')}
          summary={
            past.length === 0 ? undefined : (
              <CountUp
                value={t('tenantOwner.formatsCompared.summary', {
                  inPerson: formatOf('in_person'),
                  online: formatOf('online'),
                })}
              />
            )
          }
        >
          {past.length === 0 ? (
            <Empty id="formats" text={t('tenantOwner.formatsCompared.empty')} />
          ) : (
            <BarList
              max={100}
              rows={formats.map((row) => ({
                id: row.format,
                label: t(`tenantOwner.formatsCompared.${row.format}`),
                value: row.percent,
                display: formatPercent(row.percent),
                rate: t('tenantOwner.formatsCompared.rate', { events: row.events, full: row.full }),
              }))}
            />
          )}
        </Collapsible>

        <Collapsible
          title={t('tenantOwner.whoAttends.title')}
          summary={
            presences === 0 || engagement === null ? undefined : (
              <CountUp
                value={t('tenantOwner.whoAttends.sentence', {
                  presences: formatPercent(
                    percentOf(attendanceByBand.superfan + attendanceByBand.engaged, presences),
                  ),
                  members: formatPercent(engagedPercent(engagement)),
                })}
              />
            )
          }
        >
          {presences === 0 ? (
            <Empty id="who" text={t('tenantOwner.whoAttends.empty')} />
          ) : (
            <BarList
              max={presences}
              rows={ENGAGEMENT_BAND_ORDER.map((band) => ({
                id: band,
                label: bandLabel(t, band),
                value: attendanceByBand[band],
                display: formatCount(attendanceByBand[band]),
                rate: formatPercent(percentOf(attendanceByBand[band], presences)),
                highlight: band === 'superfan' || band === 'engaged',
              }))}
            />
          )}
        </Collapsible>
      </div>
    </>
  );
}

/**
 * Level 4, "Eventos", on the snapshot (08.7-08, D-460, INSIGHT-11): reads
 * `GET /v1/dashboard/owner/events` inside the area's own `Suspense` and maps the answer —
 * `disabled` (the tenant does not have `events`) to nothing, a session refusal to the bootstrap's
 * navigation, a failed read to the area's error card with "Tentar novamente" on the same screen
 * (UI-D-479), `preparing` to the preparing card (UI-D-469), `ready` to the freshness line and the
 * area. Membros' cached answer gives the share of engaged members in "Quem vai aos eventos".
 */
export async function OwnerEvents({ timeZone }: { timeZone: string }) {
  const [t, result, members] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerEvents(),
    getOwnerMembers(),
  ]);
  if (result.status === 'disabled') return null;
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        retryHref={`${ownerAreaHref('eventos')}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const answer = result.answer;
  const engagement =
    members.status === 'ok' && members.answer.state === 'ready' ? members.answer.engagement : null;
  const freshness = freshnessText(answer.snapshot, timeZone, Date.now());
  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <OwnerEventsView t={t} answer={answer} engagement={engagement} timeZone={timeZone} />
    </>
  );
}
