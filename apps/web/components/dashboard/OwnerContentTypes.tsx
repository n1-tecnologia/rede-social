import {
  CONTENT_KIND_ORDER,
  type ContentItem,
  type ContentKind,
  ownerContentItems,
  ownerContentKindMetric,
} from '@rede-social/module-dashboard/fixtures';
import {
  CountUp,
  KpiCard,
  KpiGrid,
  LIFT,
  percentOf,
  perItem,
  RISE,
  SURFACE,
  sumOf,
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
  contentBackHref,
  contentKindAnchor,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import { COVER_ICON } from './CoverThumb';
import { type DashboardT, formatCount, formatPercent } from './format';
import { ContentPostList, contentKindLabel, LinkArrow } from './OwnerContentPostCard';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content';

export function interactionsOf(item: ContentItem): number {
  return item.likes + item.comments;
}

/** Best first: more likes + comments, then the newer, then the id (a stable, value-led order). */
export function byInteractions(a: ContentItem, b: ContentItem): number {
  return (
    interactionsOf(b) - interactionsOf(a) ||
    b.date.localeCompare(a.date) ||
    a.id.localeCompare(b.id)
  );
}

export function itemsOfKind(kind: ContentKind): ContentItem[] {
  return ownerContentItems.filter((item) => item.kind === kind);
}

/** Likes + comments per publication of a kind (the "média dos vídeos" of the detail). */
export function kindAverage(kind: ContentKind): number {
  const items = itemsOfKind(kind);
  return perItem(sumOf(items, interactionsOf), items.length);
}

/** The glyph of each kind's own metric. */
const METRIC_ICON: Record<ContentKind, LucideIcon> = {
  video: Eye,
  photo: Bookmark,
  carousel: Layers,
  text: MessageCircle,
  link: ExternalLink,
  story: ChevronsRight,
};

/**
 * Each kind's own metric (D-03): the fixture's values for video, carousel, link and story; a photo's
 * saves per post and a text's share of comments, both computed from the items.
 */
function kindMetric(kind: ContentKind): string {
  const items = itemsOfKind(kind);
  switch (kind) {
    case 'photo':
      return formatCount(
        perItem(
          sumOf(items, (item) => item.saves?.value ?? 0),
          items.length,
        ),
      );
    case 'text':
      return formatPercent(
        percentOf(
          sumOf(items, (item) => item.comments),
          sumOf(items, interactionsOf),
        ),
      );
    default:
      return formatPercent(ownerContentKindMetric[kind].value);
  }
}

/** One of a kind card's three numbers: the small label over the value, which counts up. */
function KindCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-0.5">
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="text-lg font-extrabold tabular-nums tracking-tight text-text [overflow-wrap:normal]">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

/**
 * One kind as a card (D-03) on the report's surface: the kind's glyph with its name beside it, then
 * how many publications, likes + comments per publication and its own metric. The whole card opens
 * that kind's publications (`CardLink`): it lifts on hover and its corner arrow turns.
 */
function KindCard({ t, kind, href }: { t: DashboardT; kind: ContentKind; href: string }) {
  const Icon = COVER_ICON[kind];
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
              value={formatCount(itemsOfKind(kind).length)}
            />
            <KindCell label={t(`${KEY}.types.perPost`)} value={formatCount(kindAverage(kind))} />
            <KindCell label={t(`${KEY}.types.metric.${kind}`)} value={kindMetric(kind)} />
          </dl>
        </Card>
      </CardLink>
    </div>
  );
}

/**
 * An opened kind's three numbers as the report's cards: how many publications, likes + comments per
 * publication and the kind's own metric, side by side.
 */
function KindNumbers({ t, kind }: { t: DashboardT; kind: ContentKind }) {
  return (
    <PanelSection as="h4" title={contentKindLabel(t, kind)}>
      <KpiGrid className="@4xl:grid-cols-3">
        <KpiCard
          icon={FileText}
          label={t(`${KEY}.types.posts`)}
          value={formatCount(itemsOfKind(kind).length)}
        />
        <KpiCard
          icon={Heart}
          label={t(`${KEY}.types.perPost`)}
          value={formatCount(kindAverage(kind))}
        />
        <KpiCard
          icon={METRIC_ICON[kind]}
          label={t(`${KEY}.types.metric.${kind}`)}
          value={kindMetric(kind)}
        />
      </KpiGrid>
    </PanelSection>
  );
}

/**
 * The Por tipo tab (D-03): the six kinds as cards in CONTENT_KIND_ORDER, across the whole area (two
 * columns from 56rem, three from 100rem). A card opens that kind in place: "Voltar aos tipos", the
 * kind's three numbers as cards and its publications best first, each opening its detail. Reels are
 * videos (PD-1); stories are a kind only here.
 */
export function OwnerContentTypes({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const { kind } = view;
  if (kind) {
    const back = contentBackHref(view);
    if (back === null) throw new Error('an opened type has no way back');
    return (
      <PanelSection title={t(`${KEY}.types.title`)} className={SPAN_ALL}>
        <BackLink href={back} label={t(`${KEY}.types.back`)} />
        <div className="flex flex-col gap-6">
          <KindNumbers t={t} kind={kind} />
          <PanelSection as="h4" title={t(`${KEY}.types.postsOf`)}>
            <ContentPostList
              t={t}
              items={[...itemsOfKind(kind)].sort(byInteractions)}
              hrefOf={(item) => ownerContentHref({ ...view, postId: item.id })}
            />
          </PanelSection>
        </div>
      </PanelSection>
    );
  }
  return (
    <PanelSection title={t(`${KEY}.types.title`)} className={SPAN_ALL}>
      <ul data-dash-stagger className="grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-3">
        {CONTENT_KIND_ORDER.map((row) => (
          <li key={row} className="min-w-0">
            <KindCard t={t} kind={row} href={ownerContentHref({ ...view, kind: row })} />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
