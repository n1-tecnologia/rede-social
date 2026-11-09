import { ProgressSkeleton } from '../../cursos/MemberProgressTab';
import { ScreenHeaderSkeleton } from '../../cursos/ScreenHeader';

/**
 * `/area-membros/progresso/loading.tsx` (2026-10-22): the Progresso screen's placeholder, the header
 * and the body's own skeleton, at the screen's final geometry. No words. 2026-10-23: wide
 * (`data-shell-full`), as the screen is, so the shell's column does not jump.
 */
export default function MemberProgressLoading() {
  return (
    <div aria-busy data-shell-full className="flex w-full flex-col">
      <ScreenHeaderSkeleton />
      <ProgressSkeleton />
    </div>
  );
}
