import {
  type ContentItem,
  OWNER_BAND_LIST_LIMIT,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { CountUp, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import {
  ArrowUpRight,
  Bookmark,
  Heart,
  type LucideIcon,
  MessageCircle,
  Play,
  Send,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { contentCoverRatio, contentPostAnchor } from '@/lib/owner-content-view';
import { CardLink } from './CardLink';
import { COVER_ICON, CoverThumb, coverStyle } from './CoverThumb';
import {
  communityLabel,
  type DashboardT,
  formatClock,
  formatCount,
  formatDayMonth,
} from './format';
import { DisabledAction } from './PanelSection';

const KEY = 'tenantOwner.content';

/** How long a comment has waited: "18 h" under two days, else whole days ("2 dias"). */
export function contentAgeText(t: DashboardT, hours: number): string {
  return hours < 48
    ? t(`${KEY}.overview.age.hours`, { count: hours })
    : t(`${KEY}.overview.age.days`, { count: Math.floor(hours / 24) });
}

/** The kind's name ("Vídeo"). */
export function contentKindLabel(t: DashboardT, kind: ContentItem['kind']): string {
  return t(`${KEY}.kinds.${kind}`);
}

/** `08/10 · Geral · Vídeo`, or `09/10 · Story` (a story has no community). */
export function contentMeta(t: DashboardT, item: ContentItem): string {
  const date = formatDayMonth(item.date);
  const kind = contentKindLabel(t, item.kind);
  if (item.communityId === null) return t(`${KEY}.card.metaStory`, { date, kind });
  const community = tenantOwnerPanel.byCommunity.find((row) => row.id === item.communityId);
  if (!community) throw new Error(`no community ${item.communityId}`);
  return t(`${KEY}.card.meta`, { date, community: communityLabel(t, community), kind });
}

/**
 * A linked card's corner arrow, as the report's `KpiCard` draws it: it turns brand and nudges when
 * the card (inside a `CardLink`) is hovered; `label` ("Ver detalhes") is read after the content.
 */
export function LinkArrow({ label }: { label: string }) {
  return (
    <>
      <ArrowUpRight
        aria-hidden
        size={16}
        className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
      />
      <span className="sr-only">{label}</span>
    </>
  );
}

/**
 * The publication's media at the ratio the feed draws it (PD-2, `contentCoverRatio`), on the detail:
 * no photo in the sample, so the `--brand-gradient` fallback with the kind's icon (and a video's
 * length), at the publication's tone (`coverStyle`, shared with the list thumbnails). Its height is
 * capped by narrowing it, never by changing the ratio, so a 9:16 video does not fill a whole phone
 * screen; the sides are the same gradient darkened, never a grey band (quick 261013-orf E-01). A
 * video or story plays from the round ▶, disabled like every sample action. A text post has none.
 * A host may lower the cap on wider screens through `--cover-h` (a length), else `maxHeightRem`.
 */
export function ContentCover({
  t,
  item,
  maxHeightRem = 20,
  className,
}: {
  t: DashboardT;
  item: ContentItem;
  maxHeightRem?: number;
  /** Extra classes for the outer frame (its height and alignment in a host's layout). */
  className?: string;
}) {
  const ratio = contentCoverRatio(item);
  if (ratio === null) return null;
  const Icon = COVER_ICON[item.kind];
  const playable = item.kind === 'video' || item.kind === 'story';
  const width: CSSProperties = {
    aspectRatio: ratio,
    width: `min(100%, calc(var(--cover-h, ${maxHeightRem}rem) * ${ratio.toFixed(4)}))`,
  };
  return (
    <div
      className={cn('relative flex justify-center overflow-hidden', className)}
      style={coverStyle(item.id)}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" />
      <div
        data-testid="content-cover"
        data-ratio={ratio.toFixed(4)}
        className="relative flex items-center justify-center"
        style={{ ...width, ...coverStyle(item.id) }}
      >
        {playable ? (
          <button
            type="button"
            disabled
            aria-label={t(`${KEY}.detail.watch`)}
            className="flex size-16 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Play aria-hidden size={32} />
          </button>
        ) : (
          <Icon aria-hidden size={32} className="opacity-90" />
        )}
        {item.durationSeconds !== null ? (
          <span className="absolute right-2 bottom-2 rounded-md bg-black/50 px-1.5 py-0.5 text-xs font-bold tabular-nums text-white">
            {formatClock(t, item.durationSeconds)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** One of the compact card's numbers: its icon, the value (counting up) and, for screen readers, its name. */
function Count({
  t,
  icon: Icon,
  name,
  value,
}: {
  t: DashboardT;
  icon: LucideIcon;
  name: 'likes' | 'comments' | 'saves' | 'shares';
  value: number;
}) {
  return (
    <span data-count={name} className="inline-flex items-center gap-1">
      <Icon aria-hidden size={14} className="shrink-0 text-text-secondary" />
      <CountUp value={formatCount(value)} />
      <span className="sr-only"> {t(`${KEY}.card.compact.${name}`, { count: value })}</span>
    </span>
  );
}

/**
 * One publication as a compact card (D-05, quick 261013-orf E-01) on the report's surface: the cover
 * thumbnail at the feed's ratio on the left and, on the right, the caption in two lines,
 * `dd/mm · comunidade · tipo` and the four numbers in one line (a story cannot be saved, the numbers
 * count up), then an optional line. A linked card is wholly the link to the detail (`CardLink`): it
 * lifts on hover and its corner arrow turns; its id lets the detail's "Voltar" land on it.
 */
export function ContentPostCard({
  t,
  item,
  href,
  extra,
}: {
  t: DashboardT;
  item: ContentItem;
  /** The detail's link; null = not a link. */
  href: string | null;
  /** A last line under the numbers (a KPI list's metric). */
  extra?: ReactNode;
}) {
  const card = (
    <Card className={cn(SURFACE, RISE, 'flex h-full items-start gap-3 p-3', href !== null && LIFT)}>
      <CoverThumb
        t={t}
        kind={item.kind}
        seed={item.id}
        durationSeconds={item.durationSeconds}
        variant="card"
        ratio={contentCoverRatio(item)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 [overflow-wrap:anywhere]">
        <span className="line-clamp-2 text-sm font-bold leading-snug text-text">
          {item.excerpt}
        </span>
        <span className="text-xs text-text-secondary">{contentMeta(t, item)}</span>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold tabular-nums text-text">
          <Count t={t} icon={Heart} name="likes" value={item.likes} />
          <Count t={t} icon={MessageCircle} name="comments" value={item.comments} />
          {item.saves === null ? null : (
            <Count t={t} icon={Bookmark} name="saves" value={item.saves.value} />
          )}
          <Count t={t} icon={Send} name="shares" value={item.shares.value} />
        </p>
        {extra}
      </div>
      {href === null ? null : <LinkArrow label={t('tenantOwner.seeDetail')} />}
    </Card>
  );
  return (
    <div id={contentPostAnchor(item.id)} className="grid h-full scroll-mt-20">
      {href === null ? card : <CardLink href={href}>{card}</CardLink>}
    </div>
  );
}

/**
 * A list of publication cards (D-04): the first OWNER_BAND_LIST_LIMIT cards in the given order, then
 * how many more with a disabled "Ver todas" (the Membros pattern), or one sentence when there are
 * none. The cards rise one after the other; `wide` lays them across the whole area (two columns from
 * a 56rem container, five from 100rem), else they stack.
 */
export function ContentPostList({
  t,
  items,
  hrefOf,
  extraOf,
  wide = true,
}: {
  t: DashboardT;
  items: readonly ContentItem[];
  hrefOf: (item: ContentItem) => string;
  extraOf?: (item: ContentItem) => ReactNode;
  /** No longer shown (the sample values are untagged); kept for its callers. */
  exampleNote?: string;
  /** The list spans the whole area (columns on the web); false stacks the cards. */
  wide?: boolean;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-text-secondary">{t(`${KEY}.list.empty`)}</p>;
  }
  const shown = items.slice(0, OWNER_BAND_LIST_LIMIT);
  const more = items.length - shown.length;
  return (
    <>
      <ul
        data-dash-stagger
        className={cn('grid gap-3', wide && '@4xl:grid-cols-2 @min-[100rem]:grid-cols-5')}
      >
        {shown.map((item) => (
          <li key={item.id} className="min-w-0">
            <ContentPostCard t={t} item={item} href={hrefOf(item)} extra={extraOf?.(item)} />
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-secondary">{t(`${KEY}.list.more`, { count: more })}</p>
          <DisabledAction>{t(`${KEY}.list.seeAll`)}</DisabledAction>
        </div>
      ) : null}
    </>
  );
}
