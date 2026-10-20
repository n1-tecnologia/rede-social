import type { ReactNode } from 'react';

/**
 * One cell of the counts row: the number already formatted by the host (`Intl.NumberFormat`, compact
 * from 10 000), its already-translated label, and, only on the member's OWN profile, a destination
 * and the full spoken phrase.
 */
export interface FollowCountCell {
  value: string;
  label: string;
  href?: string;
  ariaLabel?: string;
}

export interface FollowCountsProps {
  followers: FollowCountCell;
  following: FollowCountCell;
}

const CELL = 'flex flex-col items-center gap-1';

function Cell({ cell }: { cell: FollowCountCell }): ReactNode {
  const content = (
    <>
      <span className="text-base font-bold tabular-nums text-text">{cell.value}</span>
      <span className="text-xs font-normal text-text-tertiary">{cell.label}</span>
    </>
  );

  // Counts are public and lists are private (D-468): a cell is a link only when the host gives it a
  // destination, which it does for the member's own profile and never for anyone else's.
  if (cell.href === undefined) return <div className={CELL}>{content}</div>;

  return (
    <a
      href={cell.href}
      aria-label={cell.ariaLabel}
      className={`${CELL} min-h-11 justify-center rounded-lg transition-opacity active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
    >
      {content}
    </a>
  );
}

/**
 * The counts row (09-10, UI-D-501), ported from the prototype's `ProfileStats.tsx` minus the
 * "Publicações" cell: there is no profile feed (D-471). Props only (MOD-02): the number comes BEFORE
 * the label in the DOM so a screen reader says "12 Seguidores", and `tabular-nums` keeps the numerals
 * from jittering when a follow changes the count.
 *
 * The prototype's `text-lg` and `gap-0.5` are normalised onto the standard scale (16/700 numerals,
 * `gap-1`), this block being new.
 */
export function FollowCounts({ followers, following }: FollowCountsProps) {
  return (
    <div className="grid grid-cols-2 border-y border-border py-4">
      <Cell cell={followers} />
      <Cell cell={following} />
    </div>
  );
}
