'use server';

import type { SocialListItem } from '@rede-social/module-social/contracts';

/** RED stub (09-10 Task 3): replaced by the GREEN commit. */
export type LoadMoreSocialListResult =
  | { ok: true; items: SocialListItem[]; nextCursor: string | null }
  | { ok: false; code: 'generic' };

export async function loadMoreFollowersAction(_cursor: string): Promise<LoadMoreSocialListResult> {
  return { ok: false, code: 'generic' };
}

export async function loadMoreFollowingAction(_cursor: string): Promise<LoadMoreSocialListResult> {
  return { ok: false, code: 'generic' };
}
