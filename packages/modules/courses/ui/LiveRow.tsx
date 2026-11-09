import type { ReactNode } from 'react';
import { ListRow, type ListRowPill } from './ListRow';

/**
 * The live row of the admin's Lives list (UI-D-392, plan 11): the 16:10 thumb, the title, the meta
 * "{weekday} {day} {month}, {time} · {duration} min" (tenant timezone, formatted on the server) and
 * the derived status pill (Agendada / Ao vivo / Gravada / Cancelada, D-416). It links to the live's
 * edit form.
 *
 * 2026-10-22 (the courses area redesign): a row of the outlined list card, the thumb at 80px and the
 * pill under the meta (`ListRow`).
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
