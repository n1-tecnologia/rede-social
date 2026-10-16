import { formatBrl } from '@rede-social/contracts/money';
import {
  type ContentDetail,
  type ContentItem,
  type ContentWho,
  daysSince,
  ownerContent,
  ownerContentDetail,
  ownerContentItem,
  ownerContentKindRetention,
  ownerContentKindVelocity,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import {
  ActionCard,
  BarList,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  isBelowPrivacyFloor,
  KpiCard,
  KpiGrid,
  LIFT,
  LineChart,
  PRIVACY_FLOOR,
  percentOf,
  RISE,
  SURFACE,
  sumOf,
  topBy,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  AlertTriangle,
  Bookmark,
  CalendarCheck2,
  CheckCheck,
  ChevronsRight,
  Clock,
  Crown,
  Eye,
  Flag,
  Heart,
  Lightbulb,
  LogOut,
  type LucideIcon,
  MessageCircle,
  Send,
  ShoppingBag,
  Undo2,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  contentBackHref,
  contentRecommendation,
  contentWhoAnchor,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { BackLink } from './BackLink';
import { ownerEvent } from './BandScopeCards';
import { CardLink } from './CardLink';
import {
  bandLabel,
  type DashboardT,
  formatClock,
  formatCount,
  formatDayMonth,
  formatDecimal,
  formatHoursMinutes,
  formatPercent,
} from './format';
import { LegendStroke } from './LegendStroke';
import { ContentCover, contentAgeText, contentMeta, LinkArrow } from './OwnerContentPostCard';
import { interactionsOf, kindAverage } from './OwnerContentTypes';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content.detail';

/** Half the area's width on the web: one cell of two from 56rem, two cells of four from 100rem. */
const HALF = '@min-[100rem]:col-span-2';

/** Under 48 hours a publication is still collecting: no comparison yet (D-06). */
const COMPARABLE_AFTER_DAYS = 2;

export function isInProgress(item: ContentItem): boolean {
  return daysSince(item.date) < COMPARABLE_AFTER_DAYS;
}

/** "dos vídeos", "das fotos": the kind with its article, for "a média …". */
function kindsLabel(t: DashboardT, item: ContentItem): string {
  return t(`tenantOwner.content.kindsOf.${item.kind}`);
}

/**
 * The detail's header (D-06), across the area: the cover (on the web at the left, capped lower), the
 * whole caption, the meta, how many interactions (counting up) and, in a chip, how it did against
 * its kind.
 */
function Header({ t, item }: { t: DashboardT; item: ContentItem }) {
  const interactions = interactionsOf(item);
  const average = kindAverage(item.kind);
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
        <p className="text-xs text-text-secondary">{contentMeta(t, item)}</p>
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
            {isInProgress(item) || average === 0
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

const WHO_ICON: Record<ContentWho, LucideIcon> = {
  likes: Heart,
  comments: MessageCircle,
  saves: Bookmark,
  shares: Send,
};

/**
 * Interações (D-06, P1): likes, comments, saves and shares as the report's cards, each wholly a link
 * to the members who did it (landing back on itself). A story cannot be saved.
 */
function Interactions({
  t,
  item,
  view,
}: {
  t: DashboardT;
  item: ContentItem;
  view: OwnerContentView;
}) {
  const rows: { who: ContentWho; value: number }[] = [
    { who: 'likes', value: item.likes },
    { who: 'comments', value: item.comments },
    ...(item.saves === null ? [] : [{ who: 'saves' as const, value: item.saves.value }]),
    { who: 'shares', value: item.shares.value },
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
      </KpiGrid>
    </PanelSection>
  );
}

/** A chart's two series, by the line's own stroke, compact for a card's footer. */
function Legend({ current, previous }: { current: string; previous: string }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-text-secondary">
      <li className="flex items-center gap-1.5">
        <LegendStroke dashed={false} />
        {current}
      </li>
      <li className="flex items-center gap-1.5">
        <LegendStroke dashed />
        {previous}
      </li>
    </ul>
  );
}

/**
 * Primeiras 48 horas: the interactions at 48 hours and, beside them, how they came in against the
 * kind's average (dashed), as the report's usage card; nothing while they are not over yet.
 */
function Velocity({
  t,
  item,
  detail,
}: {
  t: DashboardT;
  item: ContentItem;
  detail: ContentDetail;
}) {
  const key = `${KEY}.velocity`;
  const curve = detail.velocity48h;
  // Still in its first 48 hours: nothing to draw yet (the header already says "Em andamento").
  if (isInProgress(item)) return null;
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
            previous={ownerContentKindVelocity(item.kind)}
            xLabels={curve.map((_, i) =>
              i % 2 === 1 ? t(`${key}.hour`, { hours: (i + 1) * 6 }) : '',
            )}
            yStep={10}
            formatValue={formatCount}
            ariaLabel={t(`${key}.label`)}
            height={150}
          />
        }
        footer={
          <Legend
            current={t(`${key}.current`)}
            previous={t(`${key}.average`, { kinds: kindsLabel(t, item) })}
          />
        }
      />
    </PanelSection>
  );
}

/**
 * Quem a publicação alcançou, por faixa: totals per today's band and their share of the reach (the
 * largest in the full brand), never a link to anyone (P3).
 */
function ReachByBand({
  t,
  item,
  detail,
}: {
  t: DashboardT;
  item: ContentItem;
  detail: ContentDetail;
}) {
  const key = `${KEY}.reach`;
  const { reachByBand } = detail;
  const top = topBy(ENGAGEMENT_BAND_ORDER, (band) => reachByBand.value[band]);
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={HALF}>
      <BarList
        className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
        max={item.reach.value}
        rows={ENGAGEMENT_BAND_ORDER.map((band) => {
          const count = reachByBand.value[band];
          return {
            id: band,
            label: bandLabel(t, band),
            value: count,
            display: formatCount(count),
            rate: formatPercent(percentOf(count, item.reach.value)),
            highlight: band === top,
          };
        })}
      />
    </PanelSection>
  );
}

/**
 * O que só o app sabe (D-06), as the report's cards: members back after 30+ idle days, event RSVPs
 * within 7 days (each event in the card's footer), sales within 7 days (a value only from 5 orders
 * on, P2 / PD-10) and the VIP subscriptions while it was the shop window.
 */
function AppKnows({ t, detail }: { t: DashboardT; detail: ContentDetail }) {
  const key = `${KEY}.app`;
  const { orders, rsvps } = detail;
  const rsvpTotal = sumOf(rsvps, (row) => row.members);
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={HALF}>
      <KpiGrid className="@4xl:flex-1 @4xl:grid-cols-2">
        <KpiCard
          icon={UserCheck}
          label={t(`${key}.reactivated`)}
          value={formatCount(detail.reactivated)}
        />
        <KpiCard
          icon={CalendarCheck2}
          label={t(`${key}.rsvps`)}
          value={rsvps.length === 0 ? t(`${key}.noRsvps`) : formatCount(rsvpTotal)}
          footer={
            rsvps.length === 0 ? undefined : (
              <ul className="flex flex-col gap-0.5 text-xs font-medium text-text-secondary">
                {rsvps.map((row) => {
                  const event = ownerEvent(row.eventId);
                  return (
                    <li key={row.eventId}>
                      {t(`${key}.rsvp`, {
                        name: event.name,
                        date: formatDayMonth(event.date),
                        count: row.members,
                      })}
                    </li>
                  );
                })}
              </ul>
            )
          }
        />
        <KpiCard
          icon={ShoppingBag}
          label={t(`${key}.sales`)}
          value={
            isBelowPrivacyFloor(orders.count)
              ? t(`${key}.salesFloor`, { floor: PRIVACY_FLOOR })
              : t(`${key}.salesValue`, { count: orders.count, value: formatBrl(orders.cents) })
          }
        />
        {detail.vitrine ? (
          <KpiCard
            icon={Crown}
            label={t(`${key}.vitrine`)}
            value={formatCount(detail.vitrine.subscriptions)}
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
 * Comentários (D-06), one card with its name beside its glyph: how many the team answered, the median
 * first reply and how long the oldest unanswered waits. The whole card opens who commented (unanswered
 * first). Never a comment's text.
 */
function Comments({ t, item, view }: { t: DashboardT; item: ContentItem; view: OwnerContentView }) {
  const key = `${KEY}.comments`;
  const { answered, oldestUnansweredHours, firstReplyMedianMinutes } = item.commentMeta;
  const unanswered = item.comments - answered;
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
          <CommentLine icon={CheckCheck} tone="strong">
            {t(`${key}.answered`, {
              answered: formatCount(answered),
              comments: formatCount(item.comments),
              percent: formatPercent(percentOf(answered, item.comments)),
            })}
          </CommentLine>
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

/** Recomendação: the deterministic rule's advice with this publication's numbers. */
function Recommendation({ t, item }: { t: DashboardT; item: ContentItem }) {
  const key = `${KEY}.recommendation`;
  const interactions = interactionsOf(item);
  const average = kindAverage(item.kind);
  const rule = contentRecommendation({
    kind: item.kind,
    interactions,
    kindAverage: average,
    daysAgo: daysSince(item.date),
    durationSeconds: item.durationSeconds,
  });
  const slot = topBy(ownerContent.heatmap, (cell) => cell.interactions / cell.posts);
  if (!slot) throw new Error('an empty heatmap');
  return (
    <div className={cn('grid', HALF)}>
      <ActionCard
        icon={Lightbulb}
        title={t(`${key}.title`)}
        detail={t(`${key}.${rule}.detail`, {
          interactions: formatCount(interactions),
          withPush: formatCount(tenantOwnerPanel.atRiskWithPush),
          ratio: formatDecimal(average > 0 ? interactions / average : 0, 1),
          kinds: kindsLabel(t, item),
          day: t(`tenantOwner.content.weekday.${slot.weekday}`).toLowerCase(),
          from: slot.fromHour,
        })}
        action={<DisabledAction variant="outline">{t(`${key}.${rule}.action`)}</DisabledAction>}
      />
    </div>
  );
}

/**
 * Retenção do vídeo (videos only), as the report's usage card: the average % watched with, beside it,
 * the % still watching at each tenth against the videos' (dashed); the axis reads the video's own
 * time at its start, middle and end (0:00 · 0:20 · 0:41, E-03.5). How many reached the end closes
 * the numbers.
 */
function Retention({
  t,
  item,
  detail,
}: {
  t: DashboardT;
  item: ContentItem;
  detail: ContentDetail;
}) {
  const { retention } = detail;
  if (!retention) return null;
  const key = `${KEY}.retention`;
  const curve = retention.value;
  const duration = item.durationSeconds ?? 0;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiCard
        icon={Eye}
        label={t(`${key}.watched`)}
        value={formatPercent(sumOf(curve, (value) => value) / Math.max(1, curve.length))}
        chartPlacement="side"
        chart={
          <LineChart
            series={curve}
            previous={ownerContentKindRetention()}
            xLabels={curve.map((_, i) =>
              i % 5 === 0 ? formatClock(t, Math.floor((duration * i) / (curve.length - 1))) : '',
            )}
            yStep={20}
            formatValue={formatPercent}
            ariaLabel={t(`${key}.label`)}
            height={150}
          />
        }
        footer={
          <div className="flex flex-col gap-2">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-text-secondary">
              <Flag aria-hidden size={14} className="shrink-0 text-brand" />
              <span>{t(`${key}.completion`)}</span>
              <span className="font-bold tabular-nums text-text">
                <CountUp value={formatPercent(curve.at(-1) ?? 0)} />
              </span>
            </p>
            <Legend current={t(`${key}.current`)} previous={t(`${key}.average`)} />
          </div>
        }
      />
    </PanelSection>
  );
}

/** Toques no story (stories only): who tapped forward, back or out, as the report's cards. */
function Taps({ t, detail }: { t: DashboardT; detail: ContentDetail }) {
  const { navigation } = detail;
  if (!navigation) return null;
  const key = `${KEY}.taps`;
  return (
    <PanelSection as="h4" title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3">
        <KpiCard
          icon={ChevronsRight}
          label={t(`${key}.forward`)}
          value={formatPercent(navigation.value.forward)}
        />
        <KpiCard
          icon={Undo2}
          label={t(`${key}.back`)}
          value={formatPercent(navigation.value.back)}
        />
        <KpiCard
          icon={LogOut}
          label={t(`${key}.exit`)}
          value={formatPercent(navigation.value.exit)}
        />
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * One publication's detail (D-06), opened from a card, on the area's grid: "Voltar" to that card in
 * the list it came from, the header with how it did against its kind ("1,3× a média dos vídeos", or
 * "Em andamento" under 48 hours) and its interactions (each opening who did it) across the area, the
 * first 48 hours as the report's usage card, then side by side who it reached by band (totals only)
 * and what only the app knows, the comments and the recommendation; last, the video's retention or
 * the story's taps.
 */
export function OwnerContentPostDetail({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const back = contentBackHref(view);
  // The parser only lets a publication of the opened list through: a gap here is a bug.
  if (!view.postId || back === null) throw new Error('a publication detail with no publication');
  const item = ownerContentItem(view.postId);
  const detail = ownerContentDetail(item.id);
  return (
    <div className="flex min-w-0 flex-col gap-6 @4xl:contents">
      <div className={SPAN_ALL}>
        <BackLink href={back} label={t(`${KEY}.back`)} />
      </div>
      <Header t={t} item={item} />
      <Interactions t={t} item={item} view={view} />
      <Velocity t={t} item={item} detail={detail} />
      <ReachByBand t={t} item={item} detail={detail} />
      <AppKnows t={t} detail={detail} />
      <Comments t={t} item={item} view={view} />
      <Recommendation t={t} item={item} />
      <Retention t={t} item={item} detail={detail} />
      <Taps t={t} detail={detail} />
    </div>
  );
}
