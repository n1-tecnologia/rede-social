import { RowSkeleton } from '@rede-social/module-courses/ui';
import { Skeleton } from '@rede-social/ui';
import type { AdminScreen } from '@/lib/member-area';
import { AdminLiveCardSkeletons } from './AdminLiveCards';
import { LIST_CARD_GRID, LIST_GRID_ITEM, UPCOMING_LIVES_GRID } from './admin-styles';

const ROWS = [0, 1, 2, 3, 4, 5];
const COVERS = [0, 1, 2];

/**
 * 2026-10-22 — the admin list screens' body placeholders, at the bodies' final geometry so nothing
 * shifts when the rows land (UI-D-401): the header and the filter chips are drawn by the screen
 * OUTSIDE the `Suspense`, so only the body waits. Cursos: six 48px rows in the list card (the
 * "Categorias" card left for "Gerenciar" on 2026-10-23); Trilhas: three 16:10 cover cards. Wordless
 * and hidden from the tree.
 *
 * 2026-10-23: Lives wait as the showcase they become (`AdminLiveCards`): under "Próximas" the
 * spotlight's 16:10 card (2:1 from `md`) and two agenda rows, under "Passadas" (`pastLives`) the
 * grid of tiles.
 *
 * 2026-10-23 (the wide desktop lists): every placeholder takes its list's wide geometry. The rows
 * break into the cards grid from `lg` (`LIST_CARD_GRID`), the track covers sit two per row from
 * 640px and three from `xl`, and the upcoming lives put the spotlight and the agenda side by side
 * from `lg` (`UPCOMING_LIVES_GRID`).
 */
export function AdminListSkeleton({
  screen,
  pastLives = false,
}: {
  screen: AdminScreen;
  pastLives?: boolean;
}) {
  if (screen === 'trilhas') {
    return (
      <div
        aria-busy
        data-testid="admin-list-skeleton"
        className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        {COVERS.map((index) => (
          <RowSkeleton key={index} variant="cover" />
        ))}
      </div>
    );
  }
  if (screen === 'lives') {
    return pastLives ? (
      <div aria-busy data-testid="admin-list-skeleton" className="flex flex-col px-4">
        <AdminLiveCardSkeletons variant="tile" count={ROWS.length} />
      </div>
    ) : (
      <div aria-busy data-testid="admin-list-skeleton" className={`${UPCOMING_LIVES_GRID} px-4`}>
        <Skeleton
          variant="rect"
          className="mb-2 aspect-[16/10] h-auto w-full rounded-2xl md:aspect-[2/1] lg:mb-0"
        />
        <AdminLiveCardSkeletons variant="agenda" count={2} />
      </div>
    );
  }
  return (
    <div aria-busy data-testid="admin-list-skeleton" className="flex flex-col gap-3 px-4">
      <AdminRowsSkeleton variant="poster" count={ROWS.length} />
    </div>
  );
}

/**
 * `count` row placeholders (the first page, or "carregar mais"): inside the outlined list card on a
 * phone, one outlined card each in the grid from `lg` (2026-10-23).
 */
export function AdminRowsSkeleton({
  variant,
  count = 3,
}: {
  variant: 'poster' | 'wide';
  count?: number;
}) {
  return (
    <div aria-hidden className={LIST_CARD_GRID}>
      {ROWS.slice(0, count).map((index) => (
        <div key={index} className={LIST_GRID_ITEM}>
          <RowSkeleton variant={variant} />
        </div>
      ))}
    </div>
  );
}
