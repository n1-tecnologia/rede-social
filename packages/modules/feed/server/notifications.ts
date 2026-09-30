import { cutOnWord } from '@rede-social/contracts/text';
import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { FEED_NOTIFICATION_KINDS } from '../contracts/index';
import { feedPushCopy } from './notification-copy';

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

export const feedNotificationSources: NotificationSource<'post.published'>[] = [
  {
    event: 'post.published',
    resolve: (tx, payload) => resolvePostPublished(tx, payload),
  },
];
