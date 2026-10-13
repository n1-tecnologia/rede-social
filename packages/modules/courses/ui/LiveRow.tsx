import type { ReactNode } from 'react';
import { ListRow, type ListRowPill } from './ListRow';

/**
 * The live row of the hub's Lives tab (UI-D-392, plan 11): the 16:10 thumb (`w-16`), the title, the
 * meta "{weekday} {day} {month}, {time} · {duration} min" (tenant timezone, formatted on the server)
 * and the derived status pill (Agendada / Ao vivo / Gravada / Cancelada, D-416). It links to the
 * live's edit form. Built props-only now so plan 11 composes it without touching the module's UI
 * surface again.
 */
export type LiveRowPill = ListRowPill;

export interface LiveRowProps {
  href: string;
  ariaLabel: string;
  title: string;
  meta: string;
  pills?: readonly LiveRowPill[];
  thumb?: ReactNode;
}

export function LiveRow({ href, ariaLabel, title, meta, pills, thumb }: LiveRowProps) {
  return (
    <ListRow
      href={href}
      ariaLabel={ariaLabel}
      title={title}
      meta={meta}
      pills={pills}
      thumb={thumb}
      thumbShape="wide"
      testId="live-row"
    />
  );
}
