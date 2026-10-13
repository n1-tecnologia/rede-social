import {
  Activity,
  Bookmark,
  CalendarCheck2,
  CircleDashed,
  CirclePlay,
  Clock,
  Eye,
  Flame,
  Heart,
  type LucideIcon,
  MessageCircle,
  Send,
  Timer,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  type ActivityDelta,
  dailyAverageMinutes,
  formatCount,
  formatWeekdayShort,
  type MemberActivitySample,
  MIN_STREAK_WEEKS,
} from '@/lib/member-activity-sample';
import { BarList } from './BarList';
import { KpiCard, type KpiDelta, KpiGrid } from './KpiCard';
import { LineChart } from './LineChart';

/**
 * The catalog of `profile.activity` as the report reads it: `getTranslations` on the page and
 * `useTranslations` in the platform preview both fit.
 */
export type ActivityT = (key: string, values?: Record<string, string | number>) => string;

/** One block of the report: an `h3` title, an optional window on its right, then its cards. */
export function ActivityBlock({
  id,
  title,
  period,
  children,
}: {
  id: string;
  title: string;
  period?: string;
  children: ReactNode;
}) {
  return (
    <section data-activity-block={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h3 className="text-sm font-bold text-text">{title}</h3>
        {period ? (
          <span className="shrink-0 text-xs font-medium text-text-tertiary">{period}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A sample change → the card's chip: the bare amount, and the whole comparison for its tooltip. */
function kpiDelta(t: ActivityT, delta: ActivityDelta): KpiDelta {
  const amount =
    delta.kind === 'minutes'
      ? t('minutesAmount', { value: formatCount(delta.amount) })
      : formatCount(delta.amount);
  return { amount, text: t('vsLastWeek', { amount }), direction: delta.direction };
}

export interface MemberActivityReportProps {
  t: ActivityT;
  sample: MemberActivitySample;
  /** "Onde você mais participa": only where the tenant has comunidades (the communities module). */
  showCommunities?: boolean;
}

/**
 * The member's "Sua atividade" on `/perfil` (2026-10-13), the rede-social-dashboard preview's member
 * report (`MemberActivity`) brought into the app: "Tempo de uso" (the daily average, its week in a
 * line chart and the peak hours), "Seu engajamento", "O que você viu", "Onde você mais participa"
 * and "Presença e constância". Synchronous and without data of its own: the host passes the catalog
 * and the numbers (`MEMBER_ACTIVITY_SAMPLE`, sample values until the backend measures them).
 *
 * Every change is neutral (the report describes the member's use, it never grades it), every card
 * is an icon, a label and a value, and the windows are said once ("Últimos 7 dias" on the section,
 * "Últimos 30 dias" on presence). The drill-down lists of the preview (the cards' corner arrows) are
 * not brought: they would be sample lists too.
 */
export function MemberActivityReport({
  t,
  sample,
  showCommunities = true,
}: MemberActivityReportProps) {
  const { usage, peakHours, engagement, seen, byCommunity } = sample;
  const engagementCards: { key: keyof MemberActivitySample['engagement']; icon: LucideIcon }[] = [
    { key: 'likes', icon: Heart },
    { key: 'comments', icon: MessageCircle },
    { key: 'saves', icon: Bookmark },
    { key: 'shares', icon: Send },
  ];

  return (
    <div data-member-activity className="flex flex-col gap-6 px-4">
      <ActivityBlock id="usage" title={t('usage.title')}>
        <KpiCard
          icon={Clock}
          label={t('usage.average')}
          value={formatCount(dailyAverageMinutes(usage.days))}
          unit={t('usage.unit')}
          delta={kpiDelta(t, usage.delta)}
          chart={
            <LineChart
              series={usage.days.map((day) => day.minutes)}
              xLabels={usage.days.map((day) => formatWeekdayShort(day.date))}
              yStep={10}
              formatValue={formatCount}
              ariaLabel={t('usage.chartLabel')}
              height={150}
            />
          }
          footer={
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-secondary">
              <Activity aria-hidden size={14} className="shrink-0 text-brand" />
              <span>{t('usage.peak', { from: peakHours.fromHour, to: peakHours.toHour })}</span>
            </p>
          }
        />
      </ActivityBlock>

      <ActivityBlock id="engagement" title={t('engagement.title')}>
        <KpiGrid>
          {engagementCards.map(({ key, icon }) => (
            <KpiCard
              key={key}
              icon={icon}
              label={t(`engagement.${key}`)}
              value={formatCount(engagement[key].count)}
              delta={kpiDelta(t, engagement[key].delta)}
            />
          ))}
        </KpiGrid>
      </ActivityBlock>

      <ActivityBlock id="seen" title={t('seen.title')}>
        <KpiGrid>
          <KpiCard
            icon={Eye}
            label={t('seen.posts')}
            value={formatCount(seen.posts.posts)}
            unit={t('seen.postsUnit', { count: seen.posts.posts })}
          />
          <KpiCard
            icon={CircleDashed}
            label={t('seen.stories')}
            value={formatCount(seen.stories)}
          />
          <KpiCard
            icon={CirclePlay}
            label={t('seen.videos')}
            value={formatCount(seen.videos.count)}
            unit={t('seen.videosUnit', { count: seen.videos.count })}
          />
          <KpiCard
            icon={Timer}
            label={t('seen.videoTime')}
            value={t('durationLong', {
              hours: Math.floor(seen.videos.minutes / 60),
              minutes: seen.videos.minutes % 60,
            })}
          />
        </KpiGrid>
      </ActivityBlock>

      {showCommunities ? (
        <ActivityBlock id="communities" title={t('communities.title')}>
          <BarList
            rows={byCommunity.map((row, index) => ({
              id: row.id,
              label: row.name,
              value: row.interactions,
              display: formatCount(row.interactions),
              highlight: index === 0,
            }))}
          />
        </ActivityBlock>
      ) : null}

      <ActivityBlock id="presence" title={t('presence.title')} period={t('presencePeriod')}>
        <KpiGrid>
          <KpiCard
            icon={CalendarCheck2}
            label={t('presence.attendance')}
            value={formatCount(sample.attendance.attended)}
            unit={t('presence.attendanceOf', { total: formatCount(sample.attendance.events) })}
          />
          {sample.weeklyStreak >= MIN_STREAK_WEEKS ? (
            <KpiCard
              icon={Flame}
              label={t('presence.streak')}
              value={formatCount(sample.weeklyStreak)}
              unit={t('presence.streakUnit', { weeks: sample.weeklyStreak })}
            />
          ) : null}
        </KpiGrid>
      </ActivityBlock>
    </div>
  );
}
