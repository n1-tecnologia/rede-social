import { describe, expect, it } from 'vitest';
import { publishStorySchema } from '../contracts/index';

/**
 * 10-07 (D-714, D-704): the member publish body is the organization's, unchanged. The audience of a
 * story is STAMPED by the service from the caller's role (backed by `stories_social_insert_gate` in SQL);
 * it is never a key a client can send, so the schema stays `.strict()` and names no audience.
 */

const ASSET = '0b000000-0000-4000-8000-000000000001';

describe('10-07 publishStorySchema: no client-visible audience', () => {
  it('accepts the plain body (the positive control for every refusal below)', () => {
    const parsed = publishStorySchema.safeParse({
      mediaAssetId: ASSET,
      mediaKind: 'image',
      caption: 'legenda',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a visibility key, whatever its value, and any other unknown key', () => {
    for (const extra of [
      { visibility: 'tenant' },
      { visibility: 'followers' },
      { authorUserId: '0a000000-0000-4000-8000-000000000001' },
      { communityId: ASSET },
    ]) {
      expect(
        publishStorySchema.safeParse({ mediaAssetId: ASSET, mediaKind: 'image', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});
