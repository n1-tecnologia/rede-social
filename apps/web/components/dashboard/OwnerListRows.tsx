import { LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn, Skeleton } from '@rede-social/ui';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import type { ItemRowView, MemberRowView, OwnerListRowView } from '@/lib/owner-list-view';
import { CardLink } from './CardLink';
import { ComingSoonPill } from './ComingSoon';
import { CoverThumb } from './CoverThumb';

/*
 * The rows of the owner panel's paged lists (08.7-05, UI-D-477), drawn from finished views
 * (`lib/owner-list-view.ts`): the server's first page and the "Ver todos" island's appended pages
 * render through these same components, so a page never looks different from the one before it. No
 * hooks and no translator: a server component and the client island import them alike.
 */

/** How a list lays its rows: member cards across the area (`cards-wide`), in a column, or rows. */
export type OwnerListLayout = 'cards-wide' | 'cards' | 'rows';

/** The list element's classes per layout (a band list two then three across, from the shipped grid). */
export const LIST_CLASS: Record<OwnerListLayout, string> = {
  'cards-wide': 'grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-3',
  cards: 'grid gap-3 @min-[100rem]:grid-cols-2',
  rows: 'divide-y divide-border',
};

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
  status,
}: {
  member: Omit<MemberRowView, 'type' | 'id'>;
  id?: string;
  status?: ReactNode;
}) {
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

/** One list item of either kind; `itemRef` marks the first appended row (focus moves to it). */
export function OwnerListItem({
  row,
  itemRef,
}: {
  row: OwnerListRowView;
  itemRef?: Ref<HTMLLIElement>;
}) {
  if (row.type === 'member') {
    return (
      <li ref={itemRef} tabIndex={itemRef ? -1 : undefined} className="grid min-w-0 outline-none">
        <MemberCard member={row} />
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
  const list = (
    <ul data-dash-stagger={layout === 'rows' ? undefined : ''} className={LIST_CLASS[layout]}>
      {rows.map((row, index) => (
        <OwnerListItem key={row.id} row={row} itemRef={index === 0 ? firstRef : undefined} />
      ))}
    </ul>
  );
  return layout === 'rows' ? <Card className={cn(SURFACE, RISE)}>{list}</Card> : list;
}

/** The one-row skeleton while a next page is in flight (UI-D-477), `aria-busy`. */
export function OwnerListRowSkeleton({ layout }: { layout: OwnerListLayout }) {
  return (
    <div aria-busy data-owner-list-skeleton className="pt-3">
      <Skeleton
        variant="rect"
        className={layout === 'rows' ? 'h-14 rounded-2xl' : 'h-32 rounded-2xl'}
      />
    </div>
  );
}
