import type { ReactNode } from 'react';
import { CoverCard } from './CoverCard';
import type { ListRowPill } from './ListRow';

/**
 * The track row of the admin's Trilhas list (UI-D-392, plan 10): the title, the meta "{N} cursos"
 * (published ones only, D-415) and the "Arquivada" pill only when archived. It links to the track's
 * edit form.
 *
 * 2026-10-22 (the courses area redesign): the row is a COVER CARD now, the social-igoralves
 * "Todas as trilhas" card: the 16:10 cover with the title and the meta over its foot and the pill as
 * a glass chip at the top (`CoverCard`). Same props and test ids (`track-row`, `-thumb`, `-fallback`,
 * `-title`, `-meta`, `-pill`), so the host only changes the list around it (a gap, not hairlines).
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
    <CoverCard
      href={href}
      ariaLabel={ariaLabel}
      title={title}
      meta={meta}
      chips={pills}
      thumb={thumb}
      testId="track-row"
    />
  );
}
