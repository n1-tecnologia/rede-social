import type { ReportSubjectType } from '@rede-social/contracts/moderation';
import type { ReportContentRemover } from '@rede-social/core/server/safety/index';
import { archiveReportedCommunityInTx } from '@rede-social/module-communities/server';
import { removeReportedContentInTx } from '@rede-social/module-feed/server';
import {
  removeReportedStoryCommentInTx,
  removeReportedStoryInTx,
} from '@rede-social/module-stories/server';

/**
 * The permission flags the dispatcher needs, read by the route BEFORE the resolution's transaction opens (the pool is
 * `max: 5`: a flag read inside a transaction would hold two connections). `canModerate` is true for every caller that
 * reached the route, because the route is guarded by `moderation.manage`.
 */
export type ReportRemovalFlags = {
  canManageStories: boolean;
  canManageCommunities: boolean;
  canModerate: boolean;
};

const NOTHING_AFTER_COMMIT = () => undefined;

/**
 * The per-request dispatcher over the six report subjects (Phase 11 plan 16, D-732, T-11-11, T-11-30). The kernel's
 * `resolveReport` receives it as `deps.removeContent` and calls it inside the resolution's transaction, so the module
 * removal, its `moderation_log` row and the report's new state commit together or not at all. The kernel never imports
 * a module (MOD-02): this is the API tier, which may import every one.
 *
 * - `feed_post`, `post_comment`: the feed's own remover, unchanged.
 * - `story`, `story_comment`: the stories module's removers (an organization story needs `canManageStories`).
 * - `community`: an ARCHIVE of the community (reversible; a member community writes `community_archived`). Removing a
 *   community for good stays outside the queue.
 * - `direct_message`: `not_removable`, nothing touched. The chat is append only (D-859): the only things the
 *   administrator can do with the report of a message are ignore it or block its author.
 *
 * The `never` guard in the default branch makes a future subject type a compile error here.
 */
export function buildReportRemover(flags: ReportRemovalFlags): ReportContentRemover {
  return async (tx, ctx, subject) => {
    const type: ReportSubjectType = subject.type;
    switch (type) {
      case 'feed_post':
      case 'post_comment':
        return removeReportedContentInTx(tx, ctx, subject);
      case 'story':
        return removeReportedStoryInTx(tx, ctx, subject.id, {
          canManage: flags.canManageStories,
          canModerate: flags.canModerate,
        });
      case 'story_comment':
        return removeReportedStoryCommentInTx(tx, ctx, subject.id, {
          canModerate: flags.canModerate,
        });
      case 'community':
        return archiveReportedCommunityInTx(tx, ctx, subject.id, {
          canManage: flags.canManageCommunities,
        });
      case 'direct_message':
        return { outcome: 'not_removable', afterCommit: NOTHING_AFTER_COMMIT };
      default: {
        const unreachable: never = type;
        throw new Error(`unhandled report subject type: ${String(unreachable)}`);
      }
    }
  };
}
