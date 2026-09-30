import { EVENTS_NOTIFICATION_KINDS } from '@rede-social/module-events/contracts';
import { FEED_NOTIFICATION_KINDS } from '@rede-social/module-feed/contracts';
import { STORIES_NOTIFICATION_KINDS } from '@rede-social/module-stories/contracts';
import type { ReactNode } from 'react';
import { formatEventDate, formatEventTime } from '@/lib/events-view';
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
 * A kind absent from this map renders the generic row (`genericNotificationRenderer`, 07-04), so a
 * producer that ships a kind before the web does never breaks the list.
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

/** The excerpt fact, or `''` (a comment always has a body, so a comment kind always carries one). */
const excerptOf = (facts: Record<string, unknown>) =>
  typeof facts.excerpt === 'string' ? facts.excerpt : '';

/** The actor-plus-excerpt sentence the three comment kinds share (UI-SPEC Copywriting Contract). */
const commentSentence =
  (key: 'commentLiked' | 'commentReplied' | 'storyCommented'): NotificationRenderer['sentence'] =>
  (facts, t, actorName) =>
    t.rich(`kinds.${key}`, { actor: actorName, excerpt: excerptOf(facts), b: actorBold });

/**
 * D-232 / UI-D-254: a like or a reply opens the post AT the comment. Both ids are uuids the source
 * wrote; anything else degrades to the post alone (or Início), never to a hand-built broken URL.
 */
const commentHref = (facts: Record<string, unknown>) => {
  const post = postHref(facts);
  if (post === '/inicio' || typeof facts.commentId !== 'string') return post;
  return `${post}?comentario=${encodeURIComponent(facts.commentId)}`;
};

/** The Início notice a tap on an expired story lands on (UI-D-254); the only `aviso` Início reads. */
export const STORY_EXPIRED_HREF = '/inicio?aviso=story-expirado';

/**
 * A story row opens the story while it lives and Início's expired notice once `expiresAt` is at or
 * before the request instant — decided HERE on the server from the ONE `nowMs` (UI-D-14), so the
 * 24 h window never depends on a device clock and a tap never lands on the viewer's not-found.
 */
const storyHref = (facts: Record<string, unknown>, nowMs: number) => {
  if (typeof facts.storyId !== 'string') return '/inicio';
  const expiresMs = typeof facts.expiresAt === 'string' ? Date.parse(facts.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return STORY_EXPIRED_HREF;
  return `/stories/${encodeURIComponent(facts.storyId)}`;
};

/** The event title fact, or `''` (the source always writes one). */
const titleOf = (facts: Record<string, unknown>) =>
  typeof facts.title === 'string' ? facts.title : '';

/** The event's start instant, or null when the fact is missing or not an instant. */
const startsAtOf = (facts: Record<string, unknown>) =>
  typeof facts.startsAt === 'string' && Number.isFinite(Date.parse(facts.startsAt))
    ? facts.startsAt
    : null;

/**
 * 07-05 (D-232, UI-D-254): every event kind and both reminders open the event. The id is the uuid
 * the source wrote; anything else degrades to Início, never to a hand-built broken URL.
 */
const eventHref = (facts: Record<string, unknown>) =>
  typeof facts.eventId === 'string' ? `/eventos/${encodeURIComponent(facts.eventId)}` : '/inicio';

/**
 * The new and reactivated event rows: the actor in bold, the title in curly quotes and the UI-D-203
 * when-line (`seg., 12 de out. · 19:00`), formatted by `lib/events-view.ts` in the TENANT's timezone
 * from the request's one instant, so a device in Manaus reads São Paulo's wall clock.
 */
const eventSentence =
  (key: 'event' | 'eventReactivated'): NotificationRenderer['sentence'] =>
  (facts, t, actorName, { timeZone, nowMs }) => {
    const startsAt = startsAtOf(facts);
    const when = startsAt
      ? t('kinds.eventWhen', {
          date: formatEventDate(startsAt, timeZone, nowMs),
          time: formatEventTime(startsAt, timeZone),
        })
      : '';
    return t.rich(`kinds.${key}`, { actor: actorName, title: titleOf(facts), when, b: actorBold });
  };

/** The actor-less reminder rows (UI-D-251): the tenant-clock start time and the title. */
const reminderSentence =
  (key: 'reminder24h' | 'reminder1h'): NotificationRenderer['sentence'] =>
  (facts, t, _actorName, { timeZone }) => {
    const startsAt = startsAtOf(facts);
    return t(`kinds.${key}`, {
      time: startsAt ? formatEventTime(startsAt, timeZone) : '',
      title: titleOf(facts),
    });
  };

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
  // UI-D-08: the heart is the one coloured glyph; a like is in-app only (D-235).
  [FEED_NOTIFICATION_KINDS.commentLiked]: {
    glyph: 'Heart',
    glyphTone: 'like',
    sentence: commentSentence('commentLiked'),
    href: commentHref,
  },
  [FEED_NOTIFICATION_KINDS.commentReplied]: {
    glyph: 'MessageCircleReply',
    sentence: commentSentence('commentReplied'),
    href: commentHref,
  },
  [STORIES_NOTIFICATION_KINDS.story]: {
    glyph: 'Sparkles',
    sentence: (_facts, t, actorName) => t.rich('kinds.story', { actor: actorName, b: actorBold }),
    href: storyHref,
  },
  [STORIES_NOTIFICATION_KINDS.storyCommented]: {
    glyph: 'MessageCircle',
    sentence: commentSentence('storyCommented'),
    href: storyHref,
  },
  // 07-05 (UI-D-251): the creator's avatar with the calendar disc; the reactivation names the admin
  // who reactivated it.
  [EVENTS_NOTIFICATION_KINDS.event]: {
    glyph: 'CalendarDays',
    sentence: eventSentence('event'),
    href: eventHref,
  },
  [EVENTS_NOTIFICATION_KINDS.reactivated]: {
    glyph: 'CalendarCheck',
    sentence: eventSentence('eventReactivated'),
    href: eventHref,
  },
  // Reminders are actor-less (sketch 007 surface 7): the 40px `CalendarClock` disc, never an avatar.
  [EVENTS_NOTIFICATION_KINDS.reminder24h]: {
    glyph: 'CalendarClock',
    leading: 'glyph',
    sentence: reminderSentence('reminder24h'),
    href: eventHref,
  },
  [EVENTS_NOTIFICATION_KINDS.reminder1h]: {
    glyph: 'CalendarClock',
    leading: 'glyph',
    sentence: reminderSentence('reminder1h'),
    href: eventHref,
  },
};
