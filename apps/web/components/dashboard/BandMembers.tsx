import {
  type EngagementBand,
  type EngagementBands,
  type OwnerBandMember,
  type OwnerBandScope,
  ownerBandList,
  ownerScopeBands,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import {
  bandTotal,
  barPercent,
  Collapsible,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  LIFT,
  percentOf,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { type OwnerMembersView, ownerMembersHref } from '@/lib/owner-band-scope';
import { BackLink } from './BackLink';
import {
  CommunityScopeCard,
  EventScopeCard,
  ownerCommunity,
  ownerEvent,
  ScopeItemCards,
} from './BandScopeCards';
import { CardLink } from './CardLink';
import {
  bandLabel,
  communityLabel,
  type DashboardT,
  formatCount,
  formatDayMonth,
  formatHoursMinutes,
  formatMonthYear,
  formatPercent,
  initials,
} from './format';
import { DisabledAction } from './PanelSection';

/** The cascade levels the bands render (the member level replaces the area, see OwnerMembers). */
type BandView = Pick<OwnerMembersView, 'kind' | 'band' | 'itemId'>;

export interface BandMembersProps {
  t: DashboardT;
  /** The whole base's bands: every tab's headers count each member once (quick 261012-tru D-02). */
  bands: EngagementBands;
  /** The tab, the open band and the opened community or event (allow-listed by the parser). */
  view: BandView;
}

function topCommunityLabel(t: DashboardT, id: string): string {
  const row = tenantOwnerPanel.byCommunity.find((community) => community.id === id);
  if (!row) throw new Error(`no community ${id}`);
  return communityLabel(t, row);
}

/**
 * A band's share of the scope: "menos de 1%" when it has members but rounds to 0% (A-1).
 * `Math.round` matches formatPercent's half-expand rounding.
 */
function bandShare(t: DashboardT, count: number, total: number): string {
  const percent = percentOf(count, total);
  return count > 0 && Math.round(percent) === 0
    ? t('tenantOwner.bandMembers.underOnePercent')
    : formatPercent(percent);
}

/**
 * A band's count and share with its mini bar. `label` replaces the default "N · P%" text (Conteúdo's
 * "41 membros · 43% da faixa", quick 261013-orf E-03.3); the bar stays. `barClassName` sizes the
 * bar (Membros widens it where its band rows read across the whole area).
 */
export function BandSummary({
  t,
  band,
  count,
  total,
  label,
  barClassName,
}: {
  t: DashboardT;
  band: EngagementBand;
  count: number;
  total: number;
  label?: string;
  barClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {label ??
        t('tenantOwner.bandMembers.summary', {
          count: formatCount(count),
          percent: bandShare(t, count, total),
        })}
      <span
        aria-hidden
        className={cn('block h-1.5 w-16 overflow-hidden rounded-full bg-bg-tertiary', barClassName)}
      >
        {/* min-w-1.5: a band with members never draws an empty bar (a 6 px dot at least). */}
        <span
          className={cn(
            'block h-full rounded-full',
            band === 'at_risk' ? 'bg-brand' : 'bg-brand/50',
            count > 0 && 'min-w-1.5',
          )}
          style={{ width: `${barPercent(count, total)}%` }}
        />
      </span>
    </span>
  );
}

/** One labeled line of the member card: the label in gray, then its value in the text color. */
function CardLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <dt className="inline text-text-secondary">{label}</dt>{' '}
      <dd className="inline text-text">{children}</dd>
    </div>
  );
}

/**
 * One member as a card (quick 261012-qer B-1, sized as the user drew it in quick 261012-ri4 R-1):
 * the initials on the brand color (the profile photo replaces them once profiles are wired), the
 * large name, four labeled lines, and the corner arrow of the member report's linked cards (R-3).
 * The whole card links to the member's insights (B-3) and lifts on hover, as the report's cards.
 * Outside a band list (the Conteúdo people, quick 261013-h51 P1) `band` adds a first line with the
 * member's band; `lead` adds a line under the name (when they did it, quick 261013-orf E-03.2); `id`
 * lets a "Voltar" land on the card.
 */
export function MemberCard({
  t,
  member,
  href,
  band,
  lead,
  id,
  status,
}: {
  t: DashboardT;
  member: OwnerBandMember;
  href: string;
  band?: EngagementBand;
  /** A line right under the name ("Curtiu há 3 dias"). */
  lead?: string;
  id?: string;
  /** A pill next to the name (a commenter's "Sem resposta"). */
  status?: ReactNode;
}) {
  return (
    <CardLink href={href} id={id}>
      <Card className={cn(SURFACE, RISE, LIFT, 'flex h-full items-start gap-4 p-4')}>
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-on-brand"
        >
          {initials(member.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 [overflow-wrap:anywhere]">
          {status ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold leading-tight text-text">{member.name}</span>
              {status}
            </span>
          ) : (
            <span className="text-lg font-bold leading-tight text-text">{member.name}</span>
          )}
          {lead ? <span className="text-sm font-semibold text-text">{lead}</span> : null}
          <dl className="flex flex-col gap-1">
            {band ? (
              <CardLine label={t('tenantOwner.bandMembers.band')}>{bandLabel(t, band)}</CardLine>
            ) : null}
            <CardLine label={t('tenantOwner.bandMembers.since')}>
              {formatMonthYear(member.memberSince)}
            </CardLine>
            <CardLine label={t('tenantOwner.bandMembers.lastActive')}>
              {t('tenantOwner.bandMembers.when', {
                days: member.lastActive.daysAgo,
                time: member.lastActive.time ?? '',
              })}
            </CardLine>
            <CardLine label={t('tenantOwner.bandMembers.topCommunity')}>
              {topCommunityLabel(t, member.topCommunityId)}
            </CardLine>
            <CardLine label={t('tenantOwner.bandMembers.dailyTime')}>
              {formatHoursMinutes(t, member.dailyMinutes.value)}
            </CardLine>
          </dl>
        </div>
        <ArrowUpRight
          aria-hidden
          size={16}
          className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
        />
      </Card>
    </CardLink>
  );
}

/**
 * One band's member list (quick 261012-pkd D-02, kept as is by quick 261012-tru D-02): the 10 most
 * recent members of the list scope as cards, on a grid that uses the width (`wide`: two side by side
 * on the web and three from a 100rem container; else one, and two from 100rem); over 10 it says so
 * on top and ends with how many more plus a disabled "Ver todos" (A-3); no members says so (A-4).
 * `count` is the band's count in the list scope, so the body always agrees with what led here. Each
 * card opens the member's insights one level down; the cards rise in one after the other.
 */
function MemberList({
  t,
  view,
  scope,
  band,
  count,
  wide,
}: {
  t: DashboardT;
  view: BandView;
  scope: OwnerBandScope;
  band: EngagementBand;
  count: number;
  wide: boolean;
}) {
  if (count === 0) {
    return <p className="text-sm text-text-secondary">{t('tenantOwner.bandMembers.empty')}</p>;
  }
  const { members, more } = ownerBandList(scope, band);
  return (
    <>
      {more > 0 ? (
        <p className="text-xs font-medium text-text-tertiary">
          {t('tenantOwner.bandMembers.recent', { count: members.length })}
        </p>
      ) : null}
      <ul
        data-dash-stagger
        className={cn(
          'grid gap-3',
          wide ? '@4xl:grid-cols-2 @min-[100rem]:grid-cols-3' : '@min-[100rem]:grid-cols-2',
        )}
      >
        {members.map((member) => (
          <li key={member.id} className="grid min-w-0">
            <MemberCard
              t={t}
              member={member}
              href={ownerMembersHref({ ...view, band, memberId: member.id, list: null })}
            />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-text-secondary">
            <CountUp value={t('tenantOwner.bandMembers.more', { count: more })} />
          </p>
          <DisabledAction>{t('tenantOwner.bandMembers.seeAll')}</DisabledAction>
        </div>
      ) : null}
    </>
  );
}

/** `Encontro mensal · 12/10` or `Comunidade VIP`: the opened item as the members line names it. */
function itemName(t: DashboardT, kind: 'community' | 'event', id: string): string {
  if (kind === 'community') return communityLabel(t, ownerCommunity(id));
  const event = ownerEvent(id);
  return t('tenantOwner.bandScope.event', { name: event.name, date: formatDayMonth(event.date) });
}

/**
 * A community or event opened inside its band (quick 261012-tru D-05): the way back to the band's
 * cards, then the item's own card (not a link here) and that band's members in it, side by side on
 * the web (the card a third of the width, so its cover keeps a card's size), stacked on a phone.
 */
function OpenedItem({
  t,
  view,
  kind,
  id,
  band,
}: {
  t: DashboardT;
  view: BandView;
  kind: 'community' | 'event';
  id: string;
  band: EngagementBand;
}) {
  const scope: OwnerBandScope = { kind, id };
  const Item = kind === 'community' ? CommunityScopeCard : EventScopeCard;
  return (
    <>
      <BackLink
        href={ownerMembersHref({ ...view, band, itemId: null, memberId: null, list: null })}
        label={t(
          kind === 'community'
            ? 'tenantOwner.scopeCards.backCommunities'
            : 'tenantOwner.scopeCards.backEvents',
        )}
      />
      <div className="flex flex-col gap-3 @4xl:grid @4xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @4xl:items-start @4xl:gap-4">
        {/* A wrapper, so the card keeps its own height beside a long member list. */}
        <div className="min-w-0">
          <Item t={t} id={id} band={band} href={null} />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm font-bold text-text">
            {t('tenantOwner.scopeCards.membersIn', {
              band: bandLabel(t, band),
              item: itemName(t, kind, id),
            })}
          </p>
          <MemberList
            t={t}
            view={view}
            scope={scope}
            band={band}
            count={ownerScopeBands(scope).counts[band]}
            wide={false}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The six engagement bands of the level-4 Membros area, one cascade in the three tabs (quick
 * 261012-tru D-01, D-02): each band is a closed native `<details>` whose summary reads the whole-base
 * count · share with a mini bar (only Em risco solid, the band to act on). Opened, Por membro lists
 * its members; Por comunidade and Por evento list the community or event cards with how many of the
 * band each holds, and a card opens that item in place with its members in the band (D-05). A member
 * card opens the member's insights (D-06); coming back, the view renders the same band (and item)
 * open. Names reach the client's own team only (261012-pkd D-03).
 */
export function BandMembers({ t, bands, view }: BandMembersProps) {
  const total = bandTotal(bands);
  return ENGAGEMENT_BAND_ORDER.map((band) => {
    const open = band === view.band;
    let body: ReactNode;
    if (view.kind === 'member') {
      body = (
        <MemberList
          t={t}
          view={view}
          scope={{ kind: 'member' }}
          band={band}
          count={bands.counts[band]}
          wide
        />
      );
    } else if (open && view.itemId !== null) {
      body = <OpenedItem t={t} view={view} kind={view.kind} id={view.itemId} band={band} />;
    } else {
      body = <ScopeItemCards t={t} kind={view.kind} band={band} />;
    }
    return (
      <Collapsible
        key={band}
        open={open}
        title={bandLabel(t, band)}
        summary={
          <BandSummary
            t={t}
            band={band}
            count={bands.counts[band]}
            total={total}
            barClassName="@4xl:w-40 @min-[100rem]:w-56"
          />
        }
      >
        {body}
      </Collapsible>
    );
  });
}
