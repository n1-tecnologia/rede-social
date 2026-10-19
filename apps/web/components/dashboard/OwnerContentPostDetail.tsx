import { formatBrl } from '@rede-social/contracts/money';
import {
  CONTENT_VELOCITY_HOURS,
  type ContentItemAnswer,
  type FlooredCount,
  type OwnerContentDetailReady,
  type OwnerContentReady,
  PRIVACY_FLOOR,
} from '@rede-social/module-dashboard/contracts';
import {
  ActionCard,
  BarList,
  type BarRow,
  CountUp,
  KpiCard,
  KpiGrid,
  LIFT,
  LineChart,
  percentOf,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  AlertTriangle,
  Bookmark,
  CalendarCheck2,
  CheckCheck,
  Clock,
  Crown,
  Heart,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  Send,
  ShoppingBag,
  UserCheck,
  Zap,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getOwnerContentDetail, getOwnerMembers } from '@/lib/dashboard';
import {
  bestHeatCell,
  type ContentRowContext,
  contentCommunityNames,
  contentMeta,
  daysSince,
  interactionsOf,
  kindAverage,
} from '@/lib/owner-content-rows';
import {
  type ContentWho,
  contentBackHref,
  contentRecommendation,
  contentWhoAnchor,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { OWNER_PANEL_ANCHOR, type OwnerPanelFlags } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import { ComingSoonBlock } from './ComingSoon';
import {
  bandGroupLabel,
  type DashboardT,
  formatCount,
  formatDecimal,
  formatHoursMinutes,
  formatPercent,
} from './format';
import { LegendStroke } from './LegendStroke';
import { OwnerAreaState } from './OwnerAreaState';
import { ContentCover, contentAgeText, LinkArrow } from './OwnerContentPostCard';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content.detail';

/** Half the area's width on the web: one cell of two from 56rem, two cells of four from 100rem. */
const HALF = '@min-[100rem]:col-span-2';

/** Under 48 hours a publication is still collecting: no comparison yet (D-06). */
const COMPARABLE_AFTER_DAYS = 2;

type Item = ContentItemAnswer;

/** What every block of the detail reads. */
interface DetailCtx {
  t: DashboardT;
  item: Item;
  answer: OwnerContentReady;
  detail: OwnerContentDetailReady;
  view: OwnerContentView & { postId: string };
  flags: OwnerPanelFlags;
  row: ContentRowContext;
  daysAgo: number;
}

/** A group total through the floor: "menos de 5" with no value (D-462), a 0 is the value 0. */
function flooredText(t: DashboardT, count: FlooredCount): string {
  return count.belowFloor ? t('belowFloor', { floor: PRIVACY_FLOOR }) : formatCount(count.value);
}

/** "dos vídeos", "das fotos": the kind with its article, for "a média …". */
function kindsLabel(t: DashboardT, item: Item): string {
  return t(`tenantOwner.content.kindsOf.${item.kind}`);
}

/** An "Em breve" block (D-455, UI-D-466 c) in its place on the grid. */
function MissingBlock({
  t,
  title,
  className,
}: {
  t: DashboardT;
  title: string;
  className: string;
}) {
  return (
    <div className={cn('grid', className)}>
      <ComingSoonBlock
        title={title}
        label={t('report.comingSoon.value')}
        note={t('report.comingSoon.block')}
      />
    </div>
  );
}

/**
 * The detail's header (D-06), across the area: the cover (on the web at the left, capped lower; a
 * video plays on its post page, D-461), the whole caption, the meta, how many interactions
 * (counting up) and, in a chip, how it did against its kind.
 */
function Header({ t, item, answer, row, daysAgo }: DetailCtx) {
  const interactions = interactionsOf(item);
  const average = kindAverage(answer, item.kind);
  return (
    <Card className={cn(SURFACE, RISE, 'flex flex-col overflow-hidden @4xl:flex-row', SPAN_ALL)}>
      <ContentCover
        t={t}
        item={item}
        maxHeightRem={28}
        className="@4xl:w-72 @4xl:shrink-0 @4xl:items-center @4xl:[--cover-h:18rem]"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 p-4 [overflow-wrap:anywhere] @4xl:p-6">
        <h3 className="text-lg font-bold leading-snug text-text">{item.excerpt}</h3>
        <p className="text-xs text-text-secondary">{contentMeta(t, item, row)}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-2xl font-extrabold tabular-nums tracking-tight text-text">
            <CountUp
              value={t(`${KEY}.interactions`, {
                count: interactions,
                value: formatCount(interactions),
              })}
            />
          </span>
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-bold tabular-nums text-brand">
            {daysAgo < COMPARABLE_AFTER_DAYS || average === 0
              ? t(`${KEY}.inProgress`)
              : t(`${KEY}.vsKind`, {
                  ratio: formatDecimal(interactions / average, 1),
                  kinds: kindsLabel(t, item),
                })}
          </span>
        </p>
      </div>
    </Card>
  );
}

const WHO_ICON: Record<ContentWho, LucideIcon> = { likes: Heart, comments: MessageCircle };

/**
 * Interações (D-06, P1): the likes and comments as the report's cards, each wholly a link to the
 * members who did it (landing back on itself); saves (posts only: a story cannot be saved) and
 * shares are the unlinked "Em breve" tiles (D-455: they never open).
 */
function Interactions({ t, item, view }: DetailCtx) {
  const rows: { who: ContentWho; value: number }[] = [
    { who: 'likes', value: item.likes },
    { who: 'comments', value: item.comments },
  ];
  const missing: { name: 'saves' | 'shares'; icon: LucideIcon }[] = [
    ...(item.kind === 'story' ? [] : [{ name: 'saves' as const, icon: Bookmark }]),
    { name: 'shares', icon: Send },
  ];
  return (
    <PanelSection as="h4" title={t(`${KEY}.interactionsTitle`)} className={SPAN_ALL}>
      <KpiGrid>
        {rows.map((row) => (
          <CardLink
            key={row.who}
            id={contentWhoAnchor(row.who)}
            href={ownerContentHref({ ...view, who: row.who, memberId: null, list: null })}
          >
            <KpiCard
              icon={WHO_ICON[row.who]}
              label={t(`tenantOwner.content.card.${row.who}`)}
              value={formatCount(row.value)}
              linked={t('tenantOwner.seeList')}
            />
          </CardLink>
        ))}
        {missing.map((card) => (
          <KpiCard
            key={card.name}
            variant="missing"
            icon={card.icon}
            label={t(`tenantOwner.content.card.${card.name}`)}
            value={t('report.comingSoon.value')}
            note={t('report.comingSoon.note')}
          />
        ))}
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * Primeiras 48 horas: the member likes + comments at 48 hours and, beside them, how they came in
 * (cumulative at 6, 12 … 48 hours), as the report's usage card; nothing while they are not over yet.
 */
function Velocity({ t, detail, daysAgo }: DetailCtx) {
  const key = `${KEY}.velocity`;
  const curve = detail.velocity48h;
  if (daysAgo < COMPARABLE_AFTER_DAYS) return null;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiCard
        icon={Zap}
        label={t(`${KEY}.interactionsTitle`)}
        value={formatCount(curve.at(-1) ?? 0)}
        chartPlacement="side"
        chart={
          <LineChart
            series={curve}
            xLabels={CONTENT_VELOCITY_HOURS.map((hours, i) =>
              i % 2 === 1 ? t(`${key}.hour`, { hours }) : '',
            )}
            yStep={10}
            formatValue={formatCount}
            ariaLabel={t(`${key}.labelOne`)}
            height={150}
          />
        }
        footer={
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-text-secondary">
            <li className="flex items-center gap-1.5">
              <LegendStroke dashed={false} />
              {t(`${key}.current`)}
            </li>
          </ul>
        }
      />
    </PanelSection>
  );
}

/**
 * Quem a publicação alcançou, por faixa: a post's reach is not measured (an "Em breve" block,
 * D-455); a story's viewers by today's band, merged under the floor by the API (EP-45) and labelled
 * by `bandGroupLabel`, a floored group an empty bar with "menos de 5" sorted last (UI-D-470). Totals
 * only, never a link to anyone (P3). A story nobody saw says so.
 */
function ReachByBand({ t, item, detail }: DetailCtx) {
  const key = `${KEY}.reach`;
  const { reachByBand } = detail;
  if (!Array.isArray(reachByBand)) {
    return <MissingBlock t={t} title={t(`${key}.title`)} className={HALF} />;
  }
  const floor = t('belowFloor', { floor: PRIVACY_FLOOR });
  const reach = item.reach.measured ? item.reach.value : undefined;
  const rows: BarRow[] = reachByBand.map((group) => {
    const id = group.bands.join('-');
    const label = bandGroupLabel(t, group.bands);
    if (group.count.belowFloor) return { id, label, floored: true, display: floor };
    return {
      id,
      label,
      value: group.count.value,
      display: formatCount(group.count.value),
      rate: reach ? formatPercent(percentOf(group.count.value, reach)) : undefined,
    };
  });
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={HALF}>
      {rows.length === 0 ? (
        <Card className={cn(SURFACE, RISE, 'p-4')}>
          <p data-owner-empty="reach" className="text-xs font-normal text-text-secondary">
            {t(`${key}.empty`)}
          </p>
        </Card>
      ) : (
        <BarList
          className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
          max={reach}
          rows={rows}
        />
      )}
    </PanelSection>
  );
}

/** The RSVPs' card value: their sum when every event is shown; floored events are left out. */
function rsvpValue(t: DashboardT, rsvps: NonNullable<OwnerContentDetailReady['rsvps']>): string {
  if (rsvps.length === 0) return t(`${KEY}.app.noRsvps`);
  const shown = rsvps.flatMap((row) => (row.members.belowFloor ? [] : [row.members.value]));
  if (shown.length === 0) return t('belowFloor', { floor: PRIVACY_FLOOR });
  return formatCount(shown.reduce((sum, value) => sum + value, 0));
}

/**
 * O que só o app sabe (D-06, D-462), as the report's cards, each an ASSOCIATION within 7 days after
 * the members interacted, never a cause: members back after 30+ idle days, event RSVPs (events on;
 * each event in the footer), sales (store on; count and value together from 5 orders, "menos de 5
 * pedidos" with no amount under the floor, "nenhum pedido" for 0) and, for a post of the exclusive
 * community, the access purchases while it was the shop window, named live (UI-D-490).
 */
function AppKnows({ t, item, detail, flags, row }: DetailCtx) {
  const key = `${KEY}.app`;
  const { orders, rsvps, vitrine } = detail;
  const community = item.communityId ? row.communities[item.communityId] : undefined;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={HALF}>
      <KpiGrid className="@4xl:flex-1 @4xl:grid-cols-2">
        <KpiCard
          icon={UserCheck}
          label={t(`${key}.reactivated`)}
          value={flooredText(t, detail.reactivated)}
        />
        {flags.events && rsvps ? (
          <KpiCard
            icon={CalendarCheck2}
            label={t(`${key}.rsvps`)}
            value={rsvpValue(t, rsvps)}
            footer={
              rsvps.length === 0 ? undefined : (
                <ul className="flex flex-col gap-0.5 text-xs font-medium text-text-secondary">
                  {rsvps.map((rsvp) => (
                    <li key={rsvp.eventId}>
                      {rsvp.members.belowFloor
                        ? t(`${key}.rsvpLineFloor`, { name: rsvp.title, floor: PRIVACY_FLOOR })
                        : t(`${key}.rsvpLine`, { name: rsvp.title, count: rsvp.members.value })}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        ) : null}
        {flags.store && orders ? (
          <KpiCard
            icon={ShoppingBag}
            label={t(`${key}.sales`)}
            value={
              orders.belowFloor
                ? t(`${key}.salesFloor`, { floor: PRIVACY_FLOOR })
                : orders.count === 0
                  ? t(`${key}.noSales`)
                  : t(`${key}.salesValue`, { count: orders.count, value: formatBrl(orders.cents) })
            }
          />
        ) : null}
        {flags.store && vitrine && community ? (
          <KpiCard
            icon={Crown}
            label={t(`${key}.vitrine`, { community })}
            value={flooredText(t, vitrine)}
          />
        ) : null}
      </KpiGrid>
    </PanelSection>
  );
}

/** One of the comments card's lines: its glyph and the sentence, whose numbers count up. */
function CommentLine({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone: 'strong' | 'muted' | 'warning';
  children: string;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-sm',
        tone === 'strong' && 'font-bold text-text',
        tone === 'muted' && 'text-text-secondary',
        tone === 'warning' && 'font-semibold text-warning',
      )}
    >
      <Icon
        aria-hidden
        size={16}
        className={cn('mt-0.5 shrink-0', tone === 'warning' ? 'text-warning' : 'text-brand')}
      />
      <CountUp value={children} />
    </p>
  );
}

/**
 * Comentários (D-06), posts only (a story's replies are flat: its comment count stands in
 * Interações, UI-D-489 b): how many of the members' root comments the team answered, the median
 * first reply and how long the oldest unanswered waits. The whole card opens who commented
 * (unanswered first). Never a comment's text.
 */
function Comments({ t, item, view }: DetailCtx) {
  if (item.kind === 'story') return null;
  const key = `${KEY}.comments`;
  const { answered, unanswered, oldestUnansweredHours, firstReplyMedianMinutes } = item.commentMeta;
  const roots = answered + unanswered;
  const linked = item.comments > 0;
  const card: ReactNode = (
    <Card
      className={cn(
        SURFACE,
        RISE,
        'flex h-full flex-col gap-2.5 p-3 [overflow-wrap:anywhere] @3xl:p-4',
        linked && LIFT,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors duration-300 group-hover/link:bg-brand group-hover/link:text-on-brand motion-reduce:transition-none"
        >
          <MessageCircle size={16} strokeWidth={2.2} />
        </span>
        <h4 className="min-w-0 flex-1 text-xs font-semibold leading-snug text-text-secondary">
          {t(`${key}.title`)}
        </h4>
        {linked ? <LinkArrow label={t(`${key}.seeWho`)} /> : null}
      </div>
      {linked ? (
        <div className="flex flex-col gap-1.5">
          {roots > 0 ? (
            <CommentLine icon={CheckCheck} tone="strong">
              {t(`${key}.answered`, {
                answered: formatCount(answered),
                comments: formatCount(roots),
                percent: formatPercent(percentOf(answered, roots)),
              })}
            </CommentLine>
          ) : null}
          {firstReplyMedianMinutes !== null ? (
            <CommentLine icon={Clock} tone="muted">
              {t(`${key}.firstReply`, { time: formatHoursMinutes(t, firstReplyMedianMinutes) })}
            </CommentLine>
          ) : null}
          {unanswered > 0 && oldestUnansweredHours !== null ? (
            <CommentLine icon={AlertTriangle} tone="warning">
              {t(`${key}.waiting`, {
                count: unanswered,
                age: contentAgeText(t, oldestUnansweredHours),
              })}
            </CommentLine>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">{t(`${key}.none`)}</p>
      )}
    </Card>
  );
  return (
    <div id="comentarios" className={cn('grid scroll-mt-20', HALF)}>
      {linked ? (
        <CardLink href={ownerContentHref({ ...view, who: 'comments', memberId: null, list: null })}>
          {card}
        </CardLink>
      ) : (
        card
      )}
    </div>
  );
}

/**
 * Recomendação: the deterministic rule's advice with this publication's numbers (planning decision
 * 3), its action disabled with the "Em breve" pill (UI-D-478). "Até ontem": the numbers are the
 * snapshot's (UI-D-480). The push advice names the members at risk with push on: absent with
 * `notifications` off; the series and reel advice name the best slot: absent with no slot yet.
 */
function Recommendation({
  t,
  item,
  answer,
  daysAgo,
  atRiskWithPush,
  flags,
}: DetailCtx & { atRiskWithPush: number | null }) {
  const key = `${KEY}.recommendation`;
  const interactions = interactionsOf(item);
  const average = kindAverage(answer, item.kind);
  const rule = contentRecommendation({
    kind: item.kind,
    interactions,
    kindAverage: average,
    daysAgo,
    durationSeconds: item.durationSeconds,
  });
  const slot = bestHeatCell(answer.heatmap ?? []);
  if (rule === 'push' && (!flags.notifications || atRiskWithPush === null)) return null;
  if (rule !== 'push' && !slot) return null;
  return (
    <div className={cn('grid', HALF)}>
      <ActionCard
        icon={Lightbulb}
        title={t(`${key}.title`)}
        detail={t(`${key}.${rule}.detail`, {
          interactions: formatCount(interactions),
          withPush: formatCount(atRiskWithPush ?? 0),
          ratio: formatDecimal(average > 0 ? interactions / average : 0, 1),
          kinds: kindsLabel(t, item),
          day: slot ? t(`tenantOwner.content.weekday.${slot.weekday}`).toLowerCase() : '',
          from: slot?.fromHour ?? 0,
        })}
        action={
          <DisabledAction variant="outline" pill={t('report.comingSoon.value')}>
            {t(`${key}.${rule}.action`)}
          </DisabledAction>
        }
      />
    </div>
  );
}

export interface OwnerContentPostDetailViewProps {
  t: DashboardT;
  view: OwnerContentView & { postId: string };
  /** The area answer: kind averages, the heatmap's best slot and the live community names. */
  answer: OwnerContentReady;
  /** The ready answer of `GET …/content/items/{itemId}`. */
  detail: OwnerContentDetailReady;
  flags: OwnerPanelFlags;
  timeZone: string;
  /** The members at risk with push on (Membros' answer), or null when not read. */
  atRiskWithPush: number | null;
  nowMs?: number;
}

/**
 * One publication's detail (D-06, D-464) on the API answer, on the area's grid: "Voltar" to the
 * card it was opened from, the header with how it did against its kind ("1,3× a média dos
 * vídeos", or "Em andamento" under 48 hours) and its interactions across the area, the first 48
 * hours, then side by side who it reached by band and what only the app knows, the comments and
 * the recommendation; last, the video's retention or the story's taps as "Em breve" blocks.
 */
export function OwnerContentPostDetailView({
  t,
  view,
  answer,
  detail,
  flags,
  timeZone,
  atRiskWithPush,
  nowMs = Date.now(),
}: OwnerContentPostDetailViewProps) {
  const back = contentBackHref(view);
  if (back === null) throw new Error('a publication detail with no way back');
  const item = detail.item;
  const ctx: DetailCtx = {
    t,
    item,
    answer,
    detail,
    view,
    flags,
    row: { flags, communities: contentCommunityNames(answer, flags), timeZone },
    daysAgo: daysSince(item.createdAt, timeZone, nowMs),
  };
  return (
    <div className="flex min-w-0 flex-col gap-6 @4xl:contents">
      <div className={SPAN_ALL}>
        <BackLink href={back} label={t(`${KEY}.back`)} />
      </div>
      <Header {...ctx} />
      <Interactions {...ctx} />
      <Velocity {...ctx} />
      <ReachByBand {...ctx} />
      <AppKnows {...ctx} />
      <Comments {...ctx} />
      <Recommendation {...ctx} atRiskWithPush={atRiskWithPush} />
      {detail.retention ? (
        <MissingBlock t={t} title={t(`${KEY}.retention.title`)} className={SPAN_ALL} />
      ) : null}
      {detail.navigation ? (
        <MissingBlock t={t} title={t(`${KEY}.taps.title`)} className={SPAN_ALL} />
      ) : null}
    </div>
  );
}

/** The members at risk with push on, from the (cached) Membros answer; null when not readable. */
async function atRiskWithPushOf(flags: OwnerPanelFlags): Promise<number | null> {
  if (!flags.notifications) return null;
  const members = await getOwnerMembers();
  if (members.status !== 'ok' || members.answer.state !== 'ready') return null;
  return members.answer.atRiskWithPush ?? null;
}

export interface OwnerContentPostDetailProps {
  view: OwnerContentView & { postId: string };
  answer: OwnerContentReady;
  flags: OwnerPanelFlags;
  timeZone: string;
  /** The list the publication was opened from (an id the API does not know falls back to it). */
  fallback: ReactNode;
}

/**
 * The detail read from `GET /v1/dashboard/owner/content/items/{itemId}` (08.7-06), streamed in its
 * own `Suspense` by the caller (UI-D-482): an unknown, other-tenant, deleted or out-of-window id
 * (the API's bare 404) falls back to the list it came from (D-06); a failed read is the detail's
 * error card with "Tentar novamente" (UI-D-479).
 */
export async function OwnerContentPostDetail({
  view,
  answer,
  flags,
  timeZone,
  fallback,
}: OwnerContentPostDetailProps) {
  const [t, read, atRiskWithPush] = await Promise.all([
    getTranslations('dashboard'),
    getOwnerContentDetail(view.postId),
    atRiskWithPushOf(flags),
  ]);
  if (read.status === 'redirect') redirect(read.path);
  if (read.status === 'notFound') return fallback;
  if (read.status === 'error') {
    return (
      <OwnerAreaState
        kind="error"
        body="detail"
        retryHref={`${ownerContentHref(view)}#${OWNER_PANEL_ANCHOR}`}
      />
    );
  }
  if (read.answer.state === 'preparing') return <OwnerAreaState kind="preparing" scope="area" />;
  return (
    <OwnerContentPostDetailView
      t={t}
      view={view}
      answer={answer}
      detail={read.answer}
      flags={flags}
      timeZone={timeZone}
      atRiskWithPush={atRiskWithPush}
    />
  );
}
