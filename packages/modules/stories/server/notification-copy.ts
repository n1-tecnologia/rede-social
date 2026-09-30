import { cutOnWord } from '@rede-social/contracts/text';

/**
 * The pt-BR push banner bodies for the stories kinds, verbatim from 07-UI-SPEC §Push banner copy
 * (UI-D-266, UI-D-267). Rendered SERVER-SIDE (a push must exist before any page loads, so it cannot
 * come from next-intl) and carried only in the intent's push hint: NEVER stored in a `notifications`
 * row (the row keeps `kind` + facts, and the web renders its own sentence).
 */

/** A banner body is about one line on a lock screen (the feed's cap, restated). */
export const STORIES_PUSH_BODY_MAX = 100;

export const STORIES_PUSH_COPY = {
  story: () => 'Novo story',
  /** Only when the commenter's name is unavailable at fan-out time (a departed member). */
  actorFallback: 'Alguém',
  storyCommented: (actor: string, excerpt: string) => `${actor} comentou no seu story: ${excerpt}`,
} as const;

/** The rendered body, cut on a word to `STORIES_PUSH_BODY_MAX` graphemes with `…` only when it cut. */
export function storiesPushCopy(
  facts:
    | { kind: 'stories.story' }
    | { kind: 'stories.story_commented'; actorName: string | null; excerpt: string | null },
): string {
  const body =
    facts.kind === 'stories.story'
      ? STORIES_PUSH_COPY.story()
      : STORIES_PUSH_COPY.storyCommented(
          facts.actorName ?? STORIES_PUSH_COPY.actorFallback,
          facts.excerpt ?? '',
        );
  return cutOnWord(body, STORIES_PUSH_BODY_MAX);
}
