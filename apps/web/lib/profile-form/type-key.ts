import type { ProfileFormType } from '@rede-social/contracts/profile-form';

/**
 * The catalog key of each question type (`profileForm.types.<key>.name`), a closed record so a new
 * type in `PROFILE_FORM_TYPES` is a compile error here until it has a name (D-591). The keys follow the
 * Copywriting Contract ("Admin: the 14 types"): camelCase, with `multiChoice` and `singleChoice` short.
 */
const TYPE_KEYS: Record<ProfileFormType, string> = {
  short_text: 'shortText',
  long_text: 'longText',
  dropdown: 'dropdown',
  multiple_choice: 'multiChoice',
  single_choice: 'singleChoice',
  yes_no: 'yesNo',
  acceptance: 'acceptance',
  number: 'number',
  rating: 'rating',
  date: 'date',
  phone: 'phone',
  email: 'email',
  link: 'link',
  professional_id: 'professionalId',
};

/** `profileForm.types.<key>.name` for a question type. */
export function typeNameKey(type: ProfileFormType): string {
  return `types.${TYPE_KEYS[type]}.name`;
}

export const PROFILE_FORM_TYPE_KEYS: Readonly<Record<ProfileFormType, string>> = TYPE_KEYS;
