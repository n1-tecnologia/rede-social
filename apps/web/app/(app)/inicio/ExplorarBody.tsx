import type { Bootstrap } from '@rede-social/contracts';
import { withAuthorInstagrams } from '@/lib/author-instagram';
import { loadFeed } from '@/lib/feed';
import { buildFeedSurface } from '@/lib/registry';

/**
 * The Explorar body (D-479, UI-D-493): `/inicio?aba=explorar` is the chip row and the feed, and
 * nothing else - no welcome block, no `HomeSlots` widgets, no stories strip, no profile nudge. The
 * feed is the SAME surface Início renders (`buildFeedSurface`, so the cards, the comment sheet, the
 * share and menu props and the Reels overlay are one implementation) fed by `scope: 'explorar'`
 * through `loadFeed`, the one fetch function the load-more and refresh actions also call.
 *
 * An unreadable first page is `null` and the surface renders the feed's own error card with
 * "Tentar novamente"; a refusal the bootstrap knows becomes a navigation inside `loadFeed`.
 */
export async function ExplorarBody({ bootstrap }: { bootstrap: Bootstrap }) {
  return buildFeedSurface(bootstrap, {
    scope: 'explorar',
    loaded: loadFeed({ scope: 'explorar' }).then(withAuthorInstagrams),
  });
}
