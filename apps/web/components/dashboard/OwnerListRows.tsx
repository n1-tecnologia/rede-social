import { CountUp, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { buttonClasses, Card, cn, Skeleton, StatusPill } from '@rede-social/ui';
import { ArrowUpRight, Heart, type LucideIcon, MessageCircle } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type {
  InteractionRowView,
  ItemRowView,
  MemberRowView,
  OwnerListRowView,
  PostRowView,
  ReplyRowView,
} from '@/lib/owner-list-view';
import { CardLink } from './CardLink';
import { ComingSoonPill } from './ComingSoon';
import { CoverThumb } from './CoverThumb';

/*
 * The rows of the owner panel's paged lists (08.7-05, UI-D-477), drawn from finished views
 * (`lib/owner-list-view.ts`): the server's first page and the "Ver todos" island's appended pages
 * render through these same components, so a page never looks different from the one before it. No
 * hooks and no translator: a server component and the client island import them alike.
 */

/**
 * How a list lays its rows: member cards across the area (`cards-wide`), in a column, or rows;
 * publication cards across the area (`posts`, two then five across) or stacked (`posts-stack`);
 * the interactions as rows in two columns on the web (`interactions`).
 */
export type OwnerListLayout =
  | 'cards-wide'
  | 'cards'
  | 'rows'
  | 'posts'
  | 'posts-stack'
  | 'interactions';

/** The list element's classes per layout (a band list two then three across, from the shipped grid). */
export const LIST_CLASS: Record<OwnerListLayout, string> = {
  'cards-wide': 'grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-3',
  cards: 'grid gap-3 @min-[100rem]:grid-cols-2',
  rows: 'divide-y divide-border',
  posts: 'grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-5',
  'posts-stack': 'grid gap-3',
  interactions:
    'grid divide-y divide-border @4xl:grid-cols-2 @4xl:gap-x-6 @4xl:divide-y-0 @4xl:px-3',
};

/** The layouts drawn as divided rows on one rising card. */
const ROW_LAYOUTS: ReadonlySet<OwnerListLayout> = new Set(['rows', 'interactions']);

/** One labeled line of the member card: the label in gray, then its value in the text color. */
function CardLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-sm">
      <dt className="inline text-text-secondary">{label}</dt>{' '}
      <dd className="inline text-text">{children}</dd>
    </div>
  );
}

/**
 * One member as a card (quick 261012-qer B-1, sized as the user drew it in quick 261012-ri4 R-1):
 * the initials on the brand color, the large name, its labeled lines (an "Em breve" value is the
 * neutral pill, D-458), and the corner arrow of the member report's linked cards (R-3). The whole
 * card links the member detail and lifts on hover. `status` adds a pill next to the name (a
 * commenter's "Sem resposta"); `id` lets a "Voltar" land on the card.
 */
export function MemberCard({
  member,
  id,
  status: given,
}: {
  member: Omit<MemberRowView, 'type' | 'id'>;
  id?: string;
  status?: ReactNode;
}) {
  const status =
    given ?? (member.status ? <StatusPill tone="warning">{member.status}</StatusPill> : null);
  return (
    <CardLink href={member.href} id={id}>
      <Card className={cn(SURFACE, RISE, LIFT, 'flex h-full items-start gap-4 p-4')}>
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-on-brand"
        >
          {member.initials}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2 [overflow-wrap:anywhere]">
          {status ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-bold leading-tight text-text">{member.name}</span>
              {status}
            </span>
          ) : (
            <span className="text-lg font-bold leading-tight text-text">{member.name}</span>
          )}
          {member.lead ? (
            <span className="text-sm font-semibold text-text">{member.lead}</span>
          ) : null}
          <dl className="flex flex-col gap-1">
            {member.lines.map((line) => (
              <CardLine key={line.label} label={line.label}>
                {line.comingSoon ? <ComingSoonPill label={line.value} /> : line.value}
              </CardLine>
            ))}
          </dl>
        </div>
        <ArrowUpRight
          aria-hidden
          size={16}
          className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
        />
      </Card>
    </CardLink>
  );
}

/** One row of a member's list: its decorative thumbnail, the title, its lines and the aside. */
export function ItemRow({ row }: { row: ItemRowView }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      {row.thumb ? <CoverThumb kind={row.thumb.kind} seed={row.thumb.seed} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <p className="text-sm font-semibold text-text">{row.title}</p>
        {row.lines.map((line) => (
          <p key={line} className="text-xs text-text-secondary">
            {line}
          </p>
        ))}
      </div>
      {row.aside ? (
        <span className="shrink-0 text-xs font-bold tabular-nums text-text">{row.aside}</span>
      ) : null}
    </div>
  );
}

/** A linked card's corner arrow, as the report's `KpiCard` draws it; `label` is read after the card. */
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

const COUNT_ICON: Record<PostRowView['counts'][number]['name'], LucideIcon> = {
  likes: Heart,
  comments: MessageCircle,
};

/**
 * One publication as a compact card (D-05, quick 261013-orf E-01) on the report's surface: the cover
 * at the feed's ratio on the left; the caption in two lines, `dd/mm · comunidade · tipo`, the
 * measured counts (counting up) and the "Em breve" compact line on the right (D-455). A linked card
 * is wholly the link to the panel's post detail (`CardLink`): it lifts on hover and its corner
 * arrow turns; its id lets the detail's "Voltar" land on it. Drawn from a finished view, so the
 * list island appends the same card.
 */
export function ContentPostCard({ row, extra }: { row: PostRowView; extra?: ReactNode }) {
  const card = (
    <Card
      className={cn(SURFACE, RISE, 'flex h-full items-start gap-3 p-3', row.href !== null && LIFT)}
    >
      <CoverThumb
        kind={row.cover.kind}
        seed={row.cover.seed}
        durationText={row.cover.duration}
        variant="card"
        ratio={row.cover.ratio}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 [overflow-wrap:anywhere]">
        <span className="line-clamp-2 text-sm font-bold leading-snug text-text">{row.excerpt}</span>
        <span className="text-xs text-text-secondary">{row.meta}</span>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold tabular-nums text-text">
          {row.counts.map((count) => {
            const Icon = COUNT_ICON[count.name];
            return (
              <span
                key={count.name}
                data-count={count.name}
                className="inline-flex items-center gap-1"
              >
                <Icon aria-hidden size={14} className="shrink-0 text-text-secondary" />
                <CountUp value={count.value} />
                <span className="sr-only"> {count.label}</span>
              </span>
            );
          })}
        </p>
        {row.comingSoon ? (
          <p data-coming-soon-line className="text-xs text-text-tertiary">
            {row.comingSoon}
          </p>
        ) : null}
        {extra}
      </div>
      {row.href === null ? null : <LinkArrow label={row.seeDetail} />}
    </Card>
  );
  return (
    <div id={row.anchor} className="grid h-full scroll-mt-20">
      {row.href === null ? card : <CardLink href={row.href}>{card}</CardLink>}
    </div>
  );
}

/** One interaction: the publication's decorative cover, who, the line and the excerpt; it opens the member. */
function InteractionRow({ row }: { row: InteractionRowView }) {
  return (
    <a
      id={row.anchor}
      href={row.href}
      className="group/link flex scroll-mt-20 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
    >
      {row.thumb ? <CoverThumb kind={row.thumb.kind} seed={row.thumb.seed} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="text-sm font-bold text-text">{row.name}</span>
        <span className="text-xs text-text-secondary">{row.line}</span>
        {row.excerpt ? <span className="line-clamp-2 text-xs text-text">{row.excerpt}</span> : null}
      </span>
      <ArrowUpRight
        aria-hidden
        size={16}
        className="shrink-0 text-text-tertiary transition-[color,transform] duration-300 ease-out group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 group-hover/link:text-brand motion-reduce:transition-none"
      />
    </a>
  );
}

/**
 * A comment waiting for the team, as a card: who wrote it and their band, the text, the publication
 * it is on, when, and "Responder", which opens the post page where the team answers (D-461).
 */
export function ReplyCard({ row }: { row: ReplyRowView }) {
  return (
    <Card className={cn(SURFACE, RISE, 'flex h-full flex-col gap-2 p-4')}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm [overflow-wrap:anywhere]">
        <span className="font-bold text-text">{row.name}</span>
        {row.band ? <span className="text-xs text-text-secondary">{row.band}</span> : null}
      </p>
      <p className="text-sm text-text [overflow-wrap:anywhere]">{row.text}</p>
      {row.post ? (
        <p className="line-clamp-2 text-xs text-text-secondary [overflow-wrap:anywhere]">
          {row.post}
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-secondary">{row.when}</span>
        <a
          href={row.replyHref}
          data-reply
          className={buttonClasses({ variant: 'outline', size: 'sm' })}
        >
          {row.replyLabel}
        </a>
      </div>
    </Card>
  );
}

/** One list item of any kind; `itemRef` marks the first appended row (focus moves to it). */
export function OwnerListItem({
  row,
  itemRef,
}: {
  row: OwnerListRowView;
  itemRef?: Ref<HTMLLIElement>;
}) {
  const focus = { ref: itemRef, tabIndex: itemRef ? -1 : undefined };
  if (row.type === 'member') {
    return (
      <li {...focus} className="grid min-w-0 outline-none">
        <MemberCard member={row} id={row.anchor} />
      </li>
    );
  }
  if (row.type === 'post') {
    return (
      <li {...focus} className="min-w-0 outline-none">
        <ContentPostCard row={row} />
      </li>
    );
  }
  if (row.type === 'interaction') {
    return (
      <li
        {...focus}
        className="outline-none @4xl:border-b @4xl:border-border @4xl:[&:nth-last-child(-n+2)]:border-b-0"
      >
        <InteractionRow row={row} />
      </li>
    );
  }
  if (row.type === 'reply') {
    return (
      <li {...focus} className="min-w-0 outline-none">
        <ReplyCard row={row} />
      </li>
    );
  }
  return (
    <li ref={itemRef} tabIndex={itemRef ? -1 : undefined} className="outline-none">
      <ItemRow row={row} />
    </li>
  );
}

/**
 * A list of finished rows in its layout. Item rows sit on the panels' rising surface (one card,
 * divided rows); member cards are cards of their own and rise one after the other.
 */
export function OwnerListRows({
  rows,
  layout,
  firstRef,
}: {
  rows: readonly OwnerListRowView[];
  layout: OwnerListLayout;
  /** The ref of the first row (the island's first appended row). */
  firstRef?: Ref<HTMLLIElement>;
}) {
  const divided = ROW_LAYOUTS.has(layout);
  const list = (
    <ul data-dash-stagger={divided ? undefined : ''} className={LIST_CLASS[layout]}>
      {rows.map((row, index) => (
        <OwnerListItem key={row.id} row={row} itemRef={index === 0 ? firstRef : undefined} />
      ))}
    </ul>
  );
  return divided ? <Card className={cn(SURFACE, RISE, 'overflow-hidden')}>{list}</Card> : list;
}

/** The one-row skeleton while a next page is in flight (UI-D-477), `aria-busy`. */
export function OwnerListRowSkeleton({ layout }: { layout: OwnerListLayout }) {
  return (
    <div aria-busy data-owner-list-skeleton className="pt-3">
      <Skeleton
        variant="rect"
        className={ROW_LAYOUTS.has(layout) ? 'h-14 rounded-2xl' : 'h-32 rounded-2xl'}
      />
    </div>
  );
}
