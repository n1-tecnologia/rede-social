import {
  SOCIAL_MAX_PHOTO_BYTES,
  SOCIAL_MAX_PHOTOS_PER_POST,
  SOCIAL_MAX_VIDEO_BYTES,
  SOCIAL_MAX_VIDEO_SECONDS,
  SOCIAL_SETTINGS_DEFAULTS,
  socialSettingsPatchSchema,
} from '@rede-social/module-social/contracts';
import { describe, expect, it } from 'vitest';
import {
  SOCIAL_LIMIT_RANGES,
  type SocialLimitsForm,
  socialLimitsFromSettings,
  socialLimitsToPatch,
  validateSocialLimits,
} from './social-limits';

/**
 * 09-12 (UI-D-505 c, D-474, T-09-39) - the platform sheet's pure helper: the form speaks counts, MB
 * and seconds; the contract speaks bytes. One helper converts both ways and names the field that is
 * out of range, so the conversion and the bounds are proved without a DOM. The ranges are the shared
 * contract constants' (the API validates with the same ones), so the form and the API cannot
 * disagree on a bound.
 */

const MIB = 1024 * 1024;

const defaults: SocialLimitsForm = {
  photos: 4,
  photoMb: 5,
  videoEnabled: false,
  videoSeconds: 60,
  videoMb: 100,
};

describe('SOCIAL_LIMIT_RANGES', () => {
  it('are the contract caps: 10 photos, 15 MB, 300 s, 500 MB, each from 1', () => {
    expect(SOCIAL_LIMIT_RANGES).toEqual({
      photos: { min: 1, max: 10 },
      photoMb: { min: 1, max: 15 },
      videoSeconds: { min: 1, max: 300 },
      videoMb: { min: 1, max: 500 },
    });
  });

  it('follow the shared constants, never a retyped number', () => {
    expect(SOCIAL_LIMIT_RANGES.photos.max).toBe(SOCIAL_MAX_PHOTOS_PER_POST);
    expect(SOCIAL_LIMIT_RANGES.photoMb.max * MIB).toBe(SOCIAL_MAX_PHOTO_BYTES);
    expect(SOCIAL_LIMIT_RANGES.videoSeconds.max).toBe(SOCIAL_MAX_VIDEO_SECONDS);
    expect(SOCIAL_LIMIT_RANGES.videoMb.max * MIB).toBe(SOCIAL_MAX_VIDEO_BYTES);
  });
});

describe('socialLimitsToPatch', () => {
  it('with video off carries photos, the photo cap in bytes and only video.enabled', () => {
    expect(socialLimitsToPatch({ photos: 4, photoMb: 5, videoEnabled: false })).toEqual({
      media: { photosPerPost: 4, photoMaxBytes: 5242880, video: { enabled: false } },
    });
  });

  it('with video off ignores any duration and size left in the form', () => {
    expect(socialLimitsToPatch(defaults)).toEqual({
      media: { photosPerPost: 4, photoMaxBytes: 5 * MIB, video: { enabled: false } },
    });
  });

  it('with video on adds the duration and the size in bytes', () => {
    expect(
      socialLimitsToPatch({ ...defaults, videoEnabled: true, videoSeconds: 90, videoMb: 200 }),
    ).toEqual({
      media: {
        photosPerPost: 4,
        photoMaxBytes: 5 * MIB,
        video: { enabled: true, maxDurationSeconds: 90, maxBytes: 200 * MIB },
      },
    });
  });

  it('is accepted by the API patch schema at both extremes', () => {
    const low: SocialLimitsForm = {
      photos: 1,
      photoMb: 1,
      videoEnabled: true,
      videoSeconds: 1,
      videoMb: 1,
    };
    const high: SocialLimitsForm = {
      photos: 10,
      photoMb: 15,
      videoEnabled: true,
      videoSeconds: 300,
      videoMb: 500,
    };
    expect(socialSettingsPatchSchema.safeParse(socialLimitsToPatch(low)).success).toBe(true);
    expect(socialSettingsPatchSchema.safeParse(socialLimitsToPatch(high)).success).toBe(true);
  });
});

describe('socialLimitsFromSettings', () => {
  it('is the inverse over the contract defaults', () => {
    expect(socialLimitsFromSettings(SOCIAL_SETTINGS_DEFAULTS)).toEqual(defaults);
  });

  it('reads a saved blob in the units of the labels', () => {
    expect(
      socialLimitsFromSettings({
        media: {
          photoMaxBytes: 1 * MIB,
          photosPerPost: 9,
          video: { enabled: true, maxDurationSeconds: 300, maxBytes: 500 * MIB },
        },
      }),
    ).toEqual({ photos: 9, photoMb: 1, videoEnabled: true, videoSeconds: 300, videoMb: 500 });
  });

  it('round-trips a form through the patch and back', () => {
    const form: SocialLimitsForm = {
      photos: 7,
      photoMb: 12,
      videoEnabled: true,
      videoSeconds: 45,
      videoMb: 250,
    };
    const patch = socialLimitsToPatch(form);
    const media = patch.media;
    expect(media?.video).toBeDefined();
    const settings = {
      media: {
        photoMaxBytes: media?.photoMaxBytes ?? 0,
        photosPerPost: media?.photosPerPost ?? 0,
        video: {
          enabled: media?.video?.enabled ?? false,
          maxDurationSeconds: media?.video?.maxDurationSeconds ?? 0,
          maxBytes: media?.video?.maxBytes ?? 0,
        },
      },
    };
    expect(socialLimitsFromSettings(settings)).toEqual(form);
  });
});

describe('validateSocialLimits', () => {
  it('has no error for the defaults, nor for each bound exactly', () => {
    expect(validateSocialLimits(defaults)).toEqual({});
    expect(
      validateSocialLimits({
        photos: 1,
        photoMb: 1,
        videoEnabled: true,
        videoSeconds: 1,
        videoMb: 1,
      }),
    ).toEqual({});
    expect(
      validateSocialLimits({
        photos: 10,
        photoMb: 15,
        videoEnabled: true,
        videoSeconds: 300,
        videoMb: 500,
      }),
    ).toEqual({});
  });

  it.each([
    ['photos', 0, 11, { min: 1, max: 10 }],
    ['photoMb', 0, 16, { min: 1, max: 15 }],
    ['videoSeconds', 0, 301, { min: 1, max: 300 }],
    ['videoMb', 0, 501, { min: 1, max: 500 }],
  ] as const)(
    '%s: one step below the minimum and one above the maximum are reported with the bounds',
    (field, below, above, bounds) => {
      const base: SocialLimitsForm = { ...defaults, videoEnabled: true };
      expect(validateSocialLimits({ ...base, [field]: below })).toEqual({ [field]: bounds });
      expect(validateSocialLimits({ ...base, [field]: above })).toEqual({ [field]: bounds });
    },
  );

  it('reports a fractional value, NaN and a negative as out of range (integers only)', () => {
    expect(validateSocialLimits({ ...defaults, photos: 4.5 })).toEqual({
      photos: { min: 1, max: 10 },
    });
    expect(validateSocialLimits({ ...defaults, photoMb: Number.NaN })).toEqual({
      photoMb: { min: 1, max: 15 },
    });
    expect(validateSocialLimits({ ...defaults, photos: -3 })).toEqual({
      photos: { min: 1, max: 10 },
    });
  });

  it('does not validate the video fields while video is off', () => {
    expect(validateSocialLimits({ ...defaults, videoEnabled: false, videoSeconds: 999 })).toEqual(
      {},
    );
    expect(validateSocialLimits({ ...defaults, videoEnabled: false, videoMb: 0 })).toEqual({});
  });

  it('reports every invalid visible field at once', () => {
    expect(
      validateSocialLimits({
        photos: 14,
        photoMb: 5,
        videoEnabled: true,
        videoSeconds: 0,
        videoMb: 100,
      }),
    ).toEqual({ photos: { min: 1, max: 10 }, videoSeconds: { min: 1, max: 300 } });
  });
});
