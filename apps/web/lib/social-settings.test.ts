import { SOCIAL_SETTINGS_DEFAULTS } from '@rede-social/module-social/contracts';
import { describe, expect, it } from 'vitest';
import { socialMediaLimits } from './social-settings';

const MIB = 1024 * 1024;

const bootstrapWith = (modules: { key: string; settings: Record<string, unknown> }[]) => ({
  modules,
});

/**
 * 09-09 / D-474: the composer reads the tenant's member media limits from the bootstrap, parsed by
 * the SAME tolerant schema the registry uses. The helper never throws and never fetches.
 */
describe('socialMediaLimits', () => {
  it('returns the defaults when the bootstrap has no social entry', () => {
    expect(socialMediaLimits(bootstrapWith([{ key: 'feed', settings: {} }]))).toEqual(
      SOCIAL_SETTINGS_DEFAULTS.media,
    );
  });

  it('returns the defaults for an empty settings blob', () => {
    const limits = socialMediaLimits(bootstrapWith([{ key: 'social', settings: {} }]));
    expect(limits).toEqual({
      photoMaxBytes: 5 * MIB,
      photosPerPost: 4,
      video: { enabled: false, maxDurationSeconds: 60, maxBytes: 100 * MIB },
    });
  });

  it('returns the stored numbers for a valid blob', () => {
    const limits = socialMediaLimits(
      bootstrapWith([
        {
          key: 'social',
          settings: {
            media: {
              photoMaxBytes: 1 * MIB,
              photosPerPost: 2,
              video: { enabled: true, maxDurationSeconds: 30, maxBytes: 20 * MIB },
            },
          },
        },
      ]),
    );
    expect(limits).toEqual({
      photoMaxBytes: 1 * MIB,
      photosPerPost: 2,
      video: { enabled: true, maxDurationSeconds: 30, maxBytes: 20 * MIB },
    });
  });

  it('fills the keys a partial blob leaves out with the defaults', () => {
    const limits = socialMediaLimits(
      bootstrapWith([{ key: 'social', settings: { media: { video: { enabled: true } } } }]),
    );
    expect(limits.video.enabled).toBe(true);
    expect(limits.video.maxDurationSeconds).toBe(60);
    expect(limits.photosPerPost).toBe(4);
  });

  it('falls back to the defaults on a malformed blob and never throws', () => {
    for (const settings of [
      { media: 'nope' },
      { media: { photosPerPost: -3 } },
      { media: { video: { enabled: 'yes' } } },
      { media: { photoMaxBytes: 10_000 * MIB } },
    ]) {
      expect(() => socialMediaLimits(bootstrapWith([{ key: 'social', settings }]))).not.toThrow();
      expect(socialMediaLimits(bootstrapWith([{ key: 'social', settings }]))).toEqual(
        SOCIAL_SETTINGS_DEFAULTS.media,
      );
    }
  });
});
