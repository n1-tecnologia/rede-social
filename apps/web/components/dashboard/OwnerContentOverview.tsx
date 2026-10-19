import type {
  ContentHeatCell,
  ContentKindId,
  OwnerContentReady,
} from '@rede-social/module-dashboard/contracts';
import {
  ActionCard,
  BarList,
  type ChartValue,
  CountUp,
  ENGAGEMENT_BAND_ORDER,
  HEAT_BUCKETS,
  heatBucket,
  KpiCard,
  KpiGrid,
  LineChart,
  percentOf,
  perItem,
  RISE,
  SURFACE,
  topBy,
} from '@rede-social/module-dashboard/ui';
import { buttonClasses, Card, cn } from '@rede-social/ui';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Eye,
  FileText,
  Heart,
  type LucideIcon,
  MessageCircle,
  Percent,
  Radar,
  Repeat,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import {
  byInteractions,
  type ContentRowContext,
  contentCommunityNames,
  contentPostRowView,
  contentPosts,
  interactionsOf,
  kindAverage,
} from '@/lib/owner-content-rows';
import {
  CONTENT_ATTENTION_ANCHOR,
  type ContentNumber,
  contentNumberAnchor,
  contentTabView,
  needsAttention,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import { CardLink } from './CardLink';
import { CoverThumb } from './CoverThumb';
import {
  bandLabel,
  changeDelta,
  type DashboardT,
  formatCount,
  formatDecimal,
  kpiDelta,
} from './format';
import { LegendStroke } from './LegendStroke';
import { contentAgeText } from './OwnerContentPostCard';
import { OwnerListRows } from './OwnerListRows';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content.overview';

/** Half the area's width on the web: one cell of two from 56rem, two cells of four from 100rem. */
const HALF = '@min-[100rem]:col-span-2';

type Ready = OwnerContentReady;
type Kpis = NonNullable<Ready['kpis']>;

/** A card's last line, as the report's "Pico de uso": a small brand glyph and a short figure. */
function FooterLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs font-medium text-text-secondary">
      <Icon aria-hidden size={14} className="mt-px shrink-0 text-brand" />
      <span className="min-w-0">
        <CountUp value={text} />
      </span>
    </p>
  );
}

/** The KPI's change against the 30 days before, or none when there was nothing before. */
function deltaOf(t: DashboardT, pair: { current: number; previous: number }) {
  const delta = changeDelta(pair.current, pair.previous);
  return delta ? kpiDelta(t, delta) : undefined;
}

/** One block's empty sentence, inside its card (UI-D-481). */
function Empty({ id, text }: { id: string; text: string }) {
  return (
    <Card className={cn(SURFACE, RISE, 'p-4')}>
      <p data-owner-empty={id} className="text-xs font-normal text-text-secondary">
        {text}
      </p>
    </Card>
  );
}

/**
 * (1) The month's numbers against the 30 days before (D-02): the publications and the interactions,
 * each wholly a link to its list landing back on itself; the members who interacted (measured, no
 * list behind it); and "Taxa de engajamento", "Visualizações" and "Alcance por publicação" as the
 * unlinked "Em breve" tiles (D-455: no post view is recorded). Two rows of three on the web, one row
 * of six from 100rem.
 */
function Kpis({ t, kpis, answer }: { t: DashboardT; kpis: Kpis; answer: Ready }) {
  const key = `${KEY}.kpis`;
  const posts = contentPosts(answer);
  const likes = posts.reduce((sum, item) => sum + item.likes, 0);
  const comments = posts.reduce((sum, item) => sum + item.comments, 0);
  const seeList = t('tenantOwner.seeList');
  const linked: {
    number: ContentNumber;
    icon: LucideIcon;
    pair: Kpis['posts'];
    footer?: ReactNode;
  }[] = [
    { number: 'posts', icon: FileText, pair: kpis.posts },
    {
      number: 'interactions',
      icon: Sparkles,
      pair: kpis.interactions,
      footer: (
        <FooterLine
          icon={Heart}
          text={t(`${key}.interactionsNote`, {
            likes: formatCount(likes),
            comments: formatCount(comments),
          })}
        />
      ),
    },
  ];
  const missing: { label: string; icon: LucideIcon }[] = [
    { label: t(`${key}.rate`), icon: Percent },
    { label: t(`${key}.views`), icon: Eye },
    { label: t(`${key}.reach`), icon: Radar },
  ];
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      <KpiGrid className="@4xl:grid-cols-3 @min-[100rem]:grid-cols-6">
        {linked.map((card) => (
          <CardLink
            key={card.number}
            href={ownerContentHref({ ...contentTabView('overview'), number: card.number })}
            id={contentNumberAnchor(card.number)}
          >
            <KpiCard
              icon={card.icon}
              label={t(`${key}.${card.number}`)}
              value={formatCount(card.pair.current)}
              delta={deltaOf(t, card.pair)}
              footer={card.footer}
              linked={seeList}
            />
          </CardLink>
        ))}
        <KpiCard
          icon={Users}
          label={t(`${key}.members`)}
          value={formatCount(kpis.members.current)}
          delta={deltaOf(t, kpis.members)}
        />
        {missing.map((card) => (
          <KpiCard
            key={card.label}
            variant="missing"
            icon={card.icon}
            label={card.label}
            value={t('report.comingSoon.value')}
            note={t('report.comingSoon.note')}
          />
        ))}
      </KpiGrid>
    </PanelSection>
  );
}

/** The posts with a comment waiting for the team over 24 hours, the longest wait first. */
function attentionPosts(answer: Ready) {
  const wait = (item: Ready['items'][number]) =>
    'commentMeta' in item ? (item.commentMeta.oldestUnansweredHours ?? 0) : 0;
  return contentPosts(answer)
    .filter(needsAttention)
    .sort((a, b) => wait(b) - wait(a));
}

/** The comments waiting on a post (its thread meta; stories have none). */
function unansweredOf(item: Ready['items'][number]): number {
  return 'commentMeta' in item ? item.commentMeta.unanswered : 0;
}

/**
 * (3) Precisa de atenção: posts with a comment unanswered over 24 hours, the longest wait first; each
 * row (the publication's thumbnail, the count with the alert icon, the caption) opens the comments
 * waiting for the team.
 */
function Attention({ t, answer }: { t: DashboardT; answer: Ready }) {
  const rows = attentionPosts(answer);
  const key = `${KEY}.attention`;
  const replies = ownerContentHref({ ...contentTabView('overview'), replies: true });
  return (
    <PanelSection
      id={CONTENT_ATTENTION_ANCHOR}
      title={t(`${key}.title`)}
      className={cn('scroll-mt-20', HALF)}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-text-secondary">{t(`${key}.empty`)}</p>
      ) : (
        <Card className={cn(SURFACE, RISE, 'flex flex-col overflow-hidden @4xl:flex-1')}>
          <ul className="flex flex-1 flex-col divide-y divide-border">
            {rows.map((item) => (
              <li key={item.id} className="flex flex-1 flex-col">
                <a
                  href={replies}
                  className="group/link flex flex-1 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand @3xl:px-4"
                >
                  <CoverThumb
                    t={t}
                    kind={item.kind}
                    seed={item.id}
                    durationSeconds={item.durationSeconds}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                    <span className="flex items-start gap-1.5 text-sm font-bold text-text">
                      <AlertTriangle
                        aria-hidden
                        size={14}
                        className="mt-0.5 shrink-0 text-warning"
                      />
                      <CountUp
                        value={t(`${key}.row`, {
                          count: unansweredOf(item),
                          age: contentAgeText(
                            t,
                            'commentMeta' in item
                              ? (item.commentMeta.oldestUnansweredHours ?? 0)
                              : 0,
                          ),
                        })}
                      />
                    </span>
                    <span className="line-clamp-2 text-xs text-text-secondary">{item.excerpt}</span>
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    size={16}
                    className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
                  />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PanelSection>
  );
}

/** Interactions per post of each 7-day block, a block with no post a gap (UI-D-481), never 0. */
function perPost(interactions: readonly number[], posts: readonly number[]): ChartValue[] {
  return interactions.map((value, i) => {
    const count = posts[i] ?? 0;
    return count > 0 ? Math.round(value / count) : null;
  });
}

/**
 * (2) Likes + comments per post of each week and, beside it, the 12 weeks against the 12 before
 * (dashed), as the report's usage card. Computed from the raw sums (the API divides nothing); a week
 * with no post is a gap. With no post in all 24 weeks, the block's empty sentence.
 */
function Trend({ t, weekly }: { t: DashboardT; weekly: NonNullable<Ready['weeklyPerPost']> }) {
  const key = `${KEY}.trend`;
  const current = perPost(weekly.interactions, weekly.posts);
  const previous = perPost(weekly.previousInteractions, weekly.previousPosts);
  const shown = [...current, ...previous].filter((value): value is number => value !== null);
  const lastValue = [...current].reverse().find((value): value is number => value !== null);
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      {shown.length === 0 ? (
        <Empty id="trend" text={t(`${key}.empty`)} />
      ) : (
        <KpiCard
          icon={TrendingUp}
          label={t(`${key}.note`)}
          value={formatCount(lastValue ?? 0)}
          chartPlacement="side"
          chart={
            <LineChart
              series={current}
              previous={previous}
              xLabels={current.map((_, i) =>
                (i + 1) % 4 === 0 ? t('tenantOwner.weekly.week', { week: i + 1 }) : '',
              )}
              yStep={10}
              formatValue={formatCount}
              ariaLabel={t(`${key}.label`)}
              height={150}
            />
          }
          footer={
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-text-secondary">
              <li className="flex items-center gap-1.5">
                <LegendStroke dashed={false} />
                {t(`${key}.current`)}
              </li>
              <li className="flex items-center gap-1.5">
                <LegendStroke dashed />
                {t(`${key}.previous`)}
              </li>
            </ul>
          }
        />
      )}
    </PanelSection>
  );
}

/** The three posts with the most member likes + comments. */
function topThree(answer: Ready) {
  return [...contentPosts(answer)].sort(byInteractions).slice(0, 3);
}

/** (4) The three best publications as cards, each opening its detail on Visão geral. */
function Best({ t, answer, ctx }: { t: DashboardT; answer: Ready; ctx: ContentRowContext }) {
  const best = topThree(answer);
  return (
    <PanelSection title={t(`${KEY}.best.title`)} className={HALF}>
      {best.length === 0 ? (
        <Empty id="best" text={t('tenantOwner.content.list.empty')} />
      ) : (
        <OwnerListRows
          layout="posts-stack"
          rows={best.map((item) =>
            contentPostRowView(t, item, {
              ...ctx,
              href: ownerContentHref({ ...contentTabView('overview'), postId: item.id }),
            }),
          )}
        />
      )}
    </PanelSection>
  );
}

const SOLID = HEAT_BUCKETS[HEAT_BUCKETS.length - 1];

/** The cell's interactions per publication; null for a cell with no publication. */
function cellValue(cell: ContentHeatCell): number | null {
  return cell.posts > 0 ? perItem(cell.interactions, cell.posts) : null;
}

/** The best cell: the most interactions per publication among the cells with a publication. */
function bestCell(heatmap: readonly ContentHeatCell[]): ContentHeatCell | undefined {
  return topBy(
    heatmap.filter((cell) => cell.posts > 0),
    (cell) => cell.interactions / cell.posts,
  );
}

/**
 * (5) Melhor dia e horário (UI-D-488): the 7 weekdays × the four slots that cover the whole day
 * (0h–6h, 6h–12h, 12h–18h, 18h–24h). A cell with publications prints its likes + comments per
 * publication (counting up), tinted by its place between the lowest and the highest such cell
 * (PD-6), so only the best is solid; a cell with none is a blank neutral cell named "nenhuma
 * publicação" to assistive tech, never a 0 or a dash. The best slot closes the card. With no
 * publication anywhere, the block's empty sentence. A list of rows, not a table.
 */
function Heatmap({ t, heatmap }: { t: DashboardT; heatmap: readonly ContentHeatCell[] }) {
  const key = `${KEY}.heatmap`;
  const best = bestCell(heatmap);
  const first = heatmap[0];
  if (!first || !best) {
    return (
      <PanelSection title={t(`${key}.title`)} className={HALF}>
        <Empty id="heatmap" text={t(`${key}.empty`)} />
      </PanelSection>
    );
  }
  const values = heatmap.map(cellValue).filter((value): value is number => value !== null);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const slots = heatmap.filter((cell) => cell.weekday === first.weekday);
  const days = heatmap.filter((cell) => cell.fromHour === first.fromHour);
  return (
    <PanelSection title={t(`${key}.title`)} className={HALF}>
      <Card className={cn(SURFACE, RISE, 'flex flex-col gap-1 p-4')}>
        <div
          aria-hidden
          data-heat-slots
          className="grid grid-cols-[2.5rem_repeat(4,minmax(0,1fr))] gap-1 pb-1 text-center text-xs font-semibold text-text-tertiary"
        >
          <span />
          {slots.map((cell) => (
            <span key={cell.fromHour}>
              {t(`${key}.slot`, { from: cell.fromHour, to: cell.toHour })}
            </span>
          ))}
        </div>
        <ul className="flex flex-col gap-1">
          {days.map((day, row) => (
            <li
              key={day.weekday}
              className="grid grid-cols-[2.5rem_repeat(4,minmax(0,1fr))] items-center gap-1"
            >
              <span aria-hidden className="text-xs font-semibold text-text-tertiary">
                {t(`tenantOwner.content.weekdayShort.${day.weekday}`)}
              </span>
              {heatmap
                .filter((cell) => cell.weekday === day.weekday)
                .map((cell, column) => {
                  const value = cellValue(cell);
                  const name = {
                    day: t(`tenantOwner.content.weekday.${cell.weekday}`),
                    from: cell.fromHour,
                    to: cell.toHour,
                  };
                  if (value === null) {
                    return (
                      <span
                        key={cell.fromHour}
                        data-heat-cell={`${cell.weekday}-${cell.fromHour}`}
                        data-heat-empty
                        className="rounded-md bg-bg-tertiary py-2"
                      >
                        <span className="sr-only">{t(`${key}.cellEmpty`, name)}</span>
                      </span>
                    );
                  }
                  const tint = heatBucket(high > low ? percentOf(value - low, high - low) : 100);
                  return (
                    <span
                      key={cell.fromHour}
                      data-heat-cell={`${cell.weekday}-${cell.fromHour}`}
                      data-solid={tint === SOLID ? '' : undefined}
                      className={cn(
                        'dash-cell rounded-md py-2 text-center text-sm font-bold tabular-nums',
                        tint,
                      )}
                      style={{ '--i': row + column } as CSSProperties}
                    >
                      <span aria-hidden>
                        <CountUp value={formatCount(value)} />
                      </span>
                      <span className="sr-only">
                        {t(`${key}.cell`, {
                          ...name,
                          value: formatCount(value),
                          posts: cell.posts,
                        })}
                      </span>
                    </span>
                  );
                })}
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-2">
          <FooterLine
            icon={Trophy}
            text={t(`${key}.best`, {
              day: t(`tenantOwner.content.weekday.${best.weekday}`).toLowerCase(),
              from: best.fromHour,
              to: best.toHour,
              value: formatCount(perItem(best.interactions, best.posts)),
            })}
          />
        </div>
      </Card>
    </PanelSection>
  );
}

/**
 * (6) Quem interage, por faixa: today's band of the members who liked or commented in the window,
 * exact counts (UI-D-486: not floored), the bands with interactors only; absent with nobody. Counts
 * only: the people themselves are behind each publication's likes and comments, and behind the
 * interactions.
 */
function Bands({ t, bands }: { t: DashboardT; bands: NonNullable<Ready['interactorsByBand']> }) {
  const key = `${KEY}.bands`;
  const rows = ENGAGEMENT_BAND_ORDER.filter((band) => bands[band] > 0);
  const top = topBy(rows, (band) => bands[band]);
  if (rows.length === 0) return null;
  return (
    <PanelSection id="quem-interage" title={t(`${key}.title`)} className={cn('scroll-mt-20', HALF)}>
      <BarList
        className="@4xl:flex @4xl:flex-1 @4xl:flex-col @4xl:justify-center"
        rows={rows.map((band) => ({
          id: band,
          label: bandLabel(t, band),
          value: bands[band],
          display: t(`${key}.members`, { count: bands[band] }),
          highlight: band === top,
        }))}
      />
    </PanelSection>
  );
}

/** The kind with the most likes + comments per publication, among the post kinds with posts. */
function bestKind(answer: Ready): ContentKindId | undefined {
  const kinds = answer.kinds.filter(
    (kind) => kind !== 'story' && answer.items.some((item) => item.kind === kind),
  );
  return topBy(kinds, (kind) => kindAverage(answer, kind));
}

/**
 * (7) Next steps from the numbers above, side by side on the web: answer who is waiting
 * ("Responder comentários" opens the unanswered comments, D-461), publish at the best time and
 * repeat the best as a series (their actions need a new capability: disabled with the "Em breve"
 * pill, UI-D-478). A step whose numbers are absent is not drawn; with none, the block is not either.
 */
function NextSteps({ t, answer }: { t: DashboardT; answer: Ready }) {
  const key = `${KEY}.next`;
  const comingSoon = t('report.comingSoon.value');
  const late = attentionPosts(answer);
  const unanswered = late.reduce((sum, item) => sum + unansweredOf(item), 0);
  const kind = bestKind(answer);
  const slot = bestCell(answer.heatmap ?? []);
  const best = topThree(answer)[0];
  const steps: ReactNode[] = [];
  if (late.length > 0) {
    steps.push(
      <ActionCard
        key="answer"
        icon={MessageCircle}
        title={t(`${key}.answer.title`)}
        detail={t(`${key}.answer.detail`, { count: unanswered, posts: late.length })}
        action={
          <a
            href={ownerContentHref({ ...contentTabView('overview'), replies: true })}
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            {t(`${key}.answer.action`)}
          </a>
        }
      />,
    );
  }
  if (kind && slot) {
    steps.push(
      <ActionCard
        key="schedule"
        icon={CalendarClock}
        title={t(`${key}.schedule.title`)}
        detail={t(`${key}.schedule.detail`, {
          kinds: t(`tenantOwner.content.kindsThe.${kind}`),
          perPost: formatCount(kindAverage(answer, kind)),
          day: t(`tenantOwner.content.weekday.${slot.weekday}`).toLowerCase(),
          from: slot.fromHour,
          to: slot.toHour,
          best: formatCount(perItem(slot.interactions, slot.posts)),
        })}
        action={
          <DisabledAction variant="outline" pill={comingSoon}>
            {t(`${key}.schedule.action`)}
          </DisabledAction>
        }
      />,
    );
  }
  const average = best ? kindAverage(answer, best.kind) : 0;
  if (best && average > 0) {
    steps.push(
      <ActionCard
        key="series"
        icon={Repeat}
        title={t(`${key}.series.title`)}
        detail={t(`${key}.series.detail`, {
          excerpt: best.excerpt,
          count: formatCount(interactionsOf(best)),
          ratio: formatDecimal(interactionsOf(best) / average, 1),
          kinds: t(`tenantOwner.content.kindsOf.${best.kind}`),
        })}
        action={
          <DisabledAction variant="outline" pill={comingSoon}>
            {t(`${key}.series.action`)}
          </DisabledAction>
        }
      />,
    );
  }
  if (steps.length === 0) return null;
  return (
    <PanelSection title={t(`${key}.title`)} className={SPAN_ALL}>
      <div data-dash-stagger className="grid gap-3 @4xl:grid-cols-3">
        {steps}
      </div>
    </PanelSection>
  );
}

export interface OwnerContentOverviewProps {
  t: DashboardT;
  /** The ready answer of `GET /v1/dashboard/owner/content`. */
  answer: Ready;
  view: OwnerContentView;
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: the cards' dates are the tenant's. */
  timeZone: string;
}

/**
 * The Visão geral tab of Conteúdo (D-02) on the API answer, on the area's grid, in order: the month's
 * numbers and the 12-week trend across the area, then side by side Precisa de atenção and the best
 * publications, the best day and time and who interacts by band, and the next steps across the
 * area. Every block is the feed's: the API omits them with `feed` off (UI-D-473), and then nothing
 * here is drawn.
 */
export function OwnerContentOverview({ t, answer, flags, timeZone }: OwnerContentOverviewProps) {
  const ctx: ContentRowContext = {
    flags,
    communities: contentCommunityNames(answer, flags),
    timeZone,
  };
  return (
    <>
      {answer.kpis ? <Kpis t={t} kpis={answer.kpis} answer={answer} /> : null}
      {answer.weeklyPerPost ? <Trend t={t} weekly={answer.weeklyPerPost} /> : null}
      {answer.kpis ? <Attention t={t} answer={answer} /> : null}
      {answer.kpis ? <Best t={t} answer={answer} ctx={ctx} /> : null}
      {answer.heatmap ? <Heatmap t={t} heatmap={answer.heatmap} /> : null}
      {answer.interactorsByBand ? <Bands t={t} bands={answer.interactorsByBand} /> : null}
      {answer.kpis ? <NextSteps t={t} answer={answer} /> : null}
    </>
  );
}
