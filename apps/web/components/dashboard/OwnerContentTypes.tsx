import type { ContentKindId, OwnerContentReady } from '@rede-social/module-dashboard/contracts';
import {
  CountUp,
  KpiCard,
  KpiGrid,
  LIFT,
  percentOf,
  RISE,
  SURFACE,
} from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  Bookmark,
  ChevronsRight,
  ExternalLink,
  Eye,
  FileText,
  Heart,
  Layers,
  type LucideIcon,
  MessageCircle,
} from 'lucide-react';
import {
  type ContentRowContext,
  contentCommunityNames,
  contentKindLabel,
  itemsOfKind,
  kindAverage,
} from '@/lib/owner-content-rows';
import {
  contentBackHref,
  contentKindAnchor,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import type { OwnerPanelFlags } from '@/lib/owner-panel';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import { ComingSoonPill } from './ComingSoon';
import { COVER_ICON } from './CoverThumb';
import { type DashboardT, formatCount, formatPercent } from './format';
import { ContentPostList, LinkArrow } from './OwnerContentPostCard';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content';

/** The glyph of each kind's own metric. */
const METRIC_ICON: Record<ContentKindId, LucideIcon> = {
  video: Eye,
  photo: Bookmark,
  carousel: Layers,
  text: MessageCircle,
  link: ExternalLink,
  story: ChevronsRight,
};

/**
 * A kind's own metric (D-03, D-458): only a text's share of comments is measured (computed from its
 * items: comments over likes + comments); every other kind's ("% assistido", "Salvamentos por
 * publicação", "Até o último cartão", "Abriram a página externa", "Avançaram") is "Em breve": null.
 */
function kindMetric(answer: OwnerContentReady, kind: ContentKindId): string | null {
  if (kind !== 'text') return null;
  const totals = answer.byKind.find((row) => row.kind === 'text');
  if (!totals || totals.likes + totals.comments === 0) return formatPercent(0);
  return formatPercent(percentOf(totals.comments, totals.likes + totals.comments));
}

/** How many publications of a kind (the API's totals, zeros for an empty kind). */
function kindCount(answer: OwnerContentReady, kind: ContentKindId): number {
  return answer.byKind.find((row) => row.kind === kind)?.items ?? itemsOfKind(answer, kind).length;
}

/** One of a kind card's three numbers: the small label over the value (or the "Em breve" pill). */
function KindCell({
  label,
  value,
  comingSoon,
}: {
  label: string;
  value: string | null;
  comingSoon: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-0.5">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-lg font-extrabold tabular-nums tracking-tight text-text [overflow-wrap:normal]">
        {value === null ? <ComingSoonPill label={comingSoon} /> : <CountUp value={value} />}
      </dd>
    </div>
  );
}

/**
 * One kind as a card (D-03) on the report's surface: the kind's glyph with its name beside it, then
 * how many publications, likes + comments per publication and its own metric (the line pill when it
 * is not measured, D-458). The whole card opens that kind's publications (`CardLink`).
 */
function KindCard({
  t,
  answer,
  kind,
  href,
}: {
  t: DashboardT;
  answer: OwnerContentReady;
  kind: ContentKindId;
  href: string;
}) {
  const Icon = COVER_ICON[kind];
  const comingSoon = t('report.comingSoon.value');
  return (
    <div id={contentKindAnchor(kind)} className="grid h-full scroll-mt-20">
      <CardLink href={href}>
        <Card
          className={cn(
            SURFACE,
            RISE,
            LIFT,
            'flex h-full flex-col gap-3 p-3 [overflow-wrap:anywhere] @3xl:p-4',
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors duration-300 group-hover/link:bg-brand group-hover/link:text-on-brand motion-reduce:transition-none"
            >
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-bold leading-snug text-text">
              {contentKindLabel(t, kind)}
            </span>
            <LinkArrow label={t('tenantOwner.seeList')} />
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <KindCell
              label={t(`${KEY}.types.posts`)}
              value={formatCount(kindCount(answer, kind))}
              comingSoon={comingSoon}
            />
            <KindCell
              label={t(`${KEY}.types.perPost`)}
              value={formatCount(kindAverage(answer, kind))}
              comingSoon={comingSoon}
            />
            <KindCell
              label={t(`${KEY}.types.metric.${kind}`)}
              value={kindMetric(answer, kind)}
              comingSoon={comingSoon}
            />
          </dl>
        </Card>
      </CardLink>
    </div>
  );
}

/**
 * An opened kind's three numbers as the report's cards: how many publications, likes + comments per
 * publication and the kind's own metric (an "Em breve" tile when it is not measured, D-455).
 */
function KindNumbers({
  t,
  answer,
  kind,
}: {
  t: DashboardT;
  answer: OwnerContentReady;
  kind: ContentKindId;
}) {
  const metric = kindMetric(answer, kind);
  return (
    <PanelSection as="h4" title={contentKindLabel(t, kind)}>
      <KpiGrid className="@4xl:grid-cols-3">
        <KpiCard
          icon={FileText}
          label={t(`${KEY}.types.posts`)}
          value={formatCount(kindCount(answer, kind))}
        />
        <KpiCard
          icon={Heart}
          label={t(`${KEY}.types.perPost`)}
          value={formatCount(kindAverage(answer, kind))}
        />
        {metric === null ? (
          <KpiCard
            variant="missing"
            icon={METRIC_ICON[kind]}
            label={t(`${KEY}.types.metric.${kind}`)}
            value={t('report.comingSoon.value')}
            note={t('report.comingSoon.note')}
          />
        ) : (
          <KpiCard
            icon={METRIC_ICON[kind]}
            label={t(`${KEY}.types.metric.${kind}`)}
            value={metric}
          />
        )}
      </KpiGrid>
    </PanelSection>
  );
}

export interface OwnerContentTypesProps {
  t: DashboardT;
  answer: OwnerContentReady;
  view: OwnerContentView;
  flags: OwnerPanelFlags;
  /** `bootstrap.tenant.timezone`: a card's date is the tenant's. */
  timeZone: string;
}

/**
 * The Por tipo tab (D-03) on the API answer: one card per kind the answer shows (UI-D-473: with
 * `feed` off only Story, with `stories` off no Story), across the whole area (two columns from
 * 56rem, three from 100rem). A card opens that kind in place: "Voltar aos tipos", the kind's three
 * numbers and its publications best first, each opening its detail. Reels are videos (PD-1).
 */
export function OwnerContentTypes({ t, answer, view, flags, timeZone }: OwnerContentTypesProps) {
  const rowCtx: ContentRowContext = {
    flags,
    communities: contentCommunityNames(answer, flags),
    timeZone,
  };
  const { kind } = view;
  if (kind && answer.kinds.includes(kind)) {
    const back = contentBackHref(view);
    if (back === null) throw new Error('an opened type has no way back');
    return (
      <PanelSection title={t(`${KEY}.types.title`)} className={SPAN_ALL}>
        <BackLink href={back} label={t(`${KEY}.types.back`)} />
        <div className="flex flex-col gap-6">
          <KindNumbers t={t} answer={answer} kind={kind} />
          <PanelSection as="h4" title={t(`${KEY}.types.postsOf`)}>
            <ContentPostList t={t} answer={answer} list="kind" contentKind={kind} ctx={rowCtx} />
          </PanelSection>
        </div>
      </PanelSection>
    );
  }
  return (
    <PanelSection title={t(`${KEY}.types.title`)} className={SPAN_ALL}>
      <ul data-dash-stagger className="grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-3">
        {answer.kinds.map((row) => (
          <li key={row} className="min-w-0">
            <KindCard
              t={t}
              answer={answer}
              kind={row}
              href={ownerContentHref({ ...view, kind: row })}
            />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
