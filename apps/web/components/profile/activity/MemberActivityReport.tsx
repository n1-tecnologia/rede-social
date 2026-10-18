import type { MemberActivityReady } from '@rede-social/module-dashboard/contracts';
import { Card, cn } from '@rede-social/ui';
import {
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
import { comingSoonCopy } from '@/components/dashboard/ComingSoon';
import { SnapshotFreshness } from '@/components/dashboard/SnapshotFreshness';
import {
  activityDelta,
  formatCount,
  MIN_STREAK_WEEKS,
  rankCommunityRows,
} from '@/lib/member-activity-view';
import { BarList } from './BarList';
import { ACTIVITY_SURFACE, KpiCard, type KpiDelta, KpiGrid } from './KpiCard';

/**
 * A catalog as the report reads it: `getTranslations` on the page and `useTranslations` in the
 * platform preview both fit. The report receives two: `profile.activity` (its own words) and
 * `dashboard.report` (the "Em breve" family and "Início", shared with the owner panel, D-456).
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

/** A count change → the card's chip: the bare amount, and the whole comparison for its tooltip. */
function kpiDelta(t: ActivityT, count: number, previous: number): KpiDelta {
  const delta = activityDelta(count, previous);
  const amount = formatCount(delta.amount);
  return { amount, text: t('vsLastWeek', { amount }), direction: delta.direction };
}

export interface MemberActivityReportProps {
  /** `profile.activity`. */
  t: ActivityT;
  /** `dashboard.report`: the "Em breve" family and the tenant feed's "Início" (D-456). */
  tr: ActivityT;
  /** The ready `GET /v1/dashboard/activity` answer (or the super_admin preview's mock of it). */
  answer: MemberActivityReady;
  /** The freshness line's text, or `null` (the super_admin preview has none, UI-D-468). */
  freshness: string | null;
}

/**
 * The member's "Sua atividade" on `/perfil` (2026-10-13 port of the rede-social-dashboard preview's
 * member report; 08.7-03 on the member's OWN numbers): the freshness line first (UI-D-468), then
 * "Tempo de uso", "Seu engajamento", "O que você viu", "Onde você mais participa" and "Presença e
 * constância", in the prototype's order (D-457). Synchronous and without data of its own.
 *
 * What is not measured yet is the "Em breve" tile in its place, never a number, a zero or a dash
 * (D-455, D-458): the whole usage block (UI-D-467: one full-width tile with the block note, no chart
 * and no "Pico de uso"), saves, shares, posts seen, videos and the time in videos. Likes and
 * comments carry their change against the 7 days before as a neutral chip (the report describes, it
 * never grades). The report never compares the member with anyone (PR-3).
 *
 * Module gating is ABSENCE (planning decision 4): without `byCommunity` (communities off) there is
 * no communities block; without `attendance` (events off) no attendance tile; the streak tile only
 * from `MIN_STREAK_WEEKS`; the presence block goes when both tiles do (UI-D-485).
 */
export function MemberActivityReport({ t, tr, answer, freshness }: MemberActivityReportProps) {
  const soon = comingSoonCopy(tr);
  const missingTile = (key: string, icon: LucideIcon, label: string) => (
    <KpiCard key={key} icon={icon} label={label} value={soon.value} note={soon.note} missing />
  );
  const communityRows =
    answer.byCommunity === undefined
      ? null
      : rankCommunityRows(answer.byCommunity, tr('tenantFeed'));
  const attendance = answer.attendance;
  const showStreak = answer.weekStreak >= MIN_STREAK_WEEKS;

  return (
    <div data-member-activity className="flex flex-col gap-6 px-4">
      {freshness ? <SnapshotFreshness text={freshness} /> : null}

      <ActivityBlock id="usage" title={t('usage.title')}>
        <KpiCard
          icon={Clock}
          label={t('usage.average')}
          value={soon.value}
          note={soon.block}
          missing
        />
      </ActivityBlock>

      <ActivityBlock id="engagement" title={t('engagement.title')}>
        <KpiGrid>
          <KpiCard
            icon={Heart}
            label={t('engagement.likes')}
            value={formatCount(answer.likes.count)}
            delta={kpiDelta(t, answer.likes.count, answer.likes.previous)}
          />
          <KpiCard
            icon={MessageCircle}
            label={t('engagement.comments')}
            value={formatCount(answer.comments.count)}
            delta={kpiDelta(t, answer.comments.count, answer.comments.previous)}
          />
          {missingTile('saves', Bookmark, t('engagement.saves'))}
          {missingTile('shares', Send, t('engagement.shares'))}
        </KpiGrid>
      </ActivityBlock>

      <ActivityBlock id="seen" title={t('seen.title')}>
        <KpiGrid>
          {missingTile('posts', Eye, t('seen.posts'))}
          <KpiCard
            icon={CircleDashed}
            label={t('seen.stories')}
            value={formatCount(answer.seen.stories)}
          />
          {missingTile('videos', CirclePlay, t('seen.videos'))}
          {missingTile('videoTime', Timer, t('seen.videoTime'))}
        </KpiGrid>
      </ActivityBlock>

      {communityRows ? (
        <ActivityBlock id="communities" title={t('communities.title')}>
          {communityRows.length > 0 ? (
            <BarList
              rows={communityRows.map((row, index) => ({
                id: row.id,
                label: row.label,
                value: row.interactions,
                display: formatCount(row.interactions),
                highlight: index === 0,
              }))}
            />
          ) : (
            <Card className={cn(ACTIVITY_SURFACE, 'p-4')}>
              <p className="text-xs font-normal text-text-secondary">{t('communities.empty')}</p>
            </Card>
          )}
        </ActivityBlock>
      ) : null}

      {attendance || showStreak ? (
        <ActivityBlock id="presence" title={t('presence.title')} period={t('presencePeriod')}>
          <KpiGrid>
            {attendance ? (
              attendance.events === 0 ? (
                <KpiCard
                  icon={CalendarCheck2}
                  label={t('presence.attendance')}
                  value={formatCount(0)}
                  note={t('presence.noEvents')}
                />
              ) : (
                <KpiCard
                  icon={CalendarCheck2}
                  label={t('presence.attendance')}
                  value={formatCount(attendance.attended)}
                  unit={t('presence.attendanceOf', { total: formatCount(attendance.events) })}
                />
              )
            ) : null}
            {showStreak ? (
              <KpiCard
                icon={Flame}
                label={t('presence.streak')}
                value={formatCount(answer.weekStreak)}
                unit={t('presence.streakUnit', { weeks: answer.weekStreak })}
              />
            ) : null}
          </KpiGrid>
        </ActivityBlock>
      ) : null}
    </div>
  );
}
