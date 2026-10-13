import type { ReactNode } from 'react';
import { ListRow, type ListRowPill } from './ListRow';

/**
 * The track row of the hub's Trilhas tab (UI-D-392, plan 10): the 16:10 thumb (`w-16`), the title,
 * the meta "{N} cursos" (published ones only, D-415) and the "Arquivada" pill only when archived. It
 * links to the track's edit form. Built props-only now so plan 10 composes it without touching the
 * module's UI surface again.
 */
export type TrackRowPill = ListRowPill;

export interface TrackRowProps {
  href: string;
  ariaLabel: string;
  title: string;
  meta: string;
  pills?: readonly TrackRowPill[];
  thumb?: ReactNode;
}

export function TrackRow({ href, ariaLabel, title, meta, pills, thumb }: TrackRowProps) {
  return (
    <ListRow
      href={href}
      ariaLabel={ariaLabel}
      title={title}
      meta={meta}
      pills={pills}
      thumb={thumb}
      thumbShape="wide"
      testId="track-row"
    />
  );
}
