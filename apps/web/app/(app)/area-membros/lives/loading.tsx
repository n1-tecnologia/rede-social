import { LivesSkeleton } from '../../cursos/MemberLivesTab';
import { ScreenHeaderSkeleton } from '../../cursos/ScreenHeader';

/**
 * `/area-membros/lives/loading.tsx` (2026-10-22): the Lives screen's placeholder, the header and the
 * body's own skeleton, at the screen's final geometry. No words. 2026-10-23: "Próximas"'s
 * geometry (`LivesSkeleton`) and wide (`data-shell-full`), as the screen is.
 */
export default function MemberLivesLoading() {
  return (
    <div aria-busy data-shell-full className="flex w-full flex-col">
      <ScreenHeaderSkeleton />
      <LivesSkeleton />
    </div>
  );
}
