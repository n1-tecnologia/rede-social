import { cutOnWord } from '@rede-social/contracts/text';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationRetraction,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { STORIES_NOTIFICATION_KINDS } from '../contracts/index';
import { storiesPushCopy } from './notification-copy';

/**
 * The stories module's notification sources and retractions (07-04, RESEARCH Pattern 1): the module
 * DECLARES who is notified of its own events, reading its OWN tables (`stories`, and the story
 * comments it writes into `feed_comments`), and the notifications module never imports it (MOD-02).
 *
 * `resolve` runs in the WORKER, inside the tenant lane of the payload's tenant (RLS scopes every
 * read), and returns intents: data, never a stored sentence.
 *
 * **Exactly two sources, and deliberately none on the highlight event.** A story published straight
 * into a highlight emits `story.published` THEN the highlight event (stories/service.ts); a source on
 * the second would notify every member twice for one story (RESEARCH Pitfall 11). The dedupe key
 * `stories.story:{storyId}` would absorb it anyway, but the rule is "do not double-emit", not "rely on
 * the dedupe to hide it".
 */

/** Excerpts are at most this many graphemes, cut on a word (UI-SPEC §Notification rows). */
export const STORIES_EXCERPT_MAX = 80;

/** A push for a story is pointless after the story is gone: the TTL never outlives it. */
export const STORIES_PUSH_TTL_MAX = 86_400;

/** The instant format every fact uses (microseconds, UTC, the list's own format). */
const ISO_MICROSECONDS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

type StoryFactsRow = {
  id: string;
  author_user_id: string;
  media_kind: 'image' | 'video';
  media_asset_id: string;
  expires_at: string;
  /** Whole seconds until `expires_at`, computed by the database clock (never negative). */
  seconds_left: number;
};

/**
 * `story.published` → one broadcast intent to every live `member` (D-229: staff never get a broadcast
 * kind), excluding the author. A story that is gone (soft-deleted or already expired) by the time the
 * worker runs yields `[]`.
 *
 * The preview is the story's image. A video story has none: the media broker serves no video poster
 * (the 05.2 decision recorded in stories/service.ts), so a video row renders without a trailing
 * preview rather than a broken one, exactly as a video post does (07-01).
 */
async function resolveStoryPublished(
  tx: Tx,
  payload: { tenantId: string; storyId: string },
): Promise<NotificationIntent[]> {
  const rows = await tx.execute<StoryFactsRow>(sql`
    select s.id,
           s.author_user_id,
           s.media_kind,
           s.media_asset_id,
           to_char(s.expires_at at time zone 'utc', ${ISO_MICROSECONDS}) as expires_at,
           greatest(0, floor(extract(epoch from (s.expires_at - now()))))::int as seconds_left
      from stories s
     where s.tenant_id = ${payload.tenantId}::uuid
       and s.id = ${payload.storyId}::uuid
       and s.deleted_at is null
       and s.expires_at > now()
     limit 1
       for share of s`);
  const row = rows[0];
  if (!row) return [];

  return [
    {
      kind: STORIES_NOTIFICATION_KINDS.story,
      audience: { type: 'members' },
      // D-229: an author never notifies themselves; the row's author is the authority in this lane.
      excludeUserIds: [row.author_user_id],
      dedupeKey: `stories.story:${row.id}`,
      subject: { type: 'story', id: row.id },
      object: null,
      actorUserId: row.author_user_id,
      facts: {
        storyId: row.id,
        expiresAt: row.expires_at,
        previewAssetId: row.media_kind === 'image' ? row.media_asset_id : null,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: storiesPushCopy({ kind: STORIES_NOTIFICATION_KINDS.story }),
        url: `/stories/${row.id}`,
        tag: 'stories-story',
        topic: 'stories-story',
        ttlSeconds: storyPushTtl(row.seconds_left),
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

/** `min(86400, seconds until expiry)`, at least 1 (a web-push TTL of 0 means "deliver now or drop"). */
export function storyPushTtl(secondsLeft: number): number {
  const left = Number.isFinite(secondsLeft) ? Math.floor(secondsLeft) : 0;
  return Math.max(1, Math.min(STORIES_PUSH_TTL_MAX, left));
}

type StoryCommentFactsRow = {
  comment_id: string;
  body: string;
  story_id: string;
  story_author_user_id: string;
  expires_at: string;
  actor_name: string | null;
};

/**
 * `story.commented` → one PERSONAL intent to the story's author (staff included, D-229), unless the
 * commenter IS the author. Reads, in the given `tx`: the live comment on that story, the live story
 * (soft-deleted → `[]`; an expired story still notifies, because the row's tap already explains
 * expiry on Início, UI-D-254) and the commenter's display name for the push body.
 */
async function resolveStoryCommented(
  tx: Tx,
  payload: { tenantId: string; storyId: string; commentId: string; actorUserId: string },
): Promise<NotificationIntent[]> {
  const rows = await tx.execute<StoryCommentFactsRow>(sql`
    select c.id as comment_id,
           c.body,
           s.id as story_id,
           s.author_user_id as story_author_user_id,
           to_char(s.expires_at at time zone 'utc', ${ISO_MICROSECONDS}) as expires_at,
           mp.display_name as actor_name
      from feed_comments c
      join stories s
        on s.id = c.story_id
       and s.tenant_id = c.tenant_id
       and s.deleted_at is null
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = c.author_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
     where c.tenant_id = ${payload.tenantId}::uuid
       and c.id = ${payload.commentId}::uuid
       and c.story_id = ${payload.storyId}::uuid
       and c.deleted_at is null
     limit 1
       for share of c, s`);
  const row = rows[0];
  if (!row) return [];
  if (row.story_author_user_id === payload.actorUserId) return [];

  const excerpt = cutOnWord(row.body ?? '', STORIES_EXCERPT_MAX) || null;

  return [
    {
      kind: STORIES_NOTIFICATION_KINDS.storyCommented,
      audience: { type: 'users', userIds: [row.story_author_user_id] },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `stories.story_commented:${row.comment_id}`,
      subject: { type: 'story', id: row.story_id },
      object: { type: 'story_comment', id: row.comment_id },
      actorUserId: payload.actorUserId,
      facts: {
        storyId: row.story_id,
        commentId: row.comment_id,
        expiresAt: row.expires_at,
        excerpt,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: storiesPushCopy({
          kind: STORIES_NOTIFICATION_KINDS.storyCommented,
          actorName: row.actor_name,
          excerpt,
        }),
        url: `/stories/${row.story_id}`,
        tag: 'stories-comment',
        topic: 'stories-comment',
        ttlSeconds: 86_400,
        urgency: 'normal',
        renotify: true,
      },
    },
  ];
}

export const storiesNotificationSources = [
  {
    event: 'story.published',
    resolve: (tx, payload) => resolveStoryPublished(tx, payload),
  } satisfies NotificationSource<'story.published'>,
  {
    event: 'story.commented',
    resolve: (tx, payload) => resolveStoryCommented(tx, payload),
  } satisfies NotificationSource<'story.commented'>,
] as NotificationSource[];

/**
 * Retractions (07-04, keep-and-mark). Both sources above lock their retractable targets `for share`
 * (07 review B-WR-01, the feed module's rule): a delete waits for the fan-out to commit, so its
 * retraction always sees the rows the fan-out wrote.
 *
 * A deleted story blanks every row ABOUT it (subject), and a
 * deleted story comment blanks only the rows whose object is that comment. The definer
 * `app.notifications_retract` replaces the payload wholesale with `{"removed": true}`, so no excerpt
 * of taken-down content survives in anyone's bell.
 */
export const storiesNotificationRetractions = [
  {
    event: 'story.deleted',
    match: (payload) => ({ on: 'subject', type: 'story', id: payload.storyId }),
  } satisfies NotificationRetraction<'story.deleted'>,
  {
    event: 'story.comment_deleted',
    match: (payload) => ({ on: 'object', type: 'story_comment', id: payload.commentId }),
  } satisfies NotificationRetraction<'story.comment_deleted'>,
] as NotificationRetraction[];
