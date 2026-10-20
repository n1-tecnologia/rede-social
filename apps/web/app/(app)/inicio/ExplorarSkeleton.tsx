import { FeedCardSkeleton } from '@rede-social/module-feed/ui';

const CARDS = [0, 1, 2];

/**
 * Explorar's first load (UI-D-511, E02 loading): three `FeedCardSkeleton`s, the geometry of the
 * feed's own first paint, under the chip row (which renders at once, outside the `Suspense` this
 * fills). `aria-busy`, no words: the skeleton says nothing about the page it waits for. The
 * sentinel keeps its own single skeleton.
 */
export function ExplorarSkeleton() {
  return (
    <div aria-busy data-testid="explorar-skeleton" className="flex flex-col gap-6">
      {CARDS.map((index) => (
        <FeedCardSkeleton key={index} />
      ))}
    </div>
  );
}
