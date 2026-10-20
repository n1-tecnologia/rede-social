// RED skeleton (09-12): the exports exist so the tests fail on their assertions, not on the import.
export type SocialLimitsForm = {
  photos: number;
  photoMb: number;
  videoEnabled: boolean;
  videoSeconds?: number;
  videoMb?: number;
};

export const SOCIAL_LIMIT_RANGES = {} as Record<string, { min: number; max: number }>;

export function validateSocialLimits(
  _form: SocialLimitsForm,
): Partial<Record<string, { min: number; max: number }>> {
  return { skeleton: { min: 0, max: 0 } };
}

export function socialLimitsToPatch(_form: SocialLimitsForm): {
  media?: Record<string, unknown>;
} {
  return {};
}

export function socialLimitsFromSettings(_settings: unknown): SocialLimitsForm {
  return { photos: 0, photoMb: 0, videoEnabled: false };
}
