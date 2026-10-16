import { CommunityCover } from '@rede-social/module-communities/ui';
import {
  type EngagementBand,
  ownerScopeBands,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { bandTotal, CountUp, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { EventCover } from '@rede-social/module-events/ui';
import { Card, cn, StatusPill } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { OWNER_COMMUNITIES, OWNER_EVENTS, ownerMembersHref } from '@/lib/owner-band-scope';
import { CardLink } from './CardLink';
import {
  communityLabel,
  type DashboardT,
  formatBrlCompact,
  formatCount,
  formatDayMonth,
  formatDuration,
} from './format';

const ALL_EVENTS = [...tenantOwnerPanel.events.past, ...tenantOwnerPanel.events.upcoming];

export function ownerCommunity(id: string) {
  const community = tenantOwnerPanel.byCommunity.find((row) => row.id === id);
  if (!community) throw new Error(`no community ${id}`);
  return community;
}

export function ownerEvent(id: string) {
  const event = ALL_EVENTS.find((row) => row.id === id);
  if (!event) throw new Error(`no event ${id}`);
  return event;
}

interface ScopeCardProps {
  t: DashboardT;
  id: string;
  band: EngagementBand;
  /** The opened item's link; null = not a link (the opened item, or nobody in the band). */
  href: string | null;
}

/**
 * The card's last row: how many of the band are in the item (it counts up), and a chevron that
 * nudges on hover when the card opens.
 */
function InBand({ t, count, linked }: { t: DashboardT; count: number; linked: boolean }) {
  return (
    <p className="flex items-center justify-between gap-2 pt-1 text-sm font-bold text-brand">
      <span>
        <CountUp value={t('tenantOwner.scopeCards.inBand', { count: formatCount(count) })} />
      </span>
      {linked ? (
        <ChevronRight
          aria-hidden
          size={18}
          className="shrink-0 transition-transform duration-300 ease-out group-hover/link:translate-x-0.5 motion-reduce:transition-none"
        />
      ) : null}
    </p>
  );
}

/**
 * One column of a card: the small gray label, then the large bold value, which counts up when the
 * card is revealed (`count`; by default every value but a date such as `17/10`, which would count
 * its day and month apart). `justify-between` keeps the values on one line when a label wraps to
 * two and its neighbor does not.
 */
export function Cell({
  label,
  value,
  className,
  count,
}: {
  label: string;
  value: string;
  className?: string;
  /** Count the value up from zero; off for a date. */
  count?: boolean;
}) {
  const counts = count ?? !value.includes('/');
  return (
    <div className={`flex min-w-0 flex-col justify-between gap-0.5 ${className ?? ''}`}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-lg font-bold text-text tabular-nums [overflow-wrap:normal]">
        {counts ? <CountUp value={value} /> : value}
      </dd>
    </div>
  );
}

/**
 * The whole card is the link when it opens, else plain. A link is a `CardLink` (the member report's
 * card link: `group/link` for the hover lift, the focus ring), so a card inside it takes `LIFT`.
 */
export function Linked({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) return children;
  return <CardLink href={href}>{children}</CardLink>;
}

/**
 * A community as the user drew it (quick 261012-tru D-03): the full-width cover at its original
 * 16:7 (the communities module's own `card` box; no photo in the sample, so its `--brand-gradient`
 * fallback), the name below it, the description, a thin line, four counted columns (members, active
 * in the week, posts and likes + comments in the month) and how many of the band are in it. A linked
 * card lifts on hover, as the member report's.
 */
export function CommunityScopeCard({ t, id, band, href }: ScopeCardProps) {
  const community = ownerCommunity(id);
  // The members with access to it: the sum of its own six bands.
  const bands = ownerScopeBands({ kind: 'community', id });
  const name = communityLabel(t, community);
  const key = 'tenantOwner.scopeCards.community';
  return (
    <Linked href={href}>
      <Card className={cn(SURFACE, RISE, 'flex h-full flex-col', href !== null && LIFT)}>
        <CommunityCover
          geometry="card"
          coverAssetId={null}
          coverVariantWidths={[]}
          coverAlt={name}
        />
        <div className="flex flex-1 flex-col gap-3 p-4 [overflow-wrap:anywhere]">
          <div className="flex flex-col gap-1">
            <span className="text-xl font-bold leading-tight text-text">{name}</span>
            <span className="text-sm text-text-secondary">{community.description}</span>
          </div>
          {/* mt-auto: in a row of cards the numbers line up whatever the descriptions. */}
          <dl className="mt-auto grid grid-cols-4 gap-2 border-t border-border pt-3">
            <Cell label={t(`${key}.members`)} value={formatCount(bandTotal(bands))} />
            <Cell label={t(`${key}.activeWeek`)} value={formatCount(community.activeWeek)} />
            <Cell label={t(`${key}.posts`)} value={formatCount(community.posts)} />
            <Cell label={t(`${key}.interactions`)} value={formatCount(community.interactions)} />
          </dl>
          <InBand t={t} count={bands.counts[band]} linked={href !== null} />
        </div>
      </Card>
    </Linked>
  );
}

interface CardCell {
  label: string;
  value: string;
}

/**
 * An event's example receita: RSVPs × the example ticket price, the one formula of every card. A free
 * event reads "Gratuito", not "R$ 0,00", which looked like missing data next to "R$ 5,5 mil".
 */
export function eventRevenue(
  t: DashboardT,
  event: { confirmed: number; ticketCents: { value: number } },
) {
  const cents = event.confirmed * event.ticketCents.value;
  return cents === 0 ? t('tenantOwner.scopeCards.event.free') : formatBrlCompact(cents);
}

/**
 * An event as the user drew it (quick 261012-tru D-04): the full-width cover at its original 16:10
 * (the events module's own `hero` box, `--brand-gradient` fallback), the name, a Presencial/Online
 * pill with an optional warning pill (`status`) and gray line, a thin line, three counted columns
 * split by thin lines, then the host's footer. The bands' cards and the Eventos area's next events
 * (quick 261013-p31) share it; it is the panels' surface and rises in, and only a linked card lifts
 * on hover, so a card with nowhere to go promises no tap.
 */
export function EventCard({
  t,
  id,
  href,
  detail,
  status,
  cover,
  cells,
  children,
}: {
  t: DashboardT;
  id: string;
  href: string | null;
  detail?: string;
  /** A warning next to the format ("Vagas esgotadas · 17 na espera"), already worded. */
  status?: string;
  /** Replaces the 16:10 event cover (Financeiro's low, varied band, quick 261014-ia8 F-7). */
  cover?: ReactNode;
  cells: readonly [CardCell, CardCell, CardCell];
  children?: ReactNode;
}) {
  const event = ownerEvent(id);
  return (
    <Linked href={href}>
      <Card className={cn(SURFACE, RISE, 'flex h-full flex-col', href !== null && LIFT)}>
        {cover ?? (
          <EventCover
            geometry="hero"
            coverAssetId={null}
            coverVariantWidths={[]}
            coverAlt={event.name}
          />
        )}
        <div className="flex flex-1 flex-col gap-3 p-4 [overflow-wrap:anywhere]">
          <div className="flex flex-col items-start gap-2">
            <span className="text-xl font-bold leading-tight text-text">{event.name}</span>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="brand" className="w-fit">
                {t(`tenantOwner.formatsCompared.${event.format}`)}
              </StatusPill>
              {status === undefined ? null : (
                <StatusPill tone="warning" className="w-fit">
                  {status}
                </StatusPill>
              )}
              {detail === undefined ? null : (
                <span className="text-sm text-text-secondary">{detail}</span>
              )}
            </div>
          </div>
          {/* Equal columns while every value fits; a two-word value ("Sem limite") widens its own
              column at 360 px instead of breaking onto two lines. */}
          <dl className="grid grid-cols-[repeat(3,minmax(max-content,1fr))] divide-x divide-border border-t border-border pt-3">
            {cells.map((cell) => (
              <Cell
                key={cell.label}
                label={cell.label}
                value={cell.value}
                className="px-2 first:pl-0 last:pr-0"
              />
            ))}
          </dl>
          {children}
        </div>
      </Card>
    </Linked>
  );
}

/** An event in an opened band: date, duration, receita, and how many of the band registered. */
export function EventScopeCard({ t, id, band, href }: ScopeCardProps) {
  const event = ownerEvent(id);
  const key = 'tenantOwner.scopeCards.event';
  return (
    <EventCard
      t={t}
      id={id}
      href={href}
      cells={[
        { label: t(`${key}.date`), value: formatDayMonth(event.date) },
        { label: t(`${key}.duration`), value: formatDuration(t, event.durationMinutes) },
        { label: t(`${key}.revenue`), value: eventRevenue(t, event) },
      ]}
    >
      <InBand
        t={t}
        count={ownerScopeBands({ kind: 'event', id }).counts[band]}
        linked={href !== null}
      />
    </EventCard>
  );
}

/**
 * The cards of a band opened in Por comunidade or Por evento (D-02), on a grid that uses the width
 * (two communities or three events side by side on the web, four from a 100rem container): every
 * community or event in the panel's order, each linked one level down when it has members in the
 * band, else unlinked with "0 nesta faixa" (its URL would fall back here anyway). The cards rise in
 * one after the other.
 */
export function ScopeItemCards({
  t,
  kind,
  band,
}: {
  t: DashboardT;
  kind: 'community' | 'event';
  band: EngagementBand;
}) {
  const ids = (kind === 'community' ? OWNER_COMMUNITIES : OWNER_EVENTS).map((row) => row.id);
  const Item = kind === 'community' ? CommunityScopeCard : EventScopeCard;
  return (
    <ul
      data-dash-stagger
      className={cn(
        'grid gap-3 @min-[100rem]:grid-cols-4',
        kind === 'community' ? '@4xl:grid-cols-2' : '@4xl:grid-cols-3',
      )}
    >
      {ids.map((id) => {
        const count = ownerScopeBands({ kind, id }).counts[band];
        const href =
          count > 0
            ? ownerMembersHref({ kind, band, itemId: id, memberId: null, list: null })
            : null;
        return (
          <li key={id} className="grid min-w-0">
            <Item t={t} id={id} band={band} href={href} />
          </li>
        );
      })}
    </ul>
  );
}
