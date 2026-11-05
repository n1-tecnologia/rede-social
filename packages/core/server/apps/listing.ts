/**
 * The store listing text (13-31, D-607, NATIVE-29): inert stubs so the RED tests fail on their assertions.
 */
export type ListingText = { text: string; cut: boolean };
export type CutUnit = 'codepoints' | 'bytes';

export const STORE_LIMITS = {} as Record<string, number>;
export const AGE_RATING_ANSWERS = {} as Record<string, unknown>;
export const PLAY_QUESTIONNAIRE_ANSWERS = {} as Record<string, unknown>;

export class ListingRefusal extends Error {}

export const cutToLimit = (text: string, _limit: { unit: CutUnit; max: number }): ListingText => ({
  text,
  cut: false,
});
export const buildStoreDescription = (_input: {
  tenantName: string;
  modules: readonly string[];
}): ListingText => ({ text: '', cut: false });
export const buildReviewNotes = (_input: { tenantName: string }): ListingText => ({
  text: '',
  cut: false,
});
export const buildKeywords = (_input: { tenantName: string }): ListingText => ({
  text: '',
  cut: false,
});
export const buildStoreTitle = (_name: string): ListingText => ({ text: '', cut: false });
export const buildShortDescription = (_input: { tenantName: string }): ListingText => ({
  text: '',
  cut: false,
});
