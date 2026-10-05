import { avatarUrlFor } from '@rede-social/contracts/profiles';
import { describe, expect, it } from 'vitest';
import { storyPageSchema, storySummarySchema } from '../contracts/index';

/**
 * `authorAvatarUrl` on the story summary (2026-10-03, the client's item #2b: the owner's face in the
 * tenant circle) — the contract half. The API builds it with the profile's own `avatarUrlFor`, and
 * BOTH sides parse it with this one strict schema (`apps/web/lib/stories.ts` reads every page
 * through `storyPageSchema`), so the claims worth pinning are:
 *
 *  1. the value the API sends — `avatarUrlFor(assetId)`, the stable `/v1/media/{id}/w128` path — and
 *     `null` (no photo, or an author who is no longer an active member) both parse;
 *  2. nothing else does: an absolute URL (a signed Storage link that would outlive its signature, or
 *     anything an `<img>` could be pointed at) is refused, so it can never reach the DOM;
 *  3. the photo is the ONLY thing of the author's profile that rides a story: `.strict()` still
 *     refuses a display name or a membership id (D-104 — the strip and the viewer name the tenant);
 *  4. a page from an API that predates the field still parses, with `null` — the one defaulted key,
 *     so the web can ship before the API (the deploy-order note on the schema).
 */

const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';
const PHOTO_ASSET = '0b000000-0000-4000-8000-0000000000a1';

/** A story exactly as `toStory` answers it, minus the field under test. */
function summary(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    authorUserId: '0a000000-0000-4000-8000-000000000001',
    mediaAssetId: '0b000000-0000-4000-8000-000000000001',
    mediaKind: 'image',
    mediaVariantWidths: [640, 1080],
    mediaStatus: 'ready',
    mediaFailureReason: null,
    caption: '',
    publishedAt: '2026-10-03T12:00:00.000000Z',
    expiresAt: '2026-10-04T12:00:00.000000Z',
    isActive: true,
    durationSeconds: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    highlightCount: 0,
    viewerSeen: false,
    ...extra,
  };
}

describe('storySummarySchema.authorAvatarUrl — the author’s photo, and nothing more (#2b)', () => {
  it('1. the path the API builds (`avatarUrlFor`) parses verbatim, and so does null', () => {
    const photo = avatarUrlFor(PHOTO_ASSET);
    expect(photo).toBe(`/v1/media/${PHOTO_ASSET}/w128`);
    expect(storySummarySchema.parse(summary({ authorAvatarUrl: photo })).authorAvatarUrl).toBe(
      photo,
    );
    expect(
      storySummarySchema.parse(summary({ authorAvatarUrl: avatarUrlFor(null) })).authorAvatarUrl,
    ).toBeNull();
  });

  it('2. an absolute or foreign URL is refused — only the stable `/v1/media/` path can reach an <img>', () => {
    for (const value of [
      `https://project.supabase.co/storage/v1/object/sign/media/${PHOTO_ASSET}.webp?token=x`,
      `//evil.example/${PHOTO_ASSET}`,
      'javascript:alert(1)',
      '',
    ]) {
      expect(storySummarySchema.safeParse(summary({ authorAvatarUrl: value })).success).toBe(false);
    }
  });

  it('3. `.strict()` still refuses any OTHER profile field — the photo is all a story carries', () => {
    for (const extra of [
      { authorDisplayName: 'Ana' },
      { authorMembershipId: UUID },
      { author: { displayName: 'Ana' } },
    ]) {
      expect(
        storySummarySchema.safeParse(
          summary({ authorAvatarUrl: avatarUrlFor(PHOTO_ASSET), ...extra }),
        ).success,
      ).toBe(false);
    }
  });

  it('4. a page from an API that predates the field parses, every story with a null photo', () => {
    const page = storyPageSchema.parse({ items: [summary(), summary()], nextCursor: null });
    expect(page.items.map((item) => item.authorAvatarUrl)).toEqual([null, null]);
  });
});
