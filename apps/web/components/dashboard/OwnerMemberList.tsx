import { formatBrl } from '@rede-social/contracts/money';
import {
  type OwnerMemberInsights,
  type OwnerPost,
  ownerContentItem,
  ownerMemberInsights,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import { OWNER_MEMBER_LIST_ANCHOR, type OwnerMemberListSlug } from '@/lib/owner-band-scope';
import { BackLink } from './BackLink';
import { ownerCommunity, ownerEvent } from './BandScopeCards';
import { CoverThumb, type CoverThumbProps } from './CoverThumb';
import {
  communityLabel,
  type DashboardT,
  formatDayMonth,
  formatMinutesSeconds,
  momentText,
} from './format';
import { SPAN_ALL } from './ownerGrid';
import { PanelSection } from './PanelSection';

interface ListRow {
  id: string;
  /** The publication's (or event's, or product's) decorative thumbnail; none for an active day. */
  thumb?: CoverThumbProps;
  title: string;
  lines: string[];
  /** A short value on the right ("3 ações", "visto 2× · 40 s"). */
  aside?: string;
}

interface ListView {
  title: string;
  /** The count line, with the order the rows follow. */
  count: string;
  empty: string;
  rows: ListRow[];
}

type Lists = OwnerMemberInsights['lists'];

function communityName(t: DashboardT, id: string): string {
  return communityLabel(t, ownerCommunity(id));
}

function productName(id: string): string {
  const product = tenantOwnerPanel.store.products.find((row) => row.id === id);
  if (!product) throw new Error(`no product ${id}`);
  return product.product;
}

const KEY = 'tenantOwner.memberLists';

/** A post's thumbnail: its Conteúdo item's kind and length, toned by its id (D-01, D-03). */
function postThumb(post: OwnerPost): CoverThumbProps {
  const item = ownerContentItem(post.id);
  return { kind: item.kind, seed: item.id, durationSeconds: item.durationSeconds };
}

/** Every list slug has its view: a slug added to OWNER_MEMBER_LISTS without one fails typecheck. */
const VIEWS: Record<OwnerMemberListSlug, (t: DashboardT, lists: Lists) => ListView> = {
  'dias-ativos': (t, { activeDays }) => ({
    title: t(`${KEY}.activeDays.title`),
    count: t(`${KEY}.activeDays.count`, { count: activeDays.length }),
    empty: t(`${KEY}.activeDays.empty`),
    rows: activeDays.map((day) => ({
      id: `day-${day.when.daysAgo}`,
      title: momentText(t, day.when),
      lines: [],
      aside: t(`${KEY}.activeDays.actions`, { count: day.actions }),
    })),
  }),
  curtidas: (t, { likes }) => ({
    title: t(`${KEY}.likes.title`),
    count: t(`${KEY}.likes.count`, { count: likes.length }),
    empty: t(`${KEY}.likes.empty`),
    rows: likes.map((like) => ({
      id: like.post.id,
      thumb: postThumb(like.post),
      title: like.post.excerpt,
      lines: [
        t(`${KEY}.likes.line`, {
          community: communityName(t, like.post.communityId),
          when: momentText(t, like.when),
        }),
      ],
    })),
  }),
  comentarios: (t, { comments }) => ({
    title: t(`${KEY}.comments.title`),
    count: t(`${KEY}.comments.count`, { count: comments.length }),
    empty: t(`${KEY}.comments.empty`),
    rows: comments.map((comment) => ({
      id: comment.post.id,
      thumb: postThumb(comment.post),
      title: comment.post.excerpt,
      lines: [
        t(`${KEY}.comments.line`, {
          community: communityName(t, comment.post.communityId),
          when: momentText(t, comment.when),
        }),
      ],
    })),
  }),
  'acoes-fortes': (t, { strongActions }) => ({
    title: t(`${KEY}.strongActions.title`),
    count: t(`${KEY}.strongActions.count`, { count: strongActions.length }),
    empty: t(`${KEY}.strongActions.empty`),
    rows: strongActions.map((action) => {
      const when = momentText(t, action.when);
      if (action.kind === 'comment') {
        return {
          id: `comment-${action.post.id}`,
          thumb: postThumb(action.post),
          title: action.post.excerpt,
          lines: [
            t(`${KEY}.strongActions.comment`, {
              community: communityName(t, action.post.communityId),
              when,
            }),
          ],
        };
      }
      if (action.kind === 'check_in') {
        const event = ownerEvent(action.eventId);
        return {
          id: `check-in-${action.eventId}`,
          thumb: { kind: 'event', seed: action.eventId },
          title: t('tenantOwner.bandScope.event', {
            name: event.name,
            date: formatDayMonth(event.date),
          }),
          lines: [t(`${KEY}.strongActions.checkIn`, { when })],
        };
      }
      return {
        id: `order-${action.productId}`,
        thumb: { kind: 'order', seed: action.productId },
        title: productName(action.productId),
        lines: [t(`${KEY}.strongActions.order`, { value: formatBrl(action.cents), when })],
      };
    }),
  }),
  'posts-vistos': (t, { postsSeen }) => ({
    title: t(`${KEY}.postsSeen.title`),
    count: t(`${KEY}.postsSeen.count`, {
      posts: postsSeen.value.length,
      views: postsSeen.value.reduce((total, row) => total + row.views, 0),
    }),
    empty: t(`${KEY}.postsSeen.empty`),
    rows: postsSeen.value.map((row) => ({
      id: row.post.id,
      thumb: postThumb(row.post),
      title: row.post.excerpt,
      lines: [
        t(`${KEY}.postsSeen.line`, {
          community: communityName(t, row.post.communityId),
          when: momentText(t, row.lastSeen),
        }),
      ],
      aside: t(`${KEY}.postsSeen.times`, {
        count: row.views,
        time: formatMinutesSeconds(t, row.seconds),
      }),
    })),
  }),
};

export interface OwnerMemberListProps {
  t: DashboardT;
  /** A roster member the opening cascade's parser let through. */
  memberId: string;
  list: OwnerMemberListSlug;
  /** "Voltar": the insights, landing on the number that opened the list. */
  backHref: string;
}

/**
 * The list behind one of a member's insight numbers (quick 261012-tru D-07), drawn as the member
 * report's lists (quick 261012-hqr), from Membros, Conteúdo (quick 261013-h51) or Financeiro:
 * "Voltar" to the number that opened it, the title, the member and the window, the count with the
 * order of the rows, then the rows on the panels' surface, or one sentence when there are none. It
 * reads across the whole area grid.
 * Its count is the number on the insights card by construction. Visible to the client's management
 * only: which posts a member liked, commented on and saw, never a comment's text. A publication,
 * check-in or order row starts with its decorative thumbnail (quick 261013-orf D-01); a day has none.
 */
export function OwnerMemberList({ t, memberId, list: slug, backHref }: OwnerMemberListProps) {
  // Each opening parser only sets a list together with a member it let through: a gap is a bug.
  const insights = ownerMemberInsights(memberId);
  if (!insights) throw new Error(`no list ${slug} for member ${memberId}`);
  const list = VIEWS[slug](t, insights.lists);

  return (
    <div
      id={OWNER_MEMBER_LIST_ANCHOR}
      className={cn('flex min-w-0 scroll-mt-20 flex-col gap-3', SPAN_ALL)}
    >
      <BackLink href={backHref} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection
        title={list.title}
        period={t(`${KEY}.period`, { name: insights.name })}
        prominent
      >
        <p className="text-sm text-text-secondary">{list.count}</p>
        {list.rows.length === 0 ? (
          <p className="text-sm text-text-secondary">{list.empty}</p>
        ) : (
          <Card className={cn(SURFACE, RISE)}>
            <ul className="divide-y divide-border">
              {list.rows.map((row) => (
                <li key={row.id} className="flex items-start gap-3 px-3 py-2.5">
                  {row.thumb ? <CoverThumb t={t} {...row.thumb} /> : null}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
                    <p className="text-sm font-semibold text-text">{row.title}</p>
                    {row.lines.map((line) => (
                      <p key={line} className="text-xs text-text-secondary">
                        {line}
                      </p>
                    ))}
                  </div>
                  {row.aside ? (
                    <span className="shrink-0 text-xs font-bold tabular-nums text-text">
                      {row.aside}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PanelSection>
    </div>
  );
}
