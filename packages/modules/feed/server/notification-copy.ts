import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner bodies for the feed's post kinds, verbatim from 07-UI-SPEC §Push banner copy
 * (UI-D-266, UI-D-267). Push text is rendered SERVER-SIDE (a push must exist before any page loads,
 * so it cannot come from next-intl) and travels only in the intent's push hint: it is NEVER stored in
 * a `notifications` row (the row keeps `kind` + facts, and the web renders its own sentence).
 *
 * The title is the tenant's display name (`title: 'tenant'`), resolved by the push adapter (07-06).
 * No invented urgency: the copy says what happened and nothing more.
 */

/** A banner body is about one line on a lock screen. */
export const PUSH_BODY_MAX = 100;

export const FEED_PUSH_COPY = {
  postWithExcerpt: (excerpt: string) => `Novo post: ${excerpt}`,
  postPlain: (actor: string) => `Novo post de ${actor}`,
  communityWithExcerpt: (community: string, excerpt: string) =>
    `Novo post em ${community}: ${excerpt}`,
  communityPlain: (community: string) => `Novo post em ${community}`,
  reel: () => 'Novo reel',
  /** Only when the author's name is unavailable at publish time: the bare fact, no actor. */
  postBare: () => 'Novo post',
} as const;

/** The facts a push body is rendered from. */
export interface FeedPushFacts {
  kind: 'feed.post' | 'feed.community_post' | 'feed.reel';
  excerpt: string | null;
  actorName: string | null;
  communityName: string | null;
}

/** The rendered body, cut on a word to `PUSH_BODY_MAX` graphemes with `…` only when it cut. */
export function feedPushCopy({ kind, excerpt, actorName, communityName }: FeedPushFacts): string {
  let body: string;
  if (kind === 'feed.reel') {
    body = FEED_PUSH_COPY.reel();
  } else if (kind === 'feed.community_post' && communityName) {
    body = excerpt
      ? FEED_PUSH_COPY.communityWithExcerpt(communityName, excerpt)
      : FEED_PUSH_COPY.communityPlain(communityName);
  } else if (excerpt) {
    body = FEED_PUSH_COPY.postWithExcerpt(excerpt);
  } else {
    body = actorName ? FEED_PUSH_COPY.postPlain(actorName) : FEED_PUSH_COPY.postBare();
  }
  return cutOnWord(body, PUSH_BODY_MAX);
}
