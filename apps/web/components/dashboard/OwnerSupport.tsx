import { tenantOwnerPanel } from '@rede-social/module-dashboard/fixtures';
import {
  BarList,
  Collapsible,
  CountUp,
  KpiCard,
  KpiGrid,
  LineChart,
  percentOf,
  sumOf,
} from '@rede-social/module-dashboard/ui';
import { cn } from '@rede-social/ui';
import {
  Ban,
  Hourglass,
  LockOpen,
  MessageCircleMore,
  MessageSquareX,
  Percent,
  Timer,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  formatCount,
  formatDuration,
  formatHoursMinutes,
  formatPercent,
  formatRatio,
  kpiDelta,
} from './format';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

/**
 * Level 4, "Atendimento", on the member report's look: the queue now (two cards) and the weekly
 * first-response median in a wide card with its chart beside it, a
 * row of their own at two columns and side by side at four; then closed: conversations per week,
 * per subject (the closed block names the leading subject, C-5), answered per person of the
 * client's team (staff names only, never a member's) and moderation with its removal rate. The
 * closed blocks' summaries count up, but the two that name their window ("4 semanas", "30 dias"),
 * which would count the window too.
 */
export async function OwnerSupport() {
  const t = await getTranslations('dashboard');
  const { support, moderation, channels } = tenantOwnerPanel;
  const { awaiting, firstResponse, weeklyConversations, bySubject, answeredByStaff } = support;
  const evenWeeks = (values: readonly number[]) =>
    values.map((_, i) => ((i + 1) % 2 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : ''));
  const median = firstResponse.weeklyMedianMinutes.at(-1);
  const subjects = [...bySubject.value].sort((a, b) => b.conversations - a.conversations);
  const subjectTotal = sumOf(subjects, (row) => row.conversations);
  const leader = subjects[0];
  const staff = [...answeredByStaff].sort((a, b) => b.conversations - a.conversations);
  const comments = channels.find((row) => row.channel === 'comments')?.count ?? 0;
  const removalRate = comments > 0 ? moderation.removedComments / comments : 0;

  return (
    <>
      <PanelSection
        title={t('tenantOwner.queue.title')}
        className={cn(SPAN_ALL, median !== undefined && '@min-[100rem]:col-span-1')}
      >
        {/* The columns' gap is the area's, so the two cards line up with the blocks under them. */}
        <KpiGrid className="grid-cols-2 @4xl:flex-1 @4xl:grid-cols-2 @4xl:gap-x-6 @min-[100rem]:grid-cols-1">
          <KpiCard
            icon={MessageCircleMore}
            label={t('tenantOwner.queue.awaiting')}
            value={formatCount(awaiting.count)}
          />
          <KpiCard
            icon={Hourglass}
            label={t('tenantOwner.queue.oldest')}
            value={formatHoursMinutes(t, awaiting.oldestHours * 60)}
          />
        </KpiGrid>
      </PanelSection>

      {median !== undefined ? (
        <PanelSection
          title={t('tenantOwner.firstResponse.title')}
          className={cn(SPAN_ALL, '@min-[100rem]:col-span-3')}
        >
          {/* At four columns it fills the height of the queue beside it. */}
          <div className="grid @4xl:flex-1">
            <KpiCard
              icon={Timer}
              label={t('tenantOwner.firstResponse.median')}
              value={formatDuration(t, median)}
              delta={kpiDelta(t, firstResponse.delta)}
              chartPlacement="side"
              chart={
                <LineChart
                  series={firstResponse.weeklyMedianMinutes}
                  xLabels={evenWeeks(firstResponse.weeklyMedianMinutes)}
                  yStep={30}
                  formatValue={(value) => formatDuration(t, value)}
                  ariaLabel={t('tenantOwner.firstResponse.chartLabel')}
                  height={150}
                />
              }
            />
          </div>
        </PanelSection>
      ) : null}

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

      <Collapsible
        title={t('tenantOwner.subjects.title')}
        summary={
          leader ? (
            <CountUp
              value={t('tenantOwner.subjects.summary', {
                subject: t(`tenantOwner.subjects.${leader.subject}`),
                count: formatCount(leader.conversations),
                percent: formatPercent(percentOf(leader.conversations, subjectTotal)),
              })}
            />
          ) : undefined
        }
      >
        <BarList
          rows={subjects.map((row, i) => ({
            id: row.subject,
            label: t(`tenantOwner.subjects.${row.subject}`),
            value: row.conversations,
            display: formatCount(row.conversations),
            rate: formatPercent(percentOf(row.conversations, subjectTotal)),
            highlight: i === 0,
          }))}
        />
      </Collapsible>

      <Collapsible
        title={t('tenantOwner.team.title')}
        summary={t('tenantOwner.team.summary', {
          count: formatCount(sumOf(staff, (row) => row.conversations)),
          people: staff.length,
        })}
      >
        <BarList
          rows={staff.map((row, i) => ({
            id: row.id,
            label: row.name,
            value: row.conversations,
            display: formatCount(row.conversations),
            highlight: i === 0,
          }))}
        />
      </Collapsible>

      <Collapsible
        title={t('tenantOwner.moderation.title')}
        summary={
          <CountUp
            value={t('tenantOwner.moderation.summary', { rate: formatRatio(removalRate) })}
          />
        }
      >
        <KpiGrid className="@4xl:grid-cols-2">
          <KpiCard
            icon={MessageSquareX}
            label={t('tenantAdmin.moderation.removed')}
            value={formatCount(moderation.removedComments)}
            unit={t('member.activity.presence.attendanceOf', { total: formatCount(comments) })}
          />
          <KpiCard
            icon={Percent}
            label={t('tenantOwner.moderation.rate')}
            value={formatRatio(removalRate)}
          />
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
