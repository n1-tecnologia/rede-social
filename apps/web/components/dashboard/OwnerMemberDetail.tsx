import { formatBrl } from '@rede-social/contracts/money';
import type {
  EngagementBandId,
  OwnerMemberDetailReady,
} from '@rede-social/module-dashboard/contracts';
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
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getOwnerMemberDetail, getOwnerMembers } from '@/lib/dashboard';
import {
  type OwnerMeasuredListSlug,
  type OwnerMembersKind,
  type OwnerMembersView,
  ownerInsightAnchor,
  ownerMembersHref,
} from '@/lib/owner-band-scope';
import { localDate, memberSinceText } from '@/lib/owner-list-view';
import { OWNER_PANEL_ANCHOR, type OwnerPanelFlags } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import {
  type DashboardT,
  formatCount,
  formatDate,
  formatDayMonth,
  formatHoursMinutes,
  formatMonthAbbrev,
  initials,
} from './format';
import { OwnerAreaState } from './OwnerAreaState';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const BAND_TONE: Record<EngagementBandId, StatusTone> = {
  new: 'neutral',
  superfan: 'success',
  engaged: 'success',
  occasional: 'neutral',
  at_risk: 'warning',
  inactive: 'danger',
};

/** The three history points of the answer, in order: D-60, D-30 and the snapshot day. */
const HISTORY_POINTS = [
  { key: 'd60', days: 60 },
  { key: 'd30', days: 30 },
  { key: 'd', days: null },
] as const;

/** The suggestions that name the next event ("Mostre o próximo evento: {event}."). */
const NAMES_EVENT: ReadonlySet<EngagementBandId> = new Set(['engaged', 'occasional', 'at_risk']);

/**
 * The detail's own grid, the area grid's (`AREA_GRID`): one column on a phone, two from a 56rem
 * container, four from 100rem. It reads across the area (`SPAN_ALL`).
 */
const DETAIL_GRID =
  'flex min-w-0 flex-col gap-6 @4xl:grid @4xl:grid-cols-2 @4xl:items-stretch @min-[100rem]:grid-cols-4';

/** Half of a four-column row (from 100rem), one cell at two columns. */
const HALF_AT_FOUR = '@min-[100rem]:col-span-2';

/** The next event the suggestion names: its title and start (the tenant's next in-person one). */
export interface NextEvent {
  title: string;
  startsAt: string;
}

export interface OwnerMemberDetailViewProps {
  t: DashboardT;
  /** The ready answer of `GET /v1/dashboard/owner/members/{membershipId}`. */
  detail: OwnerMemberDetailReady;
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: the dates are the tenant's. */
  timeZone: string;
  /** The tab the member was opened from: in Por comunidade the pill says "na base toda". */
  scopeKind: OwnerMembersKind;
  /** The suggestion's event, or null (events off, or none upcoming). */
  nextEvent: NextEvent | null;
  /** "Voltar": the band list the member was opened from. */
  backHref: string;
  /** The link to the list behind one measured number. */
  listHref: (slug: OwnerMeasuredListSlug) => string;
}

function bandName(t: DashboardT, band: EngagementBandId): string {
  return t(`tenantOwner.memberDetail.band.${band}`);
}

/** One labeled line of the header: the label in bold, then its value. */
function HeaderLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="inline font-semibold">{label}</dt> <dd className="inline">{children}</dd>
    </div>
  );
}

/**
 * The header: the initials, the name, the whole-base band (said "na base toda" when the member was
 * opened from a community, whose own band the answer does not carry), when they joined and, with
 * `communities` on, the community they interact with most (UI-D-473).
 */
function Header({
  t,
  detail,
  flags,
  timeZone,
  scopeKind,
}: Pick<OwnerMemberDetailViewProps, 't' | 'detail' | 'flags' | 'timeZone' | 'scopeKind'>) {
  const { member, topCommunity } = detail;
  return (
    <Card className={cn(SURFACE, RISE, 'flex items-center gap-4 p-4', HALF_AT_FOUR)}>
      <span
        aria-hidden
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-on-brand"
      >
        {initials(member.displayName)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 [overflow-wrap:anywhere]">
        <h3 className="text-lg font-bold leading-tight text-text">{member.displayName}</h3>
        <StatusPill tone={BAND_TONE[member.band]} className="w-fit">
          {scopeKind === 'community'
            ? t('tenantOwner.memberDetail.bandWhole', { band: bandName(t, member.band) })
            : bandName(t, member.band)}
        </StatusPill>
        <dl className="flex flex-col gap-0.5 text-xs text-text-secondary">
          <HeaderLine label={t('tenantOwner.bandMembers.since')}>
            {memberSinceText(member.joinedAt, timeZone)}
          </HeaderLine>
          {flags.communities && topCommunity ? (
            <HeaderLine label={t('tenantOwner.bandMembers.topCommunity')}>
              {topCommunity.name}
            </HeaderLine>
          ) : null}
        </dl>
      </div>
    </Card>
  );
}

/**
 * The last 30 days as the member report's cards (D-461): each measured number opens the list behind
 * it (the whole card is a `CardLink` carrying the id the list's "Voltar" returns to); "Tempo médio
 * diário" and "Publicações vistas" are "Em breve" tiles that never open (D-458, D-455 d). Three
 * cards a row on the web, all six in one row from a 100rem container.
 */
function Last30({
  t,
  detail,
  listHref,
}: Pick<OwnerMemberDetailViewProps, 't' | 'detail' | 'listHref'>) {
  const { last30 } = detail;
  const key = 'tenantOwner.memberDetail.last30';
  const seeList = t('tenantOwner.seeList');
  const measured: {
    label: string;
    value: number;
    icon: LucideIcon;
    list: OwnerMeasuredListSlug;
  }[] = [
    {
      label: t(`${key}.activeDays`),
      value: last30.activeDays,
      icon: CalendarDays,
      list: 'dias-ativos',
    },
    { label: t(`${key}.likes`), value: last30.likes, icon: Heart, list: 'curtidas' },
    {
      label: t(`${key}.comments`),
      value: last30.comments,
      icon: MessageCircle,
      list: 'comentarios',
    },
    {
      label: t(`${key}.strongActions`),
      value: last30.strongActions,
      icon: Zap,
      list: 'acoes-fortes',
    },
  ];
  const missing: { label: string; icon: LucideIcon }[] = [
    { label: t(`${key}.dailyTime`), icon: Clock },
    { label: t(`${key}.postsSeen`), icon: Eye },
  ];
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3 @min-[100rem]:grid-cols-6">
        {measured.map(({ label, value, icon, list }) => (
          <CardLink key={label} href={listHref(list)} id={ownerInsightAnchor(list)}>
            <KpiCard icon={icon} label={label} value={formatCount(value)} linked={seeList} />
          </CardLink>
        ))}
        {missing.map(({ label, icon }) => (
          <KpiCard
            key={label}
            variant="missing"
            icon={icon}
            label={label}
            value={t('report.comingSoon.value')}
            note={t('report.comingSoon.note')}
          />
        ))}
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * The band history and the weekly active days, as the member report's usage card: the number is
 * the last week's active days, the 12-week chart beside it, and the band at D-60, D-30 and on the
 * snapshot day in the card's footer ("Última atualização (base toda)", UI-D-480: never "hoje").
 */
function Evolution({ t, detail }: Pick<OwnerMemberDetailViewProps, 't' | 'detail'>) {
  const key = 'tenantOwner.memberDetail.evolution';
  const weekly = detail.weeklyActiveDays;
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
            {HISTORY_POINTS.map(({ key: point, days }, index) => {
              const entry = detail.bandHistory[index];
              if (!entry) return null;
              const current = days === null;
              const when = current
                ? t(`${key}.today`)
                : t(`${key}.past`, { month: formatMonthAbbrev(entry.month), days });
              return (
                <li
                  key={point}
                  className={cn('flex items-center gap-1.5', current && 'font-semibold text-text')}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      current ? 'bg-brand' : 'bg-brand/40',
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

/**
 * Where the member interacts (only with `communities` on, UI-D-473): by community since joining
 * (the tenant-wide feed reads "Início", UI-D-475), then by kind of publication, as two bar cards.
 */
function WhereInteracts({ t, detail }: Pick<OwnerMemberDetailViewProps, 't' | 'detail'>) {
  const key = 'tenantOwner.memberDetail.where';
  const communities = detail.communities ?? [];
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      <div data-dash-stagger className="flex flex-col gap-3">
        {communities.length > 0 ? (
          <BarList
            rows={communities.map((row, index) => ({
              id: row.communityId ?? 'tenant-feed',
              label: row.name ?? t('report.tenantFeed'),
              value: row.actions,
              display: formatCount(row.actions),
              highlight: index === 0,
            }))}
          />
        ) : null}
        {detail.postTypes.length > 0 ? (
          <BarList
            rows={detail.postTypes.map((row) => ({
              id: row.type,
              label: t(`postTypes.${row.type}`),
              value: row.interactions,
              display: formatCount(row.interactions),
            }))}
          />
        ) : null}
      </div>
    </PanelSection>
  );
}

/** The member's RSVPs "vou" and walk-ins, oldest first: went, missed, or still to come. */
function Events({
  t,
  events,
  timeZone,
}: {
  t: DashboardT;
  events: NonNullable<OwnerMemberDetailReady['events']>;
  timeZone: string;
}) {
  const key = 'tenantOwner.memberDetail.events';
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      {events.length === 0 ? (
        <p className="text-sm text-text-secondary">{t(`${key}.empty`)}</p>
      ) : (
        <Card className={cn(SURFACE, RISE)}>
          <ul className="divide-y divide-border">
            {events.map((entry) => {
              const [tone, label]: [StatusTone, string] =
                entry.attended === null
                  ? ['brand', t(`${key}.registered`)]
                  : entry.attended
                    ? ['success', t(`${key}.attended`)]
                    : ['neutral', t(`${key}.missed`)];
              return (
                <li
                  key={entry.eventId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 text-sm text-text [overflow-wrap:anywhere]">
                    {t(`${key}.row`, {
                      name: entry.title,
                      date: formatDayMonth(localDate(entry.startsAt, timeZone)),
                    })}
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
 * Each purchase as a report card: the product beside its icon, the price, and in the footer whether
 * it was the member's entry or an addon (D-02) and the day it was paid. There is no "Vence em"
 * line: access expiry is not recorded (`needs_access_expiry`), and the row stays.
 */
function Purchases({
  t,
  purchases,
  timeZone,
}: {
  t: DashboardT;
  purchases: NonNullable<OwnerMemberDetailReady['purchases']>;
  timeZone: string;
}) {
  const key = 'tenantOwner.memberDetail.purchases';
  return (
    <PanelSection as="h4" title={t(`${key}.title`)}>
      {purchases.length === 0 ? (
        <p className="text-sm text-text-secondary">{t(`${key}.empty`)}</p>
      ) : (
        <KpiGrid className="grid-cols-1 @4xl:grid-cols-1">
          {purchases.map((purchase) => {
            const entry = purchase.kind === 'primary';
            return (
              <KpiCard
                key={purchase.orderId}
                icon={ShoppingBag}
                label={purchase.productName}
                value={formatBrl(purchase.cents)}
                footer={
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium text-text-secondary">
                    <StatusPill tone={entry ? 'brand' : 'neutral'} className="px-2 py-0.5">
                      {t(`${key}.${entry ? 'entry' : 'addon'}`)}
                    </StatusPill>
                    <span className="flex items-center gap-1.5">
                      <CalendarDays aria-hidden size={14} className="shrink-0 text-brand" />
                      {formatDate(localDate(purchase.paidAt, timeZone))}
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
function Support({
  t,
  support,
}: {
  t: DashboardT;
  support: NonNullable<OwnerMemberDetailReady['support']>;
}) {
  const key = 'tenantOwner.memberDetail.support';
  const { conversations, lastDaysAgo, medianResponseMinutes } = support;
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

/** The suggestion's sentence: with the next event where it names one, else its no-event form. */
function suggestionDetail(
  t: DashboardT,
  suggestion: OwnerMemberDetailReady['suggestion'],
  nextEvent: NextEvent | null,
  timeZone: string,
): string {
  const key = `tenantOwner.memberDetail.suggestion.${suggestion.kind}`;
  if (!NAMES_EVENT.has(suggestion.kind)) return t(`${key}.detail`, { days: suggestion.days });
  if (nextEvent === null) return t(`${key}.detailNoEvent`, { days: suggestion.days });
  return t(`${key}.detail`, {
    days: suggestion.days,
    event: t('tenantOwner.bandScope.event', {
      name: nextEvent.title,
      date: formatDayMonth(localDate(nextEvent.startsAt, timeZone)),
    }),
  });
}

/**
 * One member's detail on the snapshot (08.7-05, D-461, D-458), opened from a band list: "Voltar" to
 * that list; the header beside the suggested next step (its action disabled with the "Em breve"
 * pill, UI-D-478: the panel sends nothing, PR-4); the last 30 days as cards that open their lists;
 * the band history with the weekly active days; then where they interact (with `communities`), their
 * events (with `events`), purchases (with `store`) and support counts (with `chat`; never message
 * text). A part whose module is off is absent, never zeroed (the API omits it too). Visible to the
 * client's management only.
 */
export function OwnerMemberDetailView({
  t,
  detail,
  flags,
  timeZone,
  scopeKind,
  nextEvent,
  backHref,
  listHref,
}: OwnerMemberDetailViewProps) {
  const { suggestion } = detail;
  return (
    <div className={cn(DETAIL_GRID, SPAN_ALL)}>
      <div className={SPAN_ALL}>
        <BackLink href={backHref} label={t('tenantOwner.memberDetail.back')} />
      </div>
      <Header t={t} detail={detail} flags={flags} timeZone={timeZone} scopeKind={scopeKind} />
      <div className={cn('grid', HALF_AT_FOUR)}>
        <ActionCard
          icon={Lightbulb}
          title={t('tenantOwner.memberDetail.suggestion.title')}
          detail={suggestionDetail(t, suggestion, nextEvent, timeZone)}
          action={
            <DisabledAction variant="outline" pill={t('report.comingSoon.value')}>
              {t(`tenantOwner.memberDetail.suggestion.${suggestion.kind}.action`)}
            </DisabledAction>
          }
        />
      </div>
      <Last30 t={t} detail={detail} listHref={listHref} />
      <Evolution t={t} detail={detail} />
      {flags.communities ? <WhereInteracts t={t} detail={detail} /> : null}
      {flags.events && detail.events ? (
        <Events t={t} events={detail.events} timeZone={timeZone} />
      ) : null}
      {flags.store && detail.purchases ? (
        <Purchases t={t} purchases={detail.purchases} timeZone={timeZone} />
      ) : null}
      {flags.chat && detail.support ? <Support t={t} support={detail.support} /> : null}
    </div>
  );
}

/** The tenant's next in-person event of the Membros answer (the "próximo encontro"), if any. */
async function nextMeeting(flags: OwnerPanelFlags): Promise<NextEvent | null> {
  if (!flags.events) return null;
  const members = await getOwnerMembers();
  if (members.status !== 'ok' || members.answer.state !== 'ready') return null;
  const until = Date.parse(members.answer.snapshot.windows.untilAt);
  const next = (members.answer.eventEngagement ?? [])
    .filter((event) => event.format === 'in_person' && Date.parse(event.startsAt) >= until)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return next ? { title: next.title, startsAt: next.startsAt } : null;
}

/** Where a member detail's links go: Membros builds them from its view, Conteúdo from its own. */
export interface OwnerMemberDetailLinks {
  /** "Voltar": the list the member was opened from. */
  back: string;
  /** The list behind one measured number. */
  list: (slug: OwnerMeasuredListSlug) => string;
  /** "Tentar novamente": the same screen, landing on the panel. */
  retry: string;
}

/** The links of a member opened from a Membros band (08.7-05). */
export function membersDetailLinks(
  view: OwnerMembersView & { memberId: string },
): OwnerMemberDetailLinks {
  return {
    back: ownerMembersHref({ ...view, memberId: null, list: null }),
    list: (slug) => ownerMembersHref({ ...view, list: slug }),
    retry: `${ownerMembersHref(view).split('#')[0]}#${OWNER_PANEL_ANCHOR}`,
  };
}

export interface OwnerMemberDetailProps {
  /** The opened member's membership id (syntactic: the API judges it). */
  memberId: string;
  /** The Membros tab the member was opened from (`member` outside Membros). */
  scopeKind: OwnerMembersKind;
  links: OwnerMemberDetailLinks;
  flags: OwnerPanelFlags;
  timeZone: string;
  /** What renders for a member the API does not know for this tenant: the list above (D-06). */
  fallback: ReactNode;
}

/**
 * The member detail read from `GET /v1/dashboard/owner/members/{membershipId}` (08.7-05), streamed
 * in its own `Suspense` by the caller (UI-D-482): an unknown or other-tenant id (the API's bare 404)
 * falls back to the list it came from (a Membros band, a Conteúdo people list or the interactions,
 * 08.7-07); a failed read is the detail's error card with "Tentar novamente" (UI-D-479); a member
 * with no row in the newest build is "preparing".
 */
export async function OwnerMemberDetail({
  memberId,
  scopeKind,
  links,
  flags,
  timeZone,
  fallback,
}: OwnerMemberDetailProps) {
  const [t, result, nextEvent] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerMemberDetail(memberId),
    nextMeeting(flags),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'notFound') return fallback;
  if (result.status === 'error') {
    return <OwnerAreaState kind="error" body="detail" retryHref={links.retry} />;
  }
  if (result.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  return (
    <OwnerMemberDetailView
      t={t}
      detail={result.answer}
      flags={flags}
      timeZone={timeZone}
      scopeKind={scopeKind}
      nextEvent={nextEvent}
      backHref={links.back}
      listHref={links.list}
    />
  );
}
