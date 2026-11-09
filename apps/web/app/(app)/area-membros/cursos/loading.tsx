import { CoursesBodySkeleton } from '../../cursos/MemberCatalogue';

/**
 * `/area-membros/cursos/loading.tsx` (2026-10-22): the Cursos screen's placeholder, the header and
 * the body's own skeleton (the chips and four posters), at the screen's final geometry. No words.
 * 2026-10-23: wide (`data-shell-full`), as the screen is, so the shell's column does not jump.
 */
export default function MemberCoursesLoading() {
  return (
    <div aria-busy data-shell-full className="flex w-full flex-col">
      <CoursesBodySkeleton />
    </div>
  );
}
