import { HomeSkeleton } from '../cursos/MemberHomeTab';

/**
 * `/area-membros/loading.tsx`: the Início's placeholder. Since 2026-10-22 this path is the Início
 * only (each other screen has its own page and its own `loading.tsx`), so it draws the Início's
 * frame (the column, the header's top space) and the body's own skeleton, with no jump when the
 * overview lands. No words. 2026-10-23: wide (`data-shell-full`), as the screen is, so the shell's
 * column does not jump from 680px to 1280px when the page lands.
 */
export default function MemberAreaLoading() {
  return (
    <div aria-busy data-shell-full className="flex w-full flex-col pt-4">
      <HomeSkeleton />
    </div>
  );
}
