import {
  PROFILE_FORM_CHOICE_TYPES,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import {
  AlignLeft,
  Calendar,
  ChevronsUpDown,
  CircleDot,
  Hash,
  Link2,
  ListChecks,
  type LucideIcon,
  Mail,
  Phone,
  SquareCheck,
  Star,
  ToggleLeft,
  Type,
} from 'lucide-react';
import { PROFILE_FORM_TYPE_KEYS, typeNameKey } from './type-key';

/**
 * The single table of the thirteen question types for the builder (12-16, D-590, D-591, UI-D-570): the
 * position of each in the picker and its 20px glyph. It is a `Record` keyed by `ProfileFormType`, so a
 * type added to `PROFILE_FORM_TYPES` is a compile error here until it has a row (and therefore a tile),
 * and a test pins that its keys equal the contract's list. The names and the one-line hints are NOT here:
 * they live in the catalog (`profileForm.types.<key>.name|hint`), reached through `typeNameKey` and
 * `typeHintKey`, and the list's badges read the same names.
 */
export interface QuestionTypeMeta {
  /** 1-based position of the tile in the picker. */
  order: number;
  /** The tile's 20px glyph. */
  glyph: LucideIcon;
}

export const QUESTION_TYPE_META: Record<ProfileFormType, QuestionTypeMeta> = {
  short_text: { order: 1, glyph: Type },
  long_text: { order: 2, glyph: AlignLeft },
  dropdown: { order: 3, glyph: ChevronsUpDown },
  multiple_choice: { order: 4, glyph: ListChecks },
  single_choice: { order: 5, glyph: CircleDot },
  yes_no: { order: 6, glyph: ToggleLeft },
  acceptance: { order: 7, glyph: SquareCheck },
  number: { order: 8, glyph: Hash },
  rating: { order: 9, glyph: Star },
  date: { order: 10, glyph: Calendar },
  phone: { order: 11, glyph: Phone },
  email: { order: 12, glyph: Mail },
  link: { order: 13, glyph: Link2 },
};

/** The types in the order the picker shows them. */
export function orderedTypes(): ProfileFormType[] {
  return (Object.keys(QUESTION_TYPE_META) as ProfileFormType[]).sort(
    (a, b) => QUESTION_TYPE_META[a].order - QUESTION_TYPE_META[b].order,
  );
}

export { typeNameKey };

/** `profileForm.types.<key>.hint` for a question type. */
export function typeHintKey(type: ProfileFormType): string {
  return `types.${PROFILE_FORM_TYPE_KEYS[type]}.hint`;
}

/** The name of a type through a `profileForm` translator. */
export function typeName(t: (key: string) => string, type: ProfileFormType): string {
  return t(typeNameKey(type));
}

const CHOICE: ReadonlySet<string> = new Set(PROFILE_FORM_CHOICE_TYPES);

/** Dropdown, multiple choice and single choice: the types that carry options and "Outro". */
export function isChoiceType(type: ProfileFormType | null): boolean {
  return type !== null && CHOICE.has(type);
}

/** Number and date: the two types with an admin-set minimum and maximum. */
export function isRangeType(type: ProfileFormType | null): type is 'number' | 'date' {
  return type === 'number' || type === 'date';
}
