import { type EventFormat, tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import {
  attendancePercent,
  BarList,
  Collapsible,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  engagedPercent,
  KpiCard,
  KpiGrid,
  percentOf,
  sumOf,
  topBy,
} from '@rede-social/module-dashboard/ui';
import { EventCover } from '@rede-social/module-events/ui';
import { CalendarCheck2, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ownerWaitlistAnchor } from '@/lib/owner-band-scope';
import { EventCard, eventRevenue } from './BandScopeCards';
import { bandLabel, formatCount, formatDayMonth, formatPercent } from './format';
import { SPAN_ALL, SPAN_HALF } from './ownerGrid';
import { PanelSection } from './PanelSection';

const FORMATS: readonly EventFormat[] = ['in_person', 'online'];

/**
 * The closed analyses of the past events: one cell each at two columns; at four, one stack two
 * cells wide beside the waiting list, starting on the line of its cards (under its title row).
 */
const CLOSED_STACK =
  'flex flex-col gap-6 @4xl:contents @min-[100rem]:col-span-2 @min-[100rem]:flex @min-[100rem]:gap-3 @min-[100rem]:pt-11';

/**
 * The cards' 16:10 cover as a 56 px thumbnail before an event's bar (quick 261013-p31 D-03).
 * Decorative: the row's text already names the event.
 */
function EventThumb() {
  return (
    <span
      aria-hidden
      data-event-thumb
      className="block aspect-[16/10] h-14 shrink-0 overflow-hidden rounded-lg"
    >
      <EventCover geometry="hero" coverAssetId={null} coverVariantWidths={[]} coverAlt="" />
    </span>
  );
}

/**
 * Level 4, "Eventos", on the member report's look: the next events as the bands' event cards (quick
 * 261013-p31) side by side, rising one after the other, with their seats left and receita,
 * unlinked because no single place lists who registered for one event (its RSVPs spread over the
 * bands); then the waiting lists of the full events as bars beside two cards (who got a seat out of
 * everyone waiting, and who came out of those who got one); then closed: attendance per past event
 * (check-ins over RSVPs), in person against online, and who comes by engagement band. Counts only:
 * no member is named. The two bar lists that compare events (waiting list, attendance) lead each bar
 * with the event's cover thumbnail; the other two list no event.
 */
export async function OwnerEvents() {
  const t = await getTranslations('dashboard');
  const { events, engagement } = tenantOwnerPanel;
  const { past, upcoming, waitlist, attendanceByBand } = events;
  const waitRows = [...waitlist.value].sort((a, b) => b.waiting - a.waiting);
  const happened = waitlist.value.filter((row) => row.attended !== null);
  const eventPercent = (row: (typeof past)[number]) =>
    Math.round(percentOf(row.checkIns, row.confirmed));
  const best = topBy(past, eventPercent);
  const formats = FORMATS.map((format) => {
    const rows = past.filter((row) => row.format === format);
    return {
      format,
      percent: attendancePercent(rows),
      events: rows.length,
      full: rows.filter((row) => row.capacity !== null && row.confirmed >= row.capacity).length,
    };
  });
  const presences = sumOf(ENGAGEMENT_BAND_ORDER, (band) => attendanceByBand[band]);
  const formatOf = (format: EventFormat) =>
    formatPercent(formats.find((row) => row.format === format)?.percent ?? 0);
  const outOf = (total: number) =>
    t('member.activity.presence.attendanceOf', { total: formatCount(total) });

  return (
    <>
      <PanelSection title={t('tenantOwner.upcoming.title')} className={SPAN_ALL}>
        {/* From a 100rem container the cards are wider: the cover goes 16:7 to keep its height. */}
        <ul
          data-dash-stagger
          className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3 @min-[100rem]:[&_[data-geometry=hero]]:aspect-[16/7]"
        >
          {upcoming.map((row) => (
            <li key={row.id} className="grid min-w-0">
              <EventCard
                t={t}
                id={row.id}
                href={null}
                detail={t('tenantOwner.upcoming.when', {
                  date: formatDayMonth(row.date),
                  hour: row.startsAtHour,
                })}
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
                  { label: t('tenantOwner.scopeCards.event.revenue'), value: eventRevenue(t, row) },
                ]}
              />
            </li>
          ))}
        </ul>
      </PanelSection>

      <PanelSection title={t('tenantOwner.waitlist.title')} className={SPAN_HALF}>
        {/* The columns' gap is the area's, so the bars and the cards line up with the blocks under them. */}
        <div className="flex flex-col gap-3 @4xl:grid @4xl:flex-1 @4xl:grid-cols-2 @4xl:items-stretch @4xl:gap-x-6">
          <BarList
            className="@4xl:flex @4xl:flex-col @4xl:justify-center"
            rows={waitRows.map((row, i) => ({
              id: row.eventId,
              label: row.name,
              value: row.waiting,
              display: t('tenantOwner.waitlist.waiting', { count: formatCount(row.waiting) }),
              rate: t('tenantOwner.waitlist.capacity', { count: formatCount(row.capacity) }),
              highlight: i === 0,
              leading: <EventThumb />,
              anchor: ownerWaitlistAnchor(row.eventId),
            }))}
          />
          <KpiGrid className="grid-cols-2 @4xl:grid-cols-1">
            <KpiCard
              icon={Ticket}
              label={t('tenantOwner.waitlist.gotSeat')}
              value={formatCount(sumOf(waitlist.value, (row) => row.gotSeat))}
              unit={outOf(sumOf(waitlist.value, (row) => row.waiting))}
            />
            <KpiCard
              icon={CalendarCheck2}
              label={t('tenantOwner.waitlist.attended')}
              value={formatCount(sumOf(happened, (row) => row.attended ?? 0))}
              unit={outOf(sumOf(happened, (row) => row.gotSeat))}
            />
          </KpiGrid>
        </div>
      </PanelSection>

      <div className={CLOSED_STACK}>
        <Collapsible
          title={t('tenantOwner.attendance.title')}
          summary={
            <CountUp
              value={t('tenantOwner.attendance.summary', {
                percent: formatPercent(attendancePercent(past)),
              })}
            />
          }
        >
          <BarList
            max={100}
            rows={past.map((row) => ({
              id: row.id,
              label: row.name,
              value: eventPercent(row),
              display: formatPercent(eventPercent(row)),
              rate: t('tenantOwner.attendance.rate', {
                checkIns: formatCount(row.checkIns),
                confirmed: formatCount(row.confirmed),
              }),
              highlight: row.id === best?.id,
              leading: <EventThumb />,
            }))}
          />
        </Collapsible>

        <Collapsible
          title={t('tenantOwner.formatsCompared.title')}
          summary={
            <CountUp
              value={t('tenantOwner.formatsCompared.summary', {
                inPerson: formatOf('in_person'),
                online: formatOf('online'),
              })}
            />
          }
        >
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
        </Collapsible>

        <Collapsible
          title={t('tenantOwner.whoAttends.title')}
          summary={
            <CountUp
              value={t('tenantOwner.whoAttends.sentence', {
                presences: formatPercent(
                  percentOf(attendanceByBand.superfan + attendanceByBand.engaged, presences),
                ),
                members: formatPercent(engagedPercent(engagement)),
              })}
            />
          }
        >
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
        </Collapsible>
      </div>
    </>
  );
}
