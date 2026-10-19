import type { OwnerSupportReady } from '@rede-social/module-dashboard/contracts';
import {
  BarList,
  Collapsible,
  CountUp,
  KpiCard,
  KpiGrid,
  LineChart,
  RISE,
  SURFACE,
  sumOf,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  Ban,
  Hourglass,
  LockOpen,
  MessageCircleMore,
  MessageSquareX,
  Percent,
  Timer,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getOwnerSupport } from '@/lib/dashboard';
import { freshnessText } from '@/lib/dashboard-view';
import { OWNER_PANEL_ANCHOR, ownerAreaHref } from '@/lib/owner-panel';
import { CardLink } from './CardLink';
import { ComingSoonBlock } from './ComingSoon';
import {
  type DashboardT,
  formatCount,
  formatDuration,
  formatHoursMinutes,
  formatRatio,
  kpiDelta,
} from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';
import { SnapshotFreshness } from './SnapshotFreshness';

/** D-461 / UI-D-476: the queue opens the shipped support inbox. */
const SUPPORT_INBOX_HREF = '/suporte';

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
 * Planning decision 2: the change chip compares the last week's median with the week before, in
 * minutes; a week with no answered turn on either side shows no chip. A faster answer is good news.
 */
function lastWeeksDelta(
  medians: readonly (number | null)[],
): Parameters<typeof kpiDelta>[1] | null {
  const last = medians.at(-1) ?? null;
  const before = medians.at(-2) ?? null;
  if (last === null || before === null) return null;
  const amount = Math.abs(last - before);
  const direction = amount === 0 ? 'flat' : last > before ? 'up' : 'down';
  return {
    amount,
    kind: 'minutes',
    direction,
    good: direction === 'flat' ? null : direction === 'down',
    basis: 'previous_7_days',
  };
}

interface OwnerSupportViewProps {
  t: DashboardT;
  answer: OwnerSupportReady;
}

/**
 * Level 4, "Atendimento", on the API answer (08.7-11, D-455, D-461, D-465, UI-D-476, UI-D-480,
 * UI-D-481, INSIGHT-13), on the member report's look: the queue at the last update (two cards, the
 * waiting one a link to `/suporte`) and the weekly first-response median in a wide card with its
 * chart beside it, a row of their own at two columns and side by side at four; then closed:
 * conversations per week, "Atendimentos por assunto" as an "Em breve" block in place of its
 * collapsible (not expandable, D-465), the client's team (staff names only, as stored) and
 * moderation with its removal rate (removed ÷ the window's live comments; none without comments).
 * A median with no answered turn is a gap in the chart, never 0; with no answered turn in 8 weeks
 * the chart gives way to its empty sentence, as an empty team does.
 */
export function OwnerSupportView({ t, answer }: OwnerSupportViewProps) {
  const { awaiting, weeklyMedianMinutes, weeklyConversations, answeredByStaff, moderation } =
    answer;
  const evenWeeks = (values: readonly unknown[]) =>
    values.map((_, i) => ((i + 1) % 2 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : ''));
  const answeredWeeks = weeklyMedianMinutes.some((value) => value !== null);
  const median = weeklyMedianMinutes.at(-1) ?? null;
  const delta = lastWeeksDelta(weeklyMedianMinutes);
  const staff = [...answeredByStaff].sort(
    (a, b) => b.conversations - a.conversations || a.userId.localeCompare(b.userId),
  );
  const removalRate =
    moderation.comments30 > 0 ? moderation.removedComments / moderation.comments30 : null;

  return (
    <>
      <PanelSection
        title={t('tenantOwner.queue.title')}
        className={cn(SPAN_ALL, '@min-[100rem]:col-span-1')}
      >
        {/* The columns' gap is the area's, so the two cards line up with the blocks under them. */}
        <KpiGrid className="grid-cols-2 @4xl:flex-1 @4xl:grid-cols-2 @4xl:gap-x-6 @min-[100rem]:grid-cols-1">
          <CardLink href={SUPPORT_INBOX_HREF}>
            <KpiCard
              icon={MessageCircleMore}
              label={t('tenantOwner.queue.awaiting')}
              value={formatCount(awaiting.count)}
              linked={t('tenantOwner.queue.open')}
            />
          </CardLink>
          <KpiCard
            icon={Hourglass}
            label={t('tenantOwner.queue.oldest')}
            value={formatHoursMinutes(t, (awaiting.oldestHours ?? 0) * 60)}
          />
        </KpiGrid>
      </PanelSection>

      <PanelSection
        title={t('tenantOwner.firstResponse.title')}
        className={cn(SPAN_ALL, '@min-[100rem]:col-span-3')}
      >
        {answeredWeeks ? (
          /* At four columns it fills the height of the queue beside it. */
          <div className="grid @4xl:flex-1">
            <KpiCard
              icon={Timer}
              label={t('tenantOwner.firstResponse.median')}
              value={
                median === null
                  ? t('tenantOwner.firstResponse.noLastWeek')
                  : formatDuration(t, median)
              }
              delta={delta ? kpiDelta(t, delta) : undefined}
              chartPlacement="side"
              chart={
                <LineChart
                  series={weeklyMedianMinutes}
                  xLabels={evenWeeks(weeklyMedianMinutes)}
                  yStep={30}
                  formatValue={(value) => formatDuration(t, value)}
                  ariaLabel={t('tenantOwner.firstResponse.chartLabel')}
                  height={150}
                />
              }
            />
          </div>
        ) : (
          <Empty id="first-response" text={t('tenantOwner.firstResponse.empty')} />
        )}
      </PanelSection>

      <Collapsible
        title={t('tenantOwner.volume.title')}
        summary={t('tenantOwner.volume.summary', {
          count: formatCount(sumOf(weeklyConversations.slice(-4), (n) => n)),
        })}
      >
        <LineChart
          series={weeklyConversations}
          xLabels={evenWeeks(weeklyConversations)}
          yStep={5}
          formatValue={formatCount}
          ariaLabel={t('tenantOwner.volume.chartLabel')}
          height={150}
        />
      </Collapsible>

      <ComingSoonBlock
        title={t('tenantOwner.subjects.title')}
        label={t('report.comingSoon.value')}
        note={t('report.comingSoon.block')}
      />

      <Collapsible
        title={t('tenantOwner.team.title')}
        summary={
          staff.length > 0
            ? t('tenantOwner.team.summary', {
                count: formatCount(sumOf(staff, (row) => row.conversations)),
                people: staff.length,
              })
            : undefined
        }
      >
        {staff.length > 0 ? (
          <BarList
            rows={staff.map((row, i) => ({
              id: row.userId,
              label: row.name,
              value: row.conversations,
              display: formatCount(row.conversations),
              highlight: i === 0,
            }))}
          />
        ) : (
          <Empty id="team" text={t('tenantOwner.team.empty')} />
        )}
      </Collapsible>

      <Collapsible
        title={t('tenantOwner.moderation.title')}
        summary={
          removalRate === null ? undefined : (
            <CountUp
              value={t('tenantOwner.moderation.summary', { rate: formatRatio(removalRate) })}
            />
          )
        }
      >
        <KpiGrid className="@4xl:grid-cols-2">
          <KpiCard
            icon={MessageSquareX}
            label={t('tenantAdmin.moderation.removed')}
            value={formatCount(moderation.removedComments)}
            unit={t('member.activity.presence.attendanceOf', {
              total: formatCount(moderation.comments30),
            })}
          />
          {removalRate === null ? null : (
            <KpiCard
              icon={Percent}
              label={t('tenantOwner.moderation.rate')}
              value={formatRatio(removalRate)}
            />
          )}
          <KpiCard
            icon={Ban}
            label={t('tenantAdmin.moderation.blocks')}
            value={formatCount(moderation.blocks)}
          />
          <KpiCard
            icon={LockOpen}
            label={t('tenantAdmin.moderation.unblocks')}
            value={formatCount(moderation.unblocks)}
          />
        </KpiGrid>
      </Collapsible>
    </>
  );
}

/**
 * Atendimento from the snapshot (08.7-11, D-460, D-464, UI-D-469, UI-D-474, UI-D-479): awaits
 * `getOwnerSupport()` inside the area's own `Suspense`. With `chat` off the API answers
 * `MODULE_DISABLED` and the whole area, its Moderação included, renders nothing (Moderação is not
 * moved to Membros). A failed read shows the area's error card, `preparing` the preparing card, and
 * `ready` the freshness line first, then the area.
 */
export async function OwnerSupport({ timeZone }: { timeZone: string }) {
  const [t, result] = await Promise.all([getTranslations('dashboard'), getOwnerSupport()]);
  if (result.status === 'disabled') return null;
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        retryHref={`${ownerAreaHref('atendimento')}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  const answer = result.answer;
  const freshness = freshnessText(answer.snapshot, timeZone, Date.now());
  return (
    <>
      <SnapshotFreshness text={t(`report.freshness.${freshness.key}`, { ...freshness.values })} />
      <OwnerSupportView t={t} answer={answer} />
    </>
  );
}
