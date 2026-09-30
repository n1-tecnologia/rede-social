import { FEED_NOTIFICATION_KINDS } from '@rede-social/module-feed/contracts';
import type { ReactNode } from 'react';
import type { NotificationRenderer } from '@/lib/notifications-view';

/**
 * 07-01 (CONTEXT: "row renderers keyed by `kind`", UI-D-251): the notification row renderers, each
 * contributed per kind at the web composition point (`lib/registry.tsx` re-exports this map), so the
 * notifications module never enumerates another module's kinds. A renderer turns the row's FACTS
 * into the sentence (the actor in a leading bold span, the excerpt in curly quotes, both from the
 * catalog) and names its target (D-232).
 *
 * A leaf module on purpose: `lib/registry.tsx` imports the feed and stories server actions, so a unit
 * test of the rows could not import it without the whole action graph and its env validation.
 *
 * A kind absent from this map is filtered out of the list in 07-01; 07-04 adds the generic row.
 */
const actorBold = (chunks: ReactNode) => <span className="font-bold text-text">{chunks}</span>;

/** The one sentence shape of the three post kinds: `withExcerpt` when there is text, else `plain`. */
const postSentence =
  (key: 'post' | 'communityPost' | 'reel'): NotificationRenderer['sentence'] =>
  (facts, t, actorName) => {
    const excerpt =
      typeof facts.excerpt === 'string' && facts.excerpt !== '' ? facts.excerpt : null;
    const community = typeof facts.communityName === 'string' ? facts.communityName : '';
    return t.rich(`kinds.${key}.${excerpt ? 'withExcerpt' : 'plain'}`, {
      actor: actorName,
      excerpt: excerpt ?? '',
      community,
      b: actorBold,
    });
  };

const postHref = (facts: Record<string, unknown>) =>
  typeof facts.postId === 'string' ? `/post/${encodeURIComponent(facts.postId)}` : '/inicio';

export const notificationRenderers: Partial<Record<string, NotificationRenderer>> = {
  [FEED_NOTIFICATION_KINDS.post]: {
    glyph: 'Newspaper',
    sentence: postSentence('post'),
    href: postHref,
  },
  [FEED_NOTIFICATION_KINDS.communityPost]: {
    glyph: 'Newspaper',
    sentence: postSentence('communityPost'),
    href: postHref,
  },
  [FEED_NOTIFICATION_KINDS.reel]: {
    glyph: 'Film',
    sentence: postSentence('reel'),
    href: postHref,
  },
};
