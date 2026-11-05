'use client';

import { usePathname } from 'next/navigation';
import { ScreenHeaderSkeleton } from './ScreenHeader';

/** The admin's three management lists: wide pages since 2026-10-23 (`AdminListScreen`). */
const WIDE_LISTS = new Set(['/cursos', '/cursos/trilhas', '/cursos/lives']);

/**
 * `/cursos/loading.tsx` (08.5-06, UI-D-424, E02 loading): ROLE-NEUTRAL — the frame every page of the
 * segment shares, so this file never guesses who is loading. Each body draws its own skeleton inside
 * its own `Suspense` fallback (the admin lists' rows in `AdminListScreen`). No words: the skeleton
 * says nothing about the page it waits for.
 *
 * 2026-10-22 (one page per screen): the header's bars only (`ScreenHeaderSkeleton`, the h1 and the
 * supporting line). The tabs row is gone with the tabs; the three admin lists (`/cursos`,
 * `/cursos/trilhas`, `/cursos/lives`) are pages of this segment and have no `loading.tsx` of their
 * own, so this frame is theirs too.
 *
 * 2026-10-23 (the wide desktop lists): those three lists are WIDE pages (`data-shell-wide`) with the
 * "‹ Gerenciar" row and the header's controls, so on their exact paths the frame takes the same
 * width and rows (a client component only to read the path). Every other route of the segment (the
 * forms, the detail pages) keeps the 680px frame it had: nothing changes for them.
 */
export default function CoursesLoading() {
  const wide = WIDE_LISTS.has(usePathname());
  if (wide) {
    return (
      <div aria-busy data-shell-wide className="mx-auto flex w-full flex-col">
        <ScreenHeaderSkeleton withBack withAction />
      </div>
    );
  }
  return (
    <div aria-busy className="mx-auto flex w-full max-w-[680px] flex-col">
      <ScreenHeaderSkeleton />
    </div>
  );
}
