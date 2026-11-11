import { FeedCardSkeleton } from '@rede-social/module-feed/ui';
import { StoriesStrip } from '@rede-social/module-stories/ui';

const CARDS = [0, 1, 2];

/**
 * Explorar's first load (UI-D-511, E02 loading): three `FeedCardSkeleton`s, the geometry of the
 * feed's own first paint, under the chip row (which renders at once, outside the `Suspense` this
 * fills). `aria-busy`, no words: the skeleton says nothing about the page it waits for. The
 * sentinel keeps its own single skeleton.
 *
 * **`storiesRow` (10-12, UI-D-700)** adds the story row's three skeleton circles with 12px label
 * bars at the row's real geometry above the cards, so the swap shifts nothing. The caller passes it
 * only for a viewer who gets the row (a member or a moderator with `social` and `stories` on): for
 * anyone else the markup is exactly what it was.
 */
export function ExplorarSkeleton({ storiesRow = false }: { storiesRow?: boolean }) {
  const cards = CARDS.map((index) => <FeedCardSkeleton key={index} />);
  if (!storiesRow) {
    return (
      <div aria-busy data-testid="explorar-skeleton" className="flex flex-col gap-6">
        {cards}
      </div>
    );
  }
  return (
    <div aria-busy data-testid="explorar-skeleton" className="flex flex-col gap-3">
      <StoriesStrip circles={[]} regionLabel="" loading />
      <div className="flex flex-col gap-6">{cards}</div>
    </div>
  );
}
