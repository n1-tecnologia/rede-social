import type { ReactNode } from 'react';
import { ListRow, type ListRowPill } from './ListRow';

/**
 * The course row of the hub's Cursos tab (UI-D-392): the 3:4 poster thumb (`w-10`, the prototype's
 * catalogue crop at 40px), the title, the meta "{N} módulos · {N} aulas · {duration}" and the pills
 * — the status (Rascunho / Publicado / Arquivado) and, on a draft whose videos are not all ready,
 * the second `warning` "Processando". It links to the course page. Every word is a prop (PWA-03).
 */
export type CourseRowPill = ListRowPill;

export interface CourseRowProps {
  href: string;
  ariaLabel: string;
  title: string;
  meta: string;
  pills?: readonly CourseRowPill[];
  thumb?: ReactNode;
}

export function CourseRow({ href, ariaLabel, title, meta, pills, thumb }: CourseRowProps) {
  return (
    <ListRow
      href={href}
      ariaLabel={ariaLabel}
      title={title}
      meta={meta}
      pills={pills}
      thumb={thumb}
      thumbShape="poster"
      testId="course-row"
    />
  );
}
