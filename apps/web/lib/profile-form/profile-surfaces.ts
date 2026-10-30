import type { ProfileFormBootstrap } from '@rede-social/contracts/profile-form';

/**
 * Which of the profile form's two surfaces `/perfil` shows (12-14, D-584, D-586, UI-D-589, UI-D-590).
 *
 * Both are for the `member` role only (staff are never asked) and only while the bootstrap carries the
 * `profileForm` block (the module is on). `noticeCount` is how many optional questions are new for her:
 * the notice shows only above zero. Whether an active question exists is the section's own read.
 */
export function profileFormSurfaces(
  role: string,
  profileForm: ProfileFormBootstrap | undefined,
): { showAnswers: boolean; noticeCount: number } {
  if (role !== 'member' || profileForm === undefined) return { showAnswers: false, noticeCount: 0 };
  return { showAnswers: true, noticeCount: Math.max(0, profileForm.newOptional) };
}
