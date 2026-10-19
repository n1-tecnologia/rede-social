import type {
  ContentItemAnswer,
  ContentKindId,
  OwnerContentReady,
} from '@rede-social/module-dashboard/contracts';
import { cn } from '@rede-social/ui';
import { Play } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  CONTENT_FIRST_PAGE,
  type ContentRowContext,
  contentPostList,
  contentPostRowView,
} from '@/lib/owner-content-rows';
import { contentCoverRatio } from '@/lib/owner-content-view';
import type { ContentPostListId } from '@/lib/owner-list-view';
import { COVER_ICON, coverStyle } from './CoverThumb';
import { type DashboardT, formatClock } from './format';
import { OwnerListMore } from './OwnerListMore';
import { type OwnerListLayout, OwnerListRows } from './OwnerListRows';

export { ContentPostCard, LinkArrow } from './OwnerListRows';

const KEY = 'tenantOwner.content';

/** How long a comment has waited: "18 h" under two days, else whole days ("2 dias"). */
export function contentAgeText(t: DashboardT, hours: number): string {
  return hours < 48
    ? t(`${KEY}.overview.age.hours`, { count: hours })
    : t(`${KEY}.overview.age.days`, { count: Math.floor(hours / 24) });
}

/** The post page a publication plays on (D-461): `/post/[postId]`. */
export function contentPostPageHref(postId: string): string {
  return `/post/${postId}`;
}

/**
 * The publication's media at the ratio the feed draws it (PD-2, `contentCoverRatio`), on the detail:
 * the `--brand-gradient` cover with the kind's icon (and a video's length), at the publication's
 * tone (`coverStyle`, shared with the list thumbnails). Its height is capped by narrowing it, never
 * by changing the ratio, so a 9:16 video does not fill a whole phone screen; the sides are the same
 * gradient darkened (quick 261013-orf E-01). A video's round ▶ ("Assistir") opens the post page
 * (D-461); a story's stays disabled with no pill: an expired story has no viewer. A text post has
 * none. A host may lower the cap on wider screens through `--cover-h` (a length), else `maxHeightRem`.
 */
export function ContentCover({
  t,
  item,
  maxHeightRem = 20,
  className,
}: {
  t: DashboardT;
  item: Pick<ContentItemAnswer, 'id' | 'kind' | 'media' | 'durationSeconds'>;
  maxHeightRem?: number;
  /** Extra classes for the outer frame (its height and alignment in a host's layout). */
  className?: string;
}) {
  const ratio = contentCoverRatio(item);
  if (ratio === null) return null;
  const Icon = COVER_ICON[item.kind];
  const width: CSSProperties = {
    aspectRatio: ratio,
    width: `min(100%, calc(var(--cover-h, ${maxHeightRem}rem) * ${ratio.toFixed(4)}))`,
  };
  const round = 'flex size-16 items-center justify-center rounded-full bg-black/40 text-white';
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
        {item.kind === 'video' ? (
          <a
            href={contentPostPageHref(item.id)}
            aria-label={t(`${KEY}.detail.watch`)}
            data-play
            className={cn(
              round,
              'transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
            )}
          >
            <Play aria-hidden size={32} />
          </a>
        ) : item.kind === 'story' ? (
          <button type="button" disabled aria-label={t(`${KEY}.detail.watch`)} className={round}>
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

/**
 * A list of publication cards (D-04, UI-D-477): the first CONTENT_FIRST_PAGE cards of `list` in its
 * order, then how many more with an enabled "Ver todas" that continues the list in place (the
 * Membros island, pages of 20), or one sentence when there are none. The cards rise one after the
 * other; `layout` lays them across the whole area (`posts`) or stacks them (`posts-stack`).
 */
export function ContentPostList({
  t,
  answer,
  list,
  contentKind = null,
  ctx,
  layout = 'posts',
}: {
  t: DashboardT;
  answer: OwnerContentReady;
  list: ContentPostListId;
  contentKind?: ContentKindId | null;
  ctx: ContentRowContext;
  layout?: Extract<OwnerListLayout, 'posts' | 'posts-stack'>;
}) {
  const { items, hrefOf } = contentPostList(answer, list, contentKind);
  if (items.length === 0) {
    return (
      <p data-owner-empty="posts" className="text-xs font-normal text-text-secondary">
        {t(`${KEY}.list.empty`)}
      </p>
    );
  }
  const shown = items.slice(0, CONTENT_FIRST_PAGE);
  const more = items.length - shown.length;
  return (
    <>
      <OwnerListRows
        layout={layout}
        rows={shown.map((item) => contentPostRowView(t, item, { ...ctx, href: hrefOf(item.id) }))}
      />
      {more > 0 ? (
        <OwnerListMore
          request={{ kind: 'content-posts', list, contentKind }}
          cursor={String(CONTENT_FIRST_PAGE)}
          layout={layout}
          more={t(`${KEY}.list.more`, { count: more })}
          labels={{
            seeAll: t(`${KEY}.list.seeAll`),
            error: t('report.errors.more'),
            retry: t('report.errors.retry'),
          }}
        />
      ) : null}
    </>
  );
}
