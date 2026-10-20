import {
  SOCIAL_MAX_PHOTO_BYTES,
  SOCIAL_MAX_PHOTOS_PER_POST,
  SOCIAL_MAX_VIDEO_BYTES,
  SOCIAL_MAX_VIDEO_SECONDS,
  type SocialSettings,
  type SocialSettingsPatch,
} from '@rede-social/module-social/contracts';

/**
 * The platform panel's media-limits form (09-12, UI-D-505 c, D-474), as pure functions: the form
 * speaks photo counts, MB and seconds, the contract speaks bytes, and this file is the one place
 * that converts between them and names the field that is out of range. No DOM, no fetch.
 *
 * The bounds come from the SAME constants the API validates with (`SOCIAL_MAX_*`, themselves taken
 * from the admin media limits), so the form and the API cannot disagree on a bound: a value this
 * file accepts is a value `socialSettingsPatchSchema` accepts (T-09-39 - the API still re-validates).
 * Integers only: a fractional MB or a count with a decimal is out of range, as it is for the API.
 */

const MIB = 1024 * 1024;

/** Every bound is inclusive and a whole number, in the unit of the field's label. */
export const SOCIAL_LIMIT_RANGES = {
  photos: { min: 1, max: SOCIAL_MAX_PHOTOS_PER_POST },
  photoMb: { min: 1, max: Math.floor(SOCIAL_MAX_PHOTO_BYTES / MIB) },
  videoSeconds: { min: 1, max: SOCIAL_MAX_VIDEO_SECONDS },
  videoMb: { min: 1, max: Math.floor(SOCIAL_MAX_VIDEO_BYTES / MIB) },
} as const;

export type SocialLimitField = keyof typeof SOCIAL_LIMIT_RANGES;
export type SocialLimitBounds = { min: number; max: number };

/**
 * The form's values in the units of the labels. `videoSeconds` and `videoMb` only matter (and are
 * only validated and sent) while `videoEnabled` is true.
 */
export type SocialLimitsForm = {
  photos: number;
  photoMb: number;
  videoEnabled: boolean;
  videoSeconds?: number;
  videoMb?: number;
};

function inRange(value: number | undefined, bounds: SocialLimitBounds): boolean {
  return (
    value !== undefined && Number.isInteger(value) && value >= bounds.min && value <= bounds.max
  );
}

/**
 * The fields that are out of range, each with its bounds (for the "Informe um valor entre {min} e
 * {max}." message). The video fields are checked only while video is on: with it off they are not
 * on screen, so a stale value in them must not block the save.
 */
export function validateSocialLimits(
  form: SocialLimitsForm,
): Partial<Record<SocialLimitField, SocialLimitBounds>> {
  const errors: Partial<Record<SocialLimitField, SocialLimitBounds>> = {};
  const fields: [SocialLimitField, number | undefined][] = [
    ['photos', form.photos],
    ['photoMb', form.photoMb],
  ];
  if (form.videoEnabled) {
    fields.push(['videoSeconds', form.videoSeconds], ['videoMb', form.videoMb]);
  }
  for (const [field, value] of fields) {
    if (!inRange(value, SOCIAL_LIMIT_RANGES[field])) errors[field] = SOCIAL_LIMIT_RANGES[field];
  }
  return errors;
}

/**
 * The form as the API's partial patch: bytes for the sizes, and for the video only `enabled` while
 * it is off (the stored duration and size are left alone, so switching video back on later restores
 * them). Call it only on a form `validateSocialLimits` accepted.
 */
export function socialLimitsToPatch(form: SocialLimitsForm): SocialSettingsPatch {
  const video: { enabled: boolean; maxDurationSeconds?: number; maxBytes?: number } = {
    enabled: form.videoEnabled,
  };
  if (form.videoEnabled) {
    if (form.videoSeconds !== undefined) video.maxDurationSeconds = form.videoSeconds;
    if (form.videoMb !== undefined) video.maxBytes = form.videoMb * MIB;
  }
  return {
    media: { photosPerPost: form.photos, photoMaxBytes: form.photoMb * MIB, video },
  };
}

/** Bytes to whole MB for a field (a value set through the API that is not a whole MiB is rounded). */
const toMb = (bytes: number) => Math.max(1, Math.round(bytes / MIB));

/** The inverse of `socialLimitsToPatch`: the effective settings in the units of the labels. */
export function socialLimitsFromSettings(settings: SocialSettings): SocialLimitsForm {
  const { media } = settings;
  return {
    photos: media.photosPerPost,
    photoMb: toMb(media.photoMaxBytes),
    videoEnabled: media.video.enabled,
    videoSeconds: media.video.maxDurationSeconds,
    videoMb: toMb(media.video.maxBytes),
  };
}
