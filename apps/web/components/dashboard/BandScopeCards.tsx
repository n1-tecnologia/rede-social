import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { CommunityCover } from '@rede-social/module-communities/ui';
import type { CommunityEngagement, EventEngagement } from '@rede-social/module-dashboard/contracts';
import { CountUp, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { EventCover } from '@rede-social/module-events/ui';
import { Card, cn, StatusPill } from '@rede-social/ui';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { type EngagementBand, ownerMembersHref } from '@/lib/owner-band-scope';
import { localDate } from '@/lib/owner-list-view';
import { CardLink } from './CardLink';
import { ComingSoonPill } from './ComingSoon';
import {
  communityLabel,
  type DashboardT,
  formatCount,
  formatDayMonth,
  formatDuration,
} from './format';

/**
 * The community and event cards of the Membros bands (quick 261012-tru D-03, D-04), since 08.7-05
 * drawn from the Membros answer: the snapshot's numbers per scope and the LIVE labels the API joins
 * at read time (name, description, cover, exclusive; title, dates, format, cover). No fixture value
 * is read here: Eventos passes its own answer to `EventCard`.
 */

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
 * its day and month apart). `node` replaces the value (the "Em breve" pill, D-455).
 * `justify-between` keeps the values on one line when a label wraps to two and its neighbor does not.
 */
export function Cell({
  label,
  value,
  node,
  className,
  count,
}: {
  label: string;
  value: string;
  node?: ReactNode;
  className?: string;
  /** Count the value up from zero; off for a date. */
  count?: boolean;
}) {
  const counts = count ?? !value.includes('/');
  return (
    <div className={`flex min-w-0 flex-col justify-between gap-0.5 ${className ?? ''}`}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-lg font-bold text-text tabular-nums [overflow-wrap:normal]">
        {node ?? (counts ? <CountUp value={value} /> : value)}
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

interface ScopeCardProps {
  t: DashboardT;
  band: EngagementBand;
  /** The opened item's link; null = not a link (the opened item, or nobody in the band). */
  href: string | null;
}

/**
 * A community as the user drew it (quick 261012-tru D-03): the full-width cover at its original
 * 16:7 (the communities module's own `card` box; its `--brand-gradient` fallback without a photo),
 * the name below it, the description, a thin line, four counted columns (members with access,
 * active in the week, posts and likes + comments in the month) and how many of the band are in it.
 * A linked card lifts on hover, as the member report's.
 */
export function CommunityScopeCard({
  t,
  community,
  band,
  href,
}: ScopeCardProps & { community: CommunityEngagement }) {
  const name = communityLabel(t, community);
  const key = 'tenantOwner.scopeCards.community';
  return (
    <Linked href={href}>
      <Card className={cn(SURFACE, RISE, 'flex h-full flex-col', href !== null && LIFT)}>
        <CommunityCover
          geometry="card"
          coverAssetId={community.coverAssetId}
          coverVariantWidths={PURPOSE_WIDTHS.cover}
          coverAlt={name}
        />
        <div className="flex flex-1 flex-col gap-3 p-4 [overflow-wrap:anywhere]">
          <div className="flex flex-col gap-1">
            <span className="text-xl font-bold leading-tight text-text">{name}</span>
            {community.description ? (
              <span className="text-sm text-text-secondary">{community.description}</span>
            ) : null}
          </div>
          {/* mt-auto: in a row of cards the numbers line up whatever the descriptions. */}
          <dl className="mt-auto grid grid-cols-4 gap-2 border-t border-border pt-3">
            <Cell label={t(`${key}.members`)} value={formatCount(community.members)} />
            <Cell label={t(`${key}.activeWeek`)} value={formatCount(community.activeWeek)} />
            <Cell label={t(`${key}.posts`)} value={formatCount(community.posts)} />
            <Cell label={t(`${key}.interactions`)} value={formatCount(community.interactions)} />
          </dl>
          <InBand t={t} count={community.bands.counts[band]} linked={href !== null} />
        </div>
      </Card>
    </Linked>
  );
}

export interface CardCell {
  label: string;
  value: string;
  /** Replaces the value ("Em breve" pill, D-455). */
  node?: ReactNode;
}

/** What `EventCard` draws of an event: its name, its format and its cover asset (if any). */
export interface EventCardEvent {
  name: string;
  format: 'in_person' | 'online';
  coverAssetId?: string | null;
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
  event,
  href,
  detail,
  status,
  cover,
  cells,
  children,
}: {
  t: DashboardT;
  event: EventCardEvent;
  href: string | null;
  detail?: string;
  /** A warning next to the format ("Vagas esgotadas · 17 na espera"), already worded. */
  status?: string;
  /** Replaces the 16:10 event cover (Financeiro's low, varied band, quick 261014-ia8 F-7). */
  cover?: ReactNode;
  cells: readonly [CardCell, CardCell, CardCell];
  children?: ReactNode;
}) {
  return (
    <Linked href={href}>
      <Card className={cn(SURFACE, RISE, 'flex h-full flex-col', href !== null && LIFT)}>
        {cover ?? (
          <EventCover
            geometry="hero"
            coverAssetId={event.coverAssetId ?? null}
            coverVariantWidths={PURPOSE_WIDTHS.cover}
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
                node={cell.node}
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

/** Minutes between two instants (an event's length). */
function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

/**
 * An event in an opened band: its date (tenant time), its length and "Receita" as the "Em breve"
 * line (D-455: no ticket price is stored), and how many of the band said "vou".
 */
export function EventScopeCard({
  t,
  event,
  band,
  href,
  timeZone,
}: ScopeCardProps & { event: EventEngagement; timeZone: string }) {
  const key = 'tenantOwner.scopeCards.event';
  return (
    <EventCard
      t={t}
      event={{ name: event.title, format: event.format, coverAssetId: event.coverAssetId }}
      href={href}
      cells={[
        { label: t(`${key}.date`), value: formatDayMonth(localDate(event.startsAt, timeZone)) },
        {
          label: t(`${key}.duration`),
          value: formatDuration(t, minutesBetween(event.startsAt, event.endsAt)),
        },
        {
          label: t(`${key}.revenue`),
          value: t('report.comingSoon.value'),
          node: <ComingSoonPill label={t('report.comingSoon.value')} />,
        },
      ]}
    >
      <InBand t={t} count={event.bands.counts[band]} linked={href !== null} />
    </EventCard>
  );
}

/**
 * The cards of a band opened in Por comunidade or Por evento (D-02), on a grid that uses the width
 * (two communities or three events side by side on the web, four from a 100rem container): every
 * community or event of the answer, each linked one level down when it has members in the band,
 * else unlinked with "0 nesta faixa". The cards rise in one after the other.
 */
export function ScopeItemCards({
  t,
  kind,
  band,
  communities,
  events,
  timeZone,
}: {
  t: DashboardT;
  kind: 'community' | 'event';
  band: EngagementBand;
  communities: readonly CommunityEngagement[];
  events: readonly EventEngagement[];
  timeZone: string;
}) {
  const hrefOf = (id: string, count: number) =>
    count > 0 ? ownerMembersHref({ kind, band, itemId: id, memberId: null, list: null }) : null;
  return (
    <ul
      data-dash-stagger
      className={cn(
        'grid gap-3 @min-[100rem]:grid-cols-4',
        kind === 'community' ? '@4xl:grid-cols-2' : '@4xl:grid-cols-3',
      )}
    >
      {kind === 'community'
        ? communities.map((community) => (
            <li key={community.id} className="grid min-w-0">
              <CommunityScopeCard
                t={t}
                community={community}
                band={band}
                href={hrefOf(community.id, community.bands.counts[band])}
              />
            </li>
          ))
        : events.map((event) => (
            <li key={event.id} className="grid min-w-0">
              <EventScopeCard
                t={t}
                event={event}
                band={band}
                href={hrefOf(event.id, event.bands.counts[band])}
                timeZone={timeZone}
              />
            </li>
          ))}
    </ul>
  );
}
