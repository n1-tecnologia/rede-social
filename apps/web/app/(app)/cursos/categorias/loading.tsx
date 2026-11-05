import { AdminRowsSkeleton } from '../AdminListSkeletons';
import { ScreenHeaderSkeleton } from '../ScreenHeader';

/**
 * `/cursos/categorias/loading.tsx` (UI-D-401, E11 loading): the header, then 6 row skeletons at the
 * list's final geometry. No words.
 *
 * 2026-10-22 (the courses area redesign): the rows wait inside the outlined list card, the 48px
 * thumbs of the list they stand for. 2026-10-23: the header is the management lists' one (the
 * "‹ Gerenciar" row, the h1 and its supporting line, the create control); a wide page like the
 * manager it stands for (`data-shell-wide`), the rows in the cards grid from `lg`.
 */
export default function CategoriesLoading() {
  return (
    <div aria-busy data-shell-wide className="mx-auto flex w-full flex-col">
      <ScreenHeaderSkeleton withBack withAction />
      <div className="px-4 pt-2">
        <AdminRowsSkeleton variant="poster" count={6} />
      </div>
    </div>
  );
}
