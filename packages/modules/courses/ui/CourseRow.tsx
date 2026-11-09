import type { ReactNode } from 'react';
import { ListRow, type ListRowPill } from './ListRow';

/**
 * The course row of the admin's Cursos list (UI-D-392): the 3:4 poster thumb (the catalogue crop),
 * the title, the meta "{N} módulos · {N} aulas · {duration}" and the pills — the status (Rascunho /
 * Publicado / Arquivado) and, on a draft whose videos are not all ready, the second `warning`
 * "Processando". It links to the course page. Every word is a prop (PWA-03).
 *
 * 2026-10-22 (the courses area redesign): a row of the outlined list card, the thumb at 48px and the
 * pills under the meta (`ListRow`).
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
