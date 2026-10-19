import { formatBrl } from '@rede-social/contracts/money';
import {
  type EngagementBand,
  financeOffer,
  type OwnerBandScope,
  type OwnerMemberInsights,
  ownerMemberInsights,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import {
  ActionCard,
  BarList,
  CountUp,
  KpiCard,
  KpiGrid,
  LineChart,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn, StatusPill, type StatusTone } from '@rede-social/ui';
import {
  Activity,
  CalendarClock,
  CalendarDays,
  Clock,
  Eye,
  Headset,
  Heart,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  ShoppingBag,
  Zap,
} from 'lucide-react';
import { type OwnerMemberListSlug, ownerInsightAnchor } from '@/lib/owner-band-scope';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import {
  communityLabel,
  type DashboardT,
  formatCount,
  formatDate,
  formatDayMonth,
  formatHoursMinutes,
  formatMonthAbbrev,
  formatMonthYear,
  initials,
} from './format';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const BAND_TONE: Record<EngagementBand, StatusTone> = {
  new: 'neutral',
  superfan: 'success',
  engaged: 'success',
  occasional: 'neutral',
  at_risk: 'warning',
  inactive: 'danger',
};

/** How far back each history entry is (the fixture's 60 and 30 days, then today). */
const HISTORY_DAYS = [60, 30] as const;

/**
 * The insights' own grid, the area grid's (`AREA_GRID`): one column on a phone, two from a 56rem
 * container, four from 100rem. The insights read across the area (`SPAN_ALL`) whichever area opens
 * them (Membros, Conteúdo, Financeiro), so the grid holds wherever they render.
 */
const DETAIL_GRID =
  'flex min-w-0 flex-col gap-6 @4xl:grid @4xl:grid-cols-2 @4xl:items-stretch @min-[100rem]:grid-cols-4';

/** Half of a four-column row (from 100rem), one cell at two columns. */
const HALF_AT_FOUR = '@min-[100rem]:col-span-2';

const ALL_EVENTS = [...tenantOwnerPanel.events.past, ...tenantOwnerPanel.events.upcoming];

function eventOf(id: string) {
  const event = ALL_EVENTS.find((row) => row.id === id);
  if (!event) throw new Error(`no event ${id}`);
  return event;
}

function communityOf(t: DashboardT, id: string): string {
  const community = tenantOwnerPanel.byCommunity.find((row) => row.id === id);
  if (!community) throw new Error(`no community ${id}`);
  return communityLabel(t, community);
}

/** The first in-person event still to come: the "próximo encontro" the suggestions point at. */
function nextMeeting(t: DashboardT): string {
  const meeting = tenantOwnerPanel.events.upcoming.find((row) => row.format === 'in_person');
  if (!meeting) throw new Error('no upcoming in-person event');
  return t('tenantOwner.bandScope.event', {
    name: meeting.name,
    date: formatDayMonth(meeting.date),
  });
}

function bandName(t: DashboardT, band: EngagementBand): string {
  return t(`tenantOwner.memberDetail.band.${band}`);
}

function Header({
  t,
  insights,
  scope,
  band,
}: {
  t: DashboardT;
  insights: OwnerMemberInsights;
  scope: OwnerBandScope;
  band: EngagementBand;
}) {
  // In a community the member may sit one band lower than in the whole base (R-4): show both.
  const split = scope.kind === 'community' && band !== insights.band;
  return (
    <Card className={cn(SURFACE, RISE, 'flex items-center gap-4 p-4', HALF_AT_FOUR)}>
      <span
        aria-hidden
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-on-brand"
      >
        {initials(insights.name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 [overflow-wrap:anywhere]">
        <h3 className="text-lg font-bold leading-tight text-text">{insights.name}</h3>
        {split ? (
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={BAND_TONE[band]} className="w-fit">
              {t('tenantOwner.memberDetail.bandIn', {
                band: bandName(t, band),
                community: communityOf(t, scope.id),
              })}
            </StatusPill>
            <StatusPill tone={BAND_TONE[insights.band]} className="w-fit">
              {t('tenantOwner.memberDetail.bandWhole', { band: bandName(t, insights.band) })}
            </StatusPill>
          </div>
        ) : (
          <StatusPill tone={BAND_TONE[insights.band]} className="w-fit">
            {bandName(t, insights.band)}
          </StatusPill>
        )}
        <dl className="flex flex-col gap-0.5 text-xs text-text-secondary">
          <div>
            <dt className="inline font-semibold">{t('tenantOwner.bandMembers.since')}</dt>{' '}
            <dd className="inline">{formatMonthYear(insights.memberSince)}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">{t('tenantOwner.bandMembers.topCommunity')}</dt>{' '}
            <dd className="inline">{communityOf(t, insights.topCommunityId)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

/**
 * The last 30 days as the member report's cards: an icon and a label, the number counting up. Each
 * number but the daily time opens the list behind it (quick 261012-tru D-07): the whole card is a
 * `CardLink` carrying the id the list's "Voltar" returns to, with the report's arrow and hover lift.
 * Three cards a row on the web, all six in one row from a 100rem container.
 */
function Last30({
  t,
  insights,
  listHref,
}: {
  t: DashboardT;
  insights: OwnerMemberInsights;
  listHref: ListHref;
}) {
  const { last30 } = insights;
  const key = 'tenantOwner.memberDetail.last30';
  const seeList = t('tenantOwner.seeList');
  const cards: {
    label: string;
    value: string;
    icon: LucideIcon;
    list: OwnerMemberListSlug | null;
  }[] = [
    {
      label: t(`${key}.activeDays`),
      value: formatCount(last30.activeDays),
      icon: CalendarDays,
      list: 'dias-ativos',
    },
    { label: t(`${key}.likes`), value: formatCount(last30.likes), icon: Heart, list: 'curtidas' },
    {
      label: t(`${key}.comments`),
      value: formatCount(last30.comments),
      icon: MessageCircle,
      list: 'comentarios',
    },
    {
      label: t(`${key}.strongActions`),
      value: formatCount(last30.strongActions),
      icon: Zap,
      list: 'acoes-fortes',
    },
    {
      label: t(`${key}.dailyTime`),
      value: formatHoursMinutes(t, last30.dailyMinutes.value),
      icon: Clock,
      list: null,
    },
    {
      label: t(`${key}.postsSeen`),
      value: formatCount(last30.postsSeen.value),
      icon: Eye,
      list: 'posts-vistos',
    },
  ];
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3 @min-[100rem]:grid-cols-6">
        {cards.map(({ label, value, icon, list }) =>
          list === null ? (
            <KpiCard key={label} icon={icon} label={label} value={value} />
          ) : (
            <CardLink key={label} href={listHref(list)} id={ownerInsightAnchor(list)}>
              <KpiCard icon={icon} label={label} value={value} linked={seeList} />
            </CardLink>
          ),
        )}
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * The band history and the weekly active days, as the member report's usage card: the number is
 * the last week's active days, the 12-week chart beside it at a fixed height, and the band at 60
 * and 30 days and today in the card's footer (today's line in the text color).
 */
function Evolution({ t, insights }: { t: DashboardT; insights: OwnerMemberInsights }) {
  const key = 'tenantOwner.memberDetail.evolution';
  const weekly = insights.weeklyActiveDays;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiCard
        icon={Activity}
        label={t(`${key}.weeklyTitle`)}
        value={formatCount(weekly.at(-1) ?? 0)}
        chartPlacement="side"
        chart={
          <LineChart
            series={weekly}
            xLabels={weekly.map((_, i) =>
              (i + 1) % 4 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : '',
            )}
            yStep={7}
            formatValue={formatCount}
            ariaLabel={t(`${key}.weeklyLabel`)}
            height={150}
          />
        }
        footer={
          <ol className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            {insights.bandHistory.map((entry, index) => {
              const days = HISTORY_DAYS[index];
              const today = days === undefined;
              const when = today
                ? t(`${key}.today`)
                : t(`${key}.past`, { month: formatMonthAbbrev(entry.month), days });
              return (
                <li
                  key={entry.month}
                  className={cn('flex items-center gap-1.5', today && 'font-semibold text-text')}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      today ? 'bg-brand' : 'bg-brand/40',
                    )}
                  />
                  {t(`${key}.line`, {
                    when,
                    band: entry.band ? bandName(t, entry.band) : t(`${key}.notMember`),
                  })}
                </li>
              );
            })}
          </ol>
        }
      />
    </PanelSection>
  );
}

/** Where the member interacts: by community, then by kind of publication, as two bar cards. */
function WhereInteracts({ t, insights }: { t: DashboardT; insights: OwnerMemberInsights }) {
  const key = 'tenantOwner.memberDetail.where';
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      <div data-dash-stagger className="flex flex-col gap-3">
        <BarList
          rows={insights.communities.map((row, index) => ({
            id: row.id,
            label: communityOf(t, row.id),
            value: row.actions,
            display: formatCount(row.actions),
            highlight: index === 0,
          }))}
        />
        <BarList
          rows={insights.postTypes.map((row) => ({
            id: row.type,
            label: t(`postTypes.${row.type}`),
            value: row.interactions,
            display: formatCount(row.interactions),
          }))}
        />
      </div>
    </PanelSection>
  );
}

function Events({ t, insights }: { t: DashboardT; insights: OwnerMemberInsights }) {
  const key = 'tenantOwner.memberDetail.events';
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      {insights.events.length === 0 ? (
        <p className="text-sm text-text-secondary">{t(`${key}.empty`)}</p>
      ) : (
        <Card className={cn(SURFACE, RISE)}>
          <ul className="divide-y divide-border">
            {insights.events.map((entry) => {
              const event = eventOf(entry.id);
              const [tone, label]: [StatusTone, string] =
                entry.attended === null
                  ? ['brand', t(`${key}.registered`)]
                  : entry.attended
                    ? ['success', t(`${key}.attended`)]
                    : ['neutral', t(`${key}.missed`)];
              return (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                    {t(`${key}.row`, { name: event.name, date: formatDayMonth(event.date) })}
                  </span>
                  <StatusPill tone={tone} className="shrink-0">
                    {label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </PanelSection>
  );
}

/**
 * Each purchase as a report card: the product beside its icon, the price counting up, and in the
 * footer what it includes (Entrada or Adicional, D-02), the day it was bought and when it expires.
 */
function Purchases({ t, insights }: { t: DashboardT; insights: OwnerMemberInsights }) {
  const key = 'tenantOwner.memberDetail.purchases';
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      {insights.purchases.length === 0 ? (
        <p className="text-sm text-text-secondary">{t(`${key}.empty`)}</p>
      ) : (
        <KpiGrid className="grid-cols-1 @4xl:grid-cols-1">
          {insights.purchases.map((purchase) => {
            const product = tenantOwnerPanel.store.products.find(
              (row) => row.id === purchase.productId,
            );
            if (!product) throw new Error(`no product ${purchase.productId}`);
            const { expiresAt } = purchase;
            // Primary revenue is the entry (it gave the app), secondary any later purchase (D-02).
            const entry = purchase.kind === 'primary';
            return (
              <KpiCard
                key={`${purchase.productId}-${purchase.date}`}
                icon={ShoppingBag}
                label={product.product}
                value={formatBrl(purchase.cents)}
                footer={
                  <div className="flex flex-col gap-1.5 text-xs font-medium text-text-secondary">
                    <span className="flex flex-wrap items-center gap-2 text-text">
                      {financeOffer(purchase.offerId).composition}
                      <StatusPill tone={entry ? 'brand' : 'neutral'} className="px-2 py-0.5">
                        {t(`${key}.${entry ? 'entry' : 'addon'}`)}
                      </StatusPill>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1.5">
                        <CalendarDays aria-hidden size={14} className="shrink-0 text-brand" />
                        {formatDate(purchase.date)}
                      </span>
                      {expiresAt ? (
                        <span className="flex items-center gap-1.5">
                          <CalendarClock aria-hidden size={14} className="shrink-0 text-brand" />
                          {t(`${key}.expires`, { date: formatDate(expiresAt.value) })}
                        </span>
                      ) : null}
                    </span>
                  </div>
                }
              />
            );
          })}
        </KpiGrid>
      )}
    </PanelSection>
  );
}

/** The member's support counts in one line (never message text); its numbers count up. */
function Support({ t, insights }: { t: DashboardT; insights: OwnerMemberInsights }) {
  const key = 'tenantOwner.memberDetail.support';
  const { conversations, lastDaysAgo, medianResponseMinutes } = insights.support;
  const empty = conversations === 0 || lastDaysAgo === null || medianResponseMinutes === null;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      <Card className={cn(SURFACE, RISE, 'flex items-start gap-3 p-4')}>
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
        >
          <Headset size={16} strokeWidth={2.2} />
        </span>
        <p className="min-w-0 self-center text-sm text-text">
          {empty ? (
            t(`${key}.empty`)
          ) : (
            <CountUp
              value={t(`${key}.summary`, {
                count: conversations,
                days: lastDaysAgo,
                time: formatHoursMinutes(t, medianResponseMinutes),
              })}
            />
          )}
        </p>
      </Card>
    </PanelSection>
  );
}

/** The link to the list behind one insight number, built by the cascade that opened the member. */
type ListHref = (slug: OwnerMemberListSlug) => string;

export interface SampleMemberDetailProps {
  t: DashboardT;
  /** A roster member the opening cascade's parser let through. */
  memberId: string;
  /** The band the member was opened in, in `scope`. */
  band: EngagementBand;
  /** Where that band was counted: the whole base, a community or an event. */
  scope: OwnerBandScope;
  /** "Voltar": one step back in the cascade that opened the member. */
  backHref: string;
  listHref: ListHref;
}

/**
 * SAMPLE (08.7-05): the fixture member insights the Conteúdo and Financeiro areas still open until
 * their own plans (08.7-07, 08.7-10) wire the real `OwnerMemberDetail`, and then delete this file.
 *
 * One member's insights, opened from a member card (quick 261012-qer B-3): in the level-4 Membros
 * area from a band, in Conteúdo from the people behind a publication's number (quick 261013-h51 P1)
 * and in Financeiro from a buyer. Drawn by the member report's rules on the area's grid: "Voltar"
 * one step back in the cascade that opened it; the header (the community band next to the
 * whole-base one when they differ, quick 261012-ri4 R-4) beside the suggested next step (its button
 * disabled like every sample action); the last 30 days as cards that open their lists; the band
 * history with the weekly active days as the report's usage card; then where they interact, their
 * events, purchases and support counts (never message text). Visible to the client's management
 * only.
 */
export function SampleMemberDetail({
  t,
  memberId,
  band,
  scope,
  backHref,
  listHref,
}: SampleMemberDetailProps) {
  // Each opening parser only lets a roster member through, so a missing one is a bug.
  const insights = ownerMemberInsights(memberId);
  if (!insights) throw new Error(`no insights for member ${memberId}`);
  const { kind, days } = insights.suggestion;

  return (
    <div className={cn(DETAIL_GRID, SPAN_ALL)}>
      <div className={SPAN_ALL}>
        <BackLink href={backHref} label={t('tenantOwner.memberDetail.back')} />
      </div>
      <Header t={t} insights={insights} scope={scope} band={band} />
      <div className={cn('grid', HALF_AT_FOUR)}>
        <ActionCard
          icon={Lightbulb}
          title={t('tenantOwner.memberDetail.suggestion.title')}
          detail={t(`tenantOwner.memberDetail.suggestion.${kind}.detail`, {
            days,
            event: nextMeeting(t),
          })}
          action={
            <DisabledAction variant="outline">
              {t(`tenantOwner.memberDetail.suggestion.${kind}.action`)}
            </DisabledAction>
          }
        />
      </div>
      <Last30 t={t} insights={insights} listHref={listHref} />
      <Evolution t={t} insights={insights} />
      <WhereInteracts t={t} insights={insights} />
      <Events t={t} insights={insights} />
      <Purchases t={t} insights={insights} />
      <Support t={t} insights={insights} />
    </div>
  );
}
