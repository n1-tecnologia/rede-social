import type { VideoCommunities } from '@tria/module-feed/contracts';
import type { CountTemplates } from '@tria/module-feed/ui';

/**
 * INERT RED STUB (05.3-07 Task 2, TDD RED commit). It declares the published contract so the tests
 * compile, and every function answers the "nothing" value. The GREEN commit replaces this file.
 */
export type ReelView = {
  id: string;
  caption: string;
  shareUrl: string | null;
  author: { displayName: string; profileHref: string; avatarUrl: string | null };
  community: { name: string; href: string; ariaLabel: string } | null;
  likeCount: number;
  commentCount: number;
  viewerLiked: boolean;
  video: { assetId: string; width: number | null; height: number | null };
};

export function reelView(
  _post: unknown,
  _tf: unknown,
  _shareOrigin: string | null,
): ReelView | null {
  return null;
}

export async function loadReelsPage(_query: {
  communityId?: string | null;
  cursor?: string | null;
}): Promise<{ items: ReelView[]; nextCursor: string | null } | null> {
  return null;
}

export async function loadVideoCommunities(): Promise<VideoCommunities['items']> {
  return [];
}

export function announcedCount(
  _count: number,
  _templates: CountTemplates,
  _locale: string,
): string | null {
  return null;
}
