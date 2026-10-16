'use server';

import type { MediaPlayback } from '@rede-social/contracts/media';
import { REELS_MINT_MAX_IDS } from '@rede-social/module-reels/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';
import { getPlaybackTokens } from '@/lib/media';
import { loadReel, loadReelsPage, type ReelView } from '@/lib/reels';

/**
 * The Reels server actions (05.3-07), in the conventions every action in this app encodes: the
 * argument is untrusted and validated BEFORE any request (T-05.3-16), a refusal is a KEY rather than
 * copy, and `redirect()` is called OUTSIDE the try/catch because it throws in Next 16.
 *
 * **ONE mint action for up to three videos.** Next dispatches server actions ONE AT A TIME per client
 * (the local server-actions guide, "Sequential dispatch on the client"), so a per-video mint called
 * three times from the browser would run three round trips in series, and each would queue behind any
 * like or load-more already in flight. The parallel work therefore happens INSIDE this one action.
 * The cap is `REELS_MINT_MAX_IDS` (3): the ±1 window, the current Reel and its two neighbours.
 *
 * **The credential is never cached, never logged, never embedded in the RSC payload** (D-44,
 * T-05-34, T-05.3-15). It exists only in this action's return value and in the host's visit-scoped
 * in-memory map. There is deliberately no caching directive here, and a failure logs the asset id
 * only. The `/reels` page itself mints nothing.
 *
 * Likes and comments are NOT re-exported from here: Turbopack forbids a `'use server'` module from
 * re-exporting another one's actions, so the page imports them from `@/app/(app)/inicio/feed-actions`.
 */

export type MintResult =
  | {
      ok: true;
      results: (
        | { assetId: string; ok: true; playback: MediaPlayback }
        | { assetId: string; ok: false; code: 'notReady' | 'generic' }
      )[];
    }
  | { ok: false; code: 'generic' };

export type ReelsPageResult =
  | { ok: true; items: ReelView[]; nextCursor: string | null }
  | { ok: false };

const mintIdsSchema = z.array(z.uuid()).min(1).max(REELS_MINT_MAX_IDS);
const communityIdSchema = z.uuid().nullable();
const cursorSchema = z.string().max(512).nullable();
const postIdSchema = z.uuid();

/**
 * Mint playback credentials for up to `REELS_MINT_MAX_IDS` assets in parallel, answering per asset.
 *
 * A 409 is `notReady` for that asset only (the video is not ready yet); the others still get their
 * playback. A refusal the bootstrap knows (401, 403 and the membership/tenant codes) is remembered
 * and becomes ONE navigation after every mint settled. Anything else is `generic` for that asset.
 * The API answers a foreign or unknown asset with its bare 404 (TENANT-04), which lands as `generic`.
 */
export async function mintReelPlaybackAction(assetIds: string[]): Promise<MintResult> {
  const ids = mintIdsSchema.safeParse(assetIds);
  if (!ids.success) return { ok: false, code: 'generic' };

  const settled = await Promise.allSettled(ids.data.map((assetId) => getPlaybackTokens(assetId)));

  let refusal: string | null = null;
  const results = settled.map((outcome, index) => {
    const assetId = ids.data[index] as string;
    if (outcome.status === 'fulfilled') {
      return { assetId, ok: true as const, playback: outcome.value };
    }
    const error: unknown = outcome.reason;
    if (error instanceof ApiClientError && error.status === 409) {
      return { assetId, ok: false as const, code: 'notReady' as const };
    }
    const path = error instanceof ApiClientError ? bootstrapRedirectPath(error) : null;
    if (path) refusal ??= path;
    else console.error('reels.playback_mint_failed', { assetId });
    return { assetId, ok: false as const, code: 'generic' as const };
  });

  if (refusal) redirect(refusal);
  return { ok: true, results };
}

/**
 * One page of Reels for a lane (`communityId` null = "Todos"), already mapped to views on the server,
 * through the one feed fetch. The cursor is OPAQUE and forwarded verbatim; its length is bounded so
 * a crafted argument cannot grow the request. `loadReelsPage` owns the refusal navigation.
 */
export async function loadReelsPageAction(
  communityId: string | null,
  cursor: string | null,
): Promise<ReelsPageResult> {
  const lane = communityIdSchema.safeParse(communityId);
  const after = cursorSchema.safeParse(cursor);
  if (!lane.success || !after.success) return { ok: false };

  const page = await loadReelsPage({ communityId: lane.data, cursor: after.data });
  if (!page) return { ok: false };
  return { ok: true, items: page.items, nextCursor: page.nextCursor };
}

/**
 * The start of the overlay a feed video opens (2026-10-09) when the page read from its feed page's
 * cursor did not hold it (it stopped being a ready video) or there is no feed page to read from (the
 * post page): THAT video first, then its lane's newest page without it, so the overlay still opens on
 * the video the member tapped and continues from there. A post that is no Reel any more leaves the
 * lane's page as it is; a lane that cannot be read leaves the one video alone, with nothing after
 * it. Only when neither could be read is it `{ ok: false }`. Both reads run in parallel, in this one
 * action (Next dispatches actions one at a time per client).
 */
export async function loadReelStartAction(
  postId: string,
  communityId: string | null,
): Promise<ReelsPageResult> {
  const post = postIdSchema.safeParse(postId);
  const lane = communityIdSchema.safeParse(communityId);
  if (!post.success || !lane.success) return { ok: false };

  const [reel, page] = await Promise.all([
    loadReel(post.data),
    loadReelsPage({ communityId: lane.data }),
  ]);
  if (!page) return reel ? { ok: true, items: [reel], nextCursor: null } : { ok: false };
  return {
    ok: true,
    items: reel ? [reel, ...page.items.filter((item) => item.id !== reel.id)] : page.items,
    nextCursor: page.nextCursor,
  };
}
