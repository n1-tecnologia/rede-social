'use server';

import type { MediaPlayback } from '@tria/contracts/media';
import type { ReelView } from '@/lib/reels';

/**
 * INERT RED STUB (05.3-07 Task 2, TDD RED commit). It declares the published result shapes so the
 * tests compile, and refuses everything. The GREEN commit replaces this file.
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

export async function mintReelPlaybackAction(_assetIds: string[]): Promise<MintResult> {
  return { ok: false, code: 'generic' };
}

export async function loadReelsPageAction(
  _communityId: string | null,
  _cursor: string | null,
): Promise<ReelsPageResult> {
  return { ok: false };
}
