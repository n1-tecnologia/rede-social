import type {
  CommunityEngagement,
  EngagementBandsAnswer,
  EventEngagement,
} from '@rede-social/module-dashboard/contracts';
import { bandTotal, Collapsible, ENGAGEMENT_BAND_ORDER } from '@rede-social/module-dashboard/ui';
import type { ReactNode } from 'react';
import {
  type EngagementBand,
  type OwnerMembersView,
  ownerBandListParams,
  ownerMembersHref,
} from '@/lib/owner-band-scope';
import { localDate, type MemberRowView } from '@/lib/owner-list-view';
import { BackLink } from './BackLink';
import { CommunityScopeCard, EventScopeCard, ScopeItemCards } from './BandScopeCards';
import { BandSummary } from './BandSummary';
import { bandLabel, communityLabel, type DashboardT, formatDayMonth } from './format';
import { OwnerListMore } from './OwnerListMore';
import { OwnerListRows } from './OwnerListRows';

/** The cascade levels the bands render (the member level replaces the area, see OwnerMembers). */
type BandView = Pick<OwnerMembersView, 'kind' | 'band' | 'itemId'>;

/**
 * One band list's first page as the area read it (08.7-05): `ready` with the band's total in the
 * list's scope, its first rows as finished views and the cursor of the next page, or `error` (the
 * list's error card, UI-D-479). A band the area did not read has no entry.
 */
export type BandListView =
  | { status: 'ready'; total: number; rows: MemberRowView[]; nextCursor: string | null }
  | { status: 'error' };

export interface BandMembersProps {
  t: DashboardT;
  /** The whole base's bands: every tab's headers count each member once (quick 261012-tru D-02). */
  bands: EngagementBandsAnswer;
  /** The tab, the open band and the opened community or event (syntactic, `parseOwnerMembersView`). */
  view: BandView;
  /** Por membro: each band's first page; an opened item: the open band's first page. */
  lists: Partial<Record<EngagementBand, BandListView>>;
  /** The answer's communities (present only with `communities` on), in the answer's order. */
  communities: readonly CommunityEngagement[];
  /** The answer's events (present only with `events` on), upcoming soonest first, then past. */
  events: readonly EventEngagement[];
  /** `bootstrap.tenant.timezone`: an event card's date is the tenant's. */
  timeZone: string;
}

/**
 * One band's member list (quick 261012-pkd D-02; 08.7-05 on real rows): the 10 most recent members
 * of the list scope as cards, on a grid that uses the width (`wide`); over 10 it says so on top and
 * ends with "e mais N" and an ENABLED "Ver todos" that continues the list in place (UI-D-477); no
 * members says so (A-4); a failed read is the list's error card (UI-D-479). `count` is the band's
 * count in the list scope from the Membros answer, so an empty band costs no request.
 */
function MemberList({
  t,
  view,
  band,
  count,
  list,
  wide,
}: {
  t: DashboardT;
  view: BandView;
  band: EngagementBand;
  count: number;
  list: BandListView | undefined;
  wide: boolean;
}) {
  if (count === 0) {
    return <p className="text-sm text-text-secondary">{t('tenantOwner.bandMembers.empty')}</p>;
  }
  if (!list || list.status === 'error') {
    return (
      <p data-owner-list-error className="text-sm text-text-secondary">
        {t('report.errors.list')}
      </p>
    );
  }
  if (list.rows.length === 0) {
    return <p className="text-sm text-text-secondary">{t('tenantOwner.bandMembers.empty')}</p>;
  }
  const more = list.total - list.rows.length;
  const request = ownerBandListParams(view, band);
  const continues = more > 0 && list.nextCursor !== null && request !== null;
  const layout = wide ? 'cards-wide' : 'cards';
  return (
    <>
      {continues ? (
        <p className="text-xs font-medium text-text-tertiary">
          {t('tenantOwner.bandMembers.recent', { count: list.rows.length })}
        </p>
      ) : null}
      <OwnerListRows rows={list.rows} layout={layout} />
      {continues && list.nextCursor !== null && request !== null ? (
        <OwnerListMore
          request={{ kind: 'band', ...request }}
          cursor={list.nextCursor}
          layout={layout}
          more={t('tenantOwner.bandMembers.more', { count: more })}
          labels={{
            seeAll: t('tenantOwner.bandMembers.seeAll'),
            error: t('report.errors.more'),
            retry: t('report.errors.retry'),
          }}
        />
      ) : null}
    </>
  );
}

/** `Encontro mensal · 24/10` or `Comunidade VIP`: the opened item as the members line names it. */
function itemName(
  t: DashboardT,
  item:
    | { kind: 'community'; community: CommunityEngagement }
    | { kind: 'event'; event: EventEngagement },
  timeZone: string,
): string {
  if (item.kind === 'community') return communityLabel(t, item.community);
  return t('tenantOwner.bandScope.event', {
    name: item.event.title,
    date: formatDayMonth(localDate(item.event.startsAt, timeZone)),
  });
}

/**
 * A community or event opened inside its band (quick 261012-tru D-05): the way back to the band's
 * cards, then the item's own card (not a link here) and that band's members in it, side by side on
 * the web (the card a third of the width, so its cover keeps a card's size), stacked on a phone. An
 * item the answer does not hold (an archived community, an event outside the panel's) has no card;
 * its members still list, counted by the band list's own total.
 */
function OpenedItem({
  t,
  view,
  kind,
  id,
  band,
  list,
  communities,
  events,
  timeZone,
}: {
  t: DashboardT;
  view: BandView;
  kind: 'community' | 'event';
  id: string;
  band: EngagementBand;
  list: BandListView | undefined;
  communities: readonly CommunityEngagement[];
  events: readonly EventEngagement[];
  timeZone: string;
}) {
  const community = kind === 'community' ? communities.find((row) => row.id === id) : undefined;
  const event = kind === 'event' ? events.find((row) => row.id === id) : undefined;
  let card: ReactNode = null;
  let name: string | null = null;
  let count = list?.status === 'ready' ? list.total : 1;
  if (community) {
    card = <CommunityScopeCard t={t} community={community} band={band} href={null} />;
    name = itemName(t, { kind: 'community', community }, timeZone);
    count = community.bands.counts[band];
  } else if (event) {
    card = <EventScopeCard t={t} event={event} band={band} href={null} timeZone={timeZone} />;
    name = itemName(t, { kind: 'event', event }, timeZone);
    count = event.bands.counts[band];
  }
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
        <div className="min-w-0">{card}</div>
        <div className="flex min-w-0 flex-col gap-3">
          {name ? (
            <p className="text-sm font-bold text-text">
              {t('tenantOwner.scopeCards.membersIn', { band: bandLabel(t, band), item: name })}
            </p>
          ) : null}
          <MemberList t={t} view={view} band={band} count={count} list={list} wide={false} />
        </div>
      </div>
    </>
  );
}

/**
 * The six engagement bands of the level-4 Membros area, one cascade in the tabs (quick 261012-tru
 * D-01, D-02; 08.7-05 on the snapshot): each band is a closed native `<details>` whose summary reads
 * the whole-base count · share with a mini bar (only Em risco solid, the band to act on), exact
 * counts, small ones included (UI-D-486). Opened, Por membro lists its members; Por comunidade and
 * Por evento list the community or event cards with how many of the band each holds, and a card
 * opens that item in place with its members in the band (D-05). A member card opens the member's
 * detail (D-06, D-461). Names reach the client's own team only (261012-pkd D-03).
 */
export function BandMembers({
  t,
  bands,
  view,
  lists,
  communities,
  events,
  timeZone,
}: BandMembersProps) {
  const total = bandTotal(bands);
  return ENGAGEMENT_BAND_ORDER.map((band) => {
    const open = band === view.band;
    let body: ReactNode;
    if (view.kind === 'member') {
      body = (
        <MemberList
          t={t}
          view={view}
          band={band}
          count={bands.counts[band]}
          list={lists[band]}
          wide
        />
      );
    } else if (open && view.itemId !== null) {
      body = (
        <OpenedItem
          t={t}
          view={view}
          kind={view.kind}
          id={view.itemId}
          band={band}
          list={lists[band]}
          communities={communities}
          events={events}
          timeZone={timeZone}
        />
      );
    } else {
      body = (
        <ScopeItemCards
          t={t}
          kind={view.kind}
          band={band}
          communities={communities}
          events={events}
          timeZone={timeZone}
        />
      );
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
