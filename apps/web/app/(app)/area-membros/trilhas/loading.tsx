import { TracksSkeleton } from '../../cursos/MemberTracksTab';

/**
 * `/area-membros/trilhas/loading.tsx` (2026-10-22): the Trilhas screen's placeholder, the header and
 * the body's own skeleton, at the screen's final geometry. No words. 2026-10-23: wide
 * (`data-shell-full`), as the screen is, so the shell's column does not jump. 2026-10-26: the
 * screen draws its own header (the list's, or a track's hero), so its skeleton holds the header's.
 */
export default function MemberTracksLoading() {
  return (
    <div aria-busy data-shell-full className="flex w-full flex-col">
      <TracksSkeleton />
    </div>
  );
}
