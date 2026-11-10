import type { MemberQuestion, ProfileFormType } from '@rede-social/contracts/profile-form';
import { phoneMask } from './phone';

/**
 * The ONE mapper from a stored answer to what the screen shows (12-14, UI-D-591, T-12-32). "Minhas
 * respostas", another member's public block and the staff block all render through it, so the rule that
 * nothing a member typed becomes markup is reviewed in one place.
 *
 * Pure and total: it never throws, never builds a `Date` (a date is a calendar day, so a time zone must
 * not move it), and every string it returns is plain text for React to escape. The only view that is not
 * text is a link, and a link exists only for `http:` and `https:`; anything else (a `javascript:` or
 * `data:` text, a relative path) is shown as text, never as an anchor. An e-mail is text, never `mailto:`.
 *
 * The words that live in the catalog (Sim, Não, Aceito, "{n} de 5", "Outro: {text}") come in as
 * `AnswerWords`, so this module holds no copy of its own.
 */

/** What a stored answer looks like on the wire (the loose shape of any type). */
export type StoredValue = NonNullable<MemberQuestion['answer']>;

/** The part of a question the mapper reads: its type and its options (labels in the admin's order). */
export type AnswerDef = {
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

/** The catalog words the mapper needs, already translated. */
export type AnswerWords = {
  yes: string;
  no: string;
  accepted: string;
  other: (text: string) => string;
  rating: (n: number) => string;
};

export type AnswerView =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; text: string }
  | { kind: 'rating'; n: number; text: string };

/** The translator shape both `getTranslations` and `useTranslations` satisfy for the words below. */
export type WordsTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Builds the words from a translator scoped to `profileForm.profile` (keys `values.*`). */
export function answerWordsFrom(t: WordsTranslator): AnswerWords {
  return {
    yes: t('values.yes'),
    no: t('values.no'),
    accepted: t('values.accepted'),
    other: (text) => t('values.other', { text }),
    rating: (n) => t('values.rating', { n }),
  };
}

const text = (value: string): AnswerView => ({ kind: 'text', text: value });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `YYYY-MM-DD` to `dd/MM/yyyy` by splitting the text: no `Date`, so no time zone can shift the day. */
export function isoDayToBr(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** pt-BR number with the thousands dot and the decimal comma (`1.234,5`). */
function numberText(value: number): string {
  return value.toLocaleString('pt-BR', { useGrouping: true, maximumFractionDigits: 20 });
}

/** True only for an absolute `http:` or `https:` address; anything else is not a link. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function choiceView(def: AnswerDef, value: Record<string, unknown>, words: AnswerWords) {
  const labelOf = new Map(def.options.map((option) => [option.id, option.label]));
  const ids: string[] = [];
  if (Array.isArray(value.optionIds)) {
    // The question's own option order, whatever order the stored list has.
    const stored = new Set(value.optionIds.filter((id): id is string => typeof id === 'string'));
    for (const option of def.options) if (stored.has(option.id)) ids.push(option.id);
  } else if (typeof value.optionId === 'string') {
    ids.push(value.optionId);
  }
  const parts = ids.flatMap((id) => {
    const label = labelOf.get(id);
    return label === undefined ? [] : [label];
  });
  const other =
    typeof value.otherText === 'string' && value.otherText !== '' ? value.otherText : null;
  if (other !== null) parts.push(words.other(other));
  return parts.length === 0 ? null : text(parts.join(', '));
}

/**
 * The view of `value` for a question of `def`, or `null` when there is nothing to show (no answer, or a
 * stored shape that does not fit the type). The caller decides what `null` reads as ("Sem resposta" for
 * the member and the staff, a skipped row for another member).
 */
export function answerView(
  def: AnswerDef,
  value: StoredValue | null | undefined,
  words: AnswerWords,
): AnswerView | null {
  if (value === null || value === undefined) return null;
  switch (def.type) {
    case 'short_text':
    case 'long_text':
    case 'professional_id':
      return typeof value === 'string' && value.trim() !== '' ? text(value) : null;
    case 'dropdown':
    case 'single_choice':
    case 'multiple_choice':
      return isRecord(value) ? choiceView(def, value, words) : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? text(numberText(value)) : null;
    case 'date': {
      if (typeof value !== 'string') return null;
      const br = isoDayToBr(value);
      return br === null ? null : text(br);
    }
    case 'phone': {
      if (typeof value !== 'string') return null;
      return /^[0-9]{10,11}$/.test(value) ? text(phoneMask(value)) : text(value);
    }
    case 'email':
      return typeof value === 'string' && value.trim() !== '' ? text(value) : null;
    case 'link': {
      if (typeof value !== 'string' || value.trim() === '') return null;
      return isHttpUrl(value) ? { kind: 'link', href: value, text: value } : text(value);
    }
    case 'yes_no':
      return typeof value === 'boolean' ? text(value ? words.yes : words.no) : null;
    case 'acceptance':
      return value === true ? text(words.accepted) : null;
    case 'rating':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
        ? { kind: 'rating', n: value, text: words.rating(value) }
        : null;
  }
}
