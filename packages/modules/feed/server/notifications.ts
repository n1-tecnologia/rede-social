import { cutOnWord } from '@rede-social/contracts/text';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationRetraction,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { FEED_NOTIFICATION_KINDS } from '../contracts/index';
import { feedPushCopy, feedReplyPushCopy } from './notification-copy';

/**
 * The feed's notification sources (07-01, RESEARCH Pattern 1): the feed DECLARES who is notified of
 * its own events, reading its OWN tables, and the notifications module never imports the feed
 * (MOD-02). The app registry registers this list on the kernel seam.
 *
 * `resolve` runs in the WORKER, inside the tenant lane of the payload's tenant (RLS scopes every
 * read), and returns intents: data, never a stored sentence.
 */

/** Excerpts are at most this many graphemes, cut on a word (UI-SPEC §Notification rows). */
export const FEED_EXCERPT_MAX = 80;

type PostFactsRow = {
  id: string;
  author_user_id: string;
  caption: string;
  community_id: string | null;
  community_name: string | null;
  media_kind: 'none' | 'gallery' | 'video';
  author_name: string | null;
  preview_asset_id: string | null;
};

/**
 * D-226 / D-227: exactly ONE kind per post. A video post is a reel (whether or not it sits in a
 * community), a community post is a community post, anything else is a post.
 */
/** The three kinds one `post.published` can produce. */
export type FeedPostKind =
  | typeof FEED_NOTIFICATION_KINDS.post
  | typeof FEED_NOTIFICATION_KINDS.communityPost
  | typeof FEED_NOTIFICATION_KINDS.reel;

export function feedPostKind(row: Pick<PostFactsRow, 'media_kind' | 'community_id'>): FeedPostKind {
  if (row.media_kind === 'video') return FEED_NOTIFICATION_KINDS.reel;
  if (row.community_id !== null) return FEED_NOTIFICATION_KINDS.communityPost;
  return FEED_NOTIFICATION_KINDS.post;
}

/**
 * `post.published` → one broadcast intent to every live `member` of the tenant (D-229), excluding the
 * author. Reads, in the given `tx`: the post (a soft-deleted one yields `[]`), its caption, its
 * community's name (tenant-pinned join, the T-05-14 rule), `media_kind`, the author's display name
 * and the preview asset (the first gallery image; a video post stores no poster asset, so none).
 */
async function resolvePostPublished(
  tx: Tx,
  payload: { tenantId: string; postId: string; authorUserId: string },
): Promise<NotificationIntent[]> {
  const rows = await tx.execute<PostFactsRow>(sql`
    select p.id,
           p.author_user_id,
           p.caption,
           p.community_id,
           c.name as community_name,
           p.media_kind,
           mp.display_name as author_name,
           (
             select m.media_asset_id
               from feed_post_media m
              where m.tenant_id = p.tenant_id
                and m.post_id = p.id
                and m.kind = 'image'
              order by m.position
              limit 1
           ) as preview_asset_id
      from feed_posts p
      left join communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
      left join memberships ms
             on ms.tenant_id = p.tenant_id
            and ms.user_id = p.author_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
     where p.tenant_id = ${payload.tenantId}::uuid
       and p.id = ${payload.postId}::uuid
       and p.deleted_at is null
     limit 1`);
  const row = rows[0];
  if (!row) return [];

  const kind = feedPostKind(row);
  const excerpt = cutOnWord(row.caption ?? '', FEED_EXCERPT_MAX) || null;
  const isReel = kind === FEED_NOTIFICATION_KINDS.reel;

  return [
    {
      kind,
      audience: { type: 'members' },
      // D-229: an author never notifies themselves. The author read from the ROW wins over the
      // payload's (they are the same by construction; the row is the authority in this lane).
      excludeUserIds: [row.author_user_id],
      dedupeKey: `feed.post:${row.id}`,
      subject: { type: 'post', id: row.id },
      object: null,
      actorUserId: row.author_user_id,
      facts: {
        postId: row.id,
        excerpt,
        communityId: row.community_id,
        communityName: row.community_name,
        previewAssetId: row.preview_asset_id,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: feedPushCopy({
          kind,
          excerpt,
          actorName: row.author_name,
          communityName: row.community_name,
        }),
        url: `/post/${row.id}`,
        tag: isReel ? 'feed-reel' : 'feed-post',
        topic: isReel ? 'feed-reel' : 'feed-post',
        ttlSeconds: 86_400,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

type CommentLikedRow = {
  comment_id: string;
  post_id: string;
  body: string;
  author_user_id: string;
};

/**
 * `comment.liked` (07-04, D-226) → one PERSONAL intent to the comment's author (staff included,
 * D-229), unless the liker IS the author. Reads, in the given `tx`, the live comment on a live POST
 * (a story comment cannot be liked, and a comment or post removed before the job ran yields `[]`).
 *
 * **Never pushed (D-235):** `channels: ['in_app']`, `push: null`. The dedupe key names the ACTOR, so
 * an unlike then re-like by the same member lands on the same row (NOTIF-01 adjacency), while a second
 * member's like is a row of its own.
 */
async function resolveCommentLiked(
  tx: Tx,
  payload: { tenantId: string; commentId: string; actorUserId: string },
): Promise<NotificationIntent[]> {
  const rows = await tx.execute<CommentLikedRow>(sql`
    select c.id as comment_id,
           c.post_id,
           c.body,
           c.author_user_id
      from feed_comments c
      join feed_posts p
        on p.id = c.post_id
       and p.tenant_id = c.tenant_id
       and p.deleted_at is null
     where c.tenant_id = ${payload.tenantId}::uuid
       and c.id = ${payload.commentId}::uuid
       and c.deleted_at is null
     limit 1`);
  const row = rows[0];
  if (!row) return [];
  if (row.author_user_id === payload.actorUserId) return [];

  return [
    {
      kind: FEED_NOTIFICATION_KINDS.commentLiked,
      audience: { type: 'users', userIds: [row.author_user_id] },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `feed.comment_liked:${row.comment_id}:${payload.actorUserId}`,
      subject: { type: 'post', id: row.post_id },
      object: { type: 'comment', id: row.comment_id },
      actorUserId: payload.actorUserId,
      facts: {
        postId: row.post_id,
        commentId: row.comment_id,
        excerpt: cutOnWord(row.body ?? '', FEED_EXCERPT_MAX) || null,
      },
      channels: ['in_app'],
      push: null,
    },
  ];
}

type CommentRepliedRow = {
  comment_id: string;
  post_id: string;
  body: string;
  root_comment_id: string;
  root_author_user_id: string;
  actor_name: string | null;
};

/**
 * `comment.created` (07-04, D-226) → for a REPLY only, one PERSONAL intent to the ROOT comment's
 * author (staff included, D-229), unless the replier IS that author. A root comment yields `[]`:
 * NOTIF-01 covers comments on the member's COMMENTS, and a comment on a post is not one (RESEARCH A11,
 * closed by the UI-SPEC). Reads, in the given `tx`: the live reply, its live root and live post, and
 * the replier's display name for the push body.
 */
async function resolveCommentCreated(
  tx: Tx,
  payload: {
    tenantId: string;
    postId: string;
    commentId: string;
    parentCommentId: string | null;
    actorUserId: string;
  },
): Promise<NotificationIntent[]> {
  if (payload.parentCommentId === null) return [];

  const rows = await tx.execute<CommentRepliedRow>(sql`
    select c.id as comment_id,
           c.post_id,
           c.body,
           root.id as root_comment_id,
           root.author_user_id as root_author_user_id,
           mp.display_name as actor_name
      from feed_comments c
      join feed_comments root
        on root.id = c.parent_id
       and root.tenant_id = c.tenant_id
       and root.deleted_at is null
      join feed_posts p
        on p.id = c.post_id
       and p.tenant_id = c.tenant_id
       and p.deleted_at is null
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = c.author_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
     where c.tenant_id = ${payload.tenantId}::uuid
       and c.id = ${payload.commentId}::uuid
       and c.parent_id = ${payload.parentCommentId}::uuid
       and c.deleted_at is null
     limit 1`);
  const row = rows[0];
  if (!row) return [];
  if (row.root_author_user_id === payload.actorUserId) return [];

  const excerpt = cutOnWord(row.body ?? '', FEED_EXCERPT_MAX) || null;

  return [
    {
      kind: FEED_NOTIFICATION_KINDS.commentReplied,
      audience: { type: 'users', userIds: [row.root_author_user_id] },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `feed.comment_replied:${row.comment_id}`,
      subject: { type: 'post', id: row.post_id },
      object: { type: 'comment', id: row.comment_id },
      actorUserId: payload.actorUserId,
      facts: {
        postId: row.post_id,
        commentId: row.comment_id,
        rootCommentId: row.root_comment_id,
        excerpt,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: feedReplyPushCopy(row.actor_name, excerpt),
        url: `/post/${row.post_id}?comentario=${row.comment_id}`,
        // A personal kind: a second reply re-alerts (renotify) under its own tag (planning decision 5).
        tag: 'feed-comment-replied',
        topic: 'feed-comment-replied',
        ttlSeconds: 86_400,
        urgency: 'normal',
        renotify: true,
      },
    },
  ];
}

export const feedNotificationSources = [
  {
    event: 'post.published',
    resolve: (tx, payload) => resolvePostPublished(tx, payload),
  } satisfies NotificationSource<'post.published'>,
  {
    event: 'comment.liked',
    resolve: (tx, payload) => resolveCommentLiked(tx, payload),
  } satisfies NotificationSource<'comment.liked'>,
  {
    event: 'comment.created',
    resolve: (tx, payload) => resolveCommentCreated(tx, payload),
  } satisfies NotificationSource<'comment.created'>,
] as NotificationSource[];

/**
 * Retractions (07-04, keep-and-mark): a deleted post blanks every row ABOUT it (subject `post`: the
 * post, like and reply kinds alike), and a deleted comment blanks only the rows whose OBJECT is that
 * comment. `app.notifications_retract` replaces the payload wholesale with `{"removed": true}`, in the
 * payload's tenant only, so no excerpt of taken-down content survives in anyone's bell.
 */
export const feedNotificationRetractions = [
  {
    event: 'post.deleted',
    match: (payload) => ({ on: 'subject', type: 'post', id: payload.postId }),
  } satisfies NotificationRetraction<'post.deleted'>,
  {
    event: 'comment.deleted',
    match: (payload) => ({ on: 'object', type: 'comment', id: payload.commentId }),
  } satisfies NotificationRetraction<'comment.deleted'>,
] as NotificationRetraction[];
