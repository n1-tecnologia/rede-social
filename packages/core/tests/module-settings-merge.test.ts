import { describe, expect, it } from 'vitest';
import { mergeSettingsPatch } from '../server/platform/modules';

/**
 * 09-06 (D-474, EP-16): the platform settings write merges a patch into the stored blob key by key.
 * A bare `settings || patch` is a shallow concatenation, which would let `{ media: { video: ... } }`
 * wipe the tenant's photo cap; this pins the nesting rule without a database.
 */
describe('mergeSettingsPatch', () => {
  it('merges nested objects key by key and keeps the siblings of the patched leaf', () => {
    const stored = { media: { photoMaxBytes: 1048576, video: { enabled: false, maxBytes: 10 } } };
    expect(mergeSettingsPatch(stored, { media: { video: { enabled: true } } })).toEqual({
      media: { photoMaxBytes: 1048576, video: { enabled: true, maxBytes: 10 } },
    });
  });

  it('returns ONLY the top-level keys the patch names, so SQL concatenation leaves the rest of the blob alone', () => {
    const stored = { stray: { keep: true }, media: { photosPerPost: 3 } };
    const changes = mergeSettingsPatch(stored, { media: { photoMaxBytes: 5 } });
    expect(Object.keys(changes)).toEqual(['media']);
    expect(changes).toEqual({ media: { photosPerPost: 3, photoMaxBytes: 5 } });
  });

  it('is idempotent: applying the same patch to its own result changes nothing', () => {
    const patch = { media: { video: { enabled: true, maxDurationSeconds: 30 } } };
    const once = mergeSettingsPatch({ media: { photosPerPost: 2 } }, patch);
    const twice = mergeSettingsPatch(
      { media: { photosPerPost: 2, ...(once.media as object) } },
      patch,
    );
    expect(twice).toEqual(once);
  });

  it('replaces a scalar, an array or a mistyped stored value, and creates a missing branch', () => {
    expect(
      mergeSettingsPatch({ media: { photoMaxBytes: 'lots' } }, { media: { photoMaxBytes: 7 } }),
    ).toEqual({
      media: { photoMaxBytes: 7 },
    });
    expect(mergeSettingsPatch({}, { media: { video: { enabled: true } } })).toEqual({
      media: { video: { enabled: true } },
    });
    expect(mergeSettingsPatch({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
    expect(mergeSettingsPatch({ media: 'broken' }, { media: { photosPerPost: 2 } })).toEqual({
      media: { photosPerPost: 2 },
    });
  });

  it('an empty patch changes nothing', () => {
    expect(mergeSettingsPatch({ media: { photosPerPost: 2 } }, {})).toEqual({});
  });
});
