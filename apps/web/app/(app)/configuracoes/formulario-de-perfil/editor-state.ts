import {
  codePoints,
  PROFILE_FORM_LIMITS,
  type ProfileFormLimits,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import { formatNumberPtBr, parseNumberPtBr } from '@/lib/profile-form/number';
import { isChoiceType, isRangeType } from '@/lib/profile-form/question-types';

/**
 * The editor's draft, pure (12-16, D-585, D-590, D-592, UI-D-569). The sheet holds one `QuestionDraft`;
 * every rule that does not need React lives here so it can be tested without rendering: building the
 * blank draft, switching the type, turning the draft into the contract's body, deciding whether anything
 * changed and which field is wrong.
 *
 * The draft keeps the admin's raw text (a limit is a string until it is parsed, an option row has a
 * client key that never leaves the browser). The server stays the authority on every rule; this module
 * only keeps the admin from sending what it would refuse.
 */

export type EditorMode = 'create' | 'edit' | 'replace';

/** One option row. `key` is the client's stable row key; `id` is the server's, present only for a stored option. */
export interface OptionDraft {
  key: string;
  id?: string;
  label: string;
}

export interface QuestionDraft {
  /** `null` until the admin picks a tile (create and replace). */
  type: ProfileFormType | null;
  title: string;
  helpText: string;
  required: boolean;
  showOnProfile: boolean;
  allowOther: boolean;
  options: OptionDraft[];
  /** The raw minimum and maximum: pt-BR number text for a number question, an ISO day for a date question. */
  min: string;
  max: string;
}

let rowCounter = 0;

/** A fresh key for a row that has no server id yet. */
export function newRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

/** A new question starts with two empty option rows (UI-D-571). */
function blankOptions(): OptionDraft[] {
  return [
    { key: newRowKey(), label: '' },
    { key: newRowKey(), label: '' },
  ];
}

/** The draft of a question that does not exist yet: no type, nothing typed, two empty rows. */
export function blankDraft(): QuestionDraft {
  return {
    type: null,
    title: '',
    helpText: '',
    required: false,
    showOnProfile: false,
    allowOther: false,
    options: blankOptions(),
    min: '',
    max: '',
  };
}

/**
 * Picks a type: what the new type can carry survives, the rest is dropped. Options and "Outro" are kept
 * only between two choice types (a never-answered question may change type; the server drops the same
 * things), a limit pair only when the type stays number or date.
 */
export function changeType(draft: QuestionDraft, next: ProfileFormType): QuestionDraft {
  const wasChoice = isChoiceType(draft.type);
  const choice = isChoiceType(next);
  const keepLimits = isRangeType(next) && draft.type === next;
  return {
    ...draft,
    type: next,
    options: choice ? (wasChoice ? draft.options : blankOptions()) : [],
    allowOther: choice && wasChoice ? draft.allowOther : false,
    min: keepLimits ? draft.min : '',
    max: keepLimits ? draft.max : '',
  };
}

/** A limit as the field shows it: pt-BR text for a number, the ISO day for a date. */
export function limitText(value: number | string | undefined): string {
  if (typeof value === 'number') return formatNumberPtBr(value);
  return typeof value === 'string' ? value : '';
}

/** The minimum and maximum a draft names, and which of the two texts is not a value of the type. */
export function parseLimits(draft: Pick<QuestionDraft, 'type' | 'min' | 'max'>): {
  limits: ProfileFormLimits;
  invalid: { min: boolean; max: boolean };
} {
  const limits: ProfileFormLimits = {};
  const invalid = { min: false, max: false };
  if (!isRangeType(draft.type)) return { limits, invalid };
  for (const key of ['min', 'max'] as const) {
    const raw = draft[key].trim();
    if (raw === '') continue;
    if (draft.type === 'number') {
      const value = parseNumberPtBr(raw);
      if (value === null) invalid[key] = true;
      else limits[key] = value;
    } else {
      limits[key] = raw;
    }
  }
  return { limits, invalid };
}

/** The body of `POST /questions` (the contract's `createQuestionBodySchema` input). */
export interface CreateBody {
  type: ProfileFormType;
  title: string;
  helpText: string | null;
  required: boolean;
  showOnProfile: boolean;
  allowOther: boolean;
  options: { label: string }[];
  limits: ProfileFormLimits;
}

/**
 * The draft as the create (and replace) body. Text is trimmed; "Outro" and the options travel only for a
 * choice type, the limits only for number and date, so a type switch can never leave a stale field in the
 * body. Empty option rows are refused by `validateDraft` before this is called; here they are kept so a
 * caller that skipped validation gets the server's refusal rather than a silent drop.
 */
export function toCreateBody(draft: QuestionDraft): CreateBody {
  if (draft.type === null) throw new Error('A question body needs a type');
  const choice = isChoiceType(draft.type);
  return {
    type: draft.type,
    title: draft.title.trim(),
    helpText: draft.helpText.trim() === '' ? null : draft.helpText.trim(),
    required: draft.required,
    showOnProfile: draft.showOnProfile,
    allowOther: choice && draft.allowOther,
    options: choice ? draft.options.map((option) => ({ label: option.label.trim() })) : [],
    limits: parseLimits(draft).limits,
  };
}

/** What a draft compares on: the user-visible content, without the client row keys. */
function snapshot(draft: QuestionDraft): string {
  return JSON.stringify({
    type: draft.type,
    title: draft.title,
    helpText: draft.helpText,
    required: draft.required,
    showOnProfile: draft.showOnProfile,
    allowOther: draft.allowOther,
    options: draft.options.map((option) => [option.id ?? null, option.label]),
    min: draft.min,
    max: draft.max,
  });
}

/** Whether the admin has changed anything since the sheet opened (the dirty guard of UI-D-569). */
export function isDirty(initial: QuestionDraft, draft: QuestionDraft): boolean {
  return snapshot(initial) !== snapshot(draft);
}

/** A catalog key under `profileForm.admin.editor` and the values its message takes. */
export interface FieldError {
  key: string;
  values?: Record<string, number | string>;
}

export interface DraftErrors {
  title?: FieldError;
  helpText?: FieldError;
}

/** Whether `validateDraft` found anything wrong. */
export function hasErrors(errors: DraftErrors): boolean {
  return Object.values(errors).some((value) => value !== undefined);
}

/**
 * The first-pass rules of the sheet: a title is required and capped at 120 code points, the help text at
 * 300. The type is not an error here (the save button stays disabled until one is chosen). Option and limit
 * rules are added by the editor's later tasks; the server repeats all of them.
 */
export function validateDraft(draft: QuestionDraft): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (title === '') errors.title = { key: 'errors.titleRequired' };
  else if (codePoints(title) > PROFILE_FORM_LIMITS.title) {
    errors.title = { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.title } };
  }
  if (codePoints(draft.helpText.trim()) > PROFILE_FORM_LIMITS.helpText) {
    errors.helpText = { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.helpText } };
  }
  return errors;
}

/** The save button is enabled once a type is chosen and the title is not empty. */
export function canSave(draft: QuestionDraft): boolean {
  return draft.type !== null && draft.title.trim() !== '';
}

/**
 * The message for a refusal the SERVER sent against a field, so a rule the draft did not catch (or a
 * race) still lands under its field. `null` means the code names no single field: the caller falls back
 * to the "save failed, your changes are still here" toast.
 */
export function serverFieldError(field: 'title' | 'helpText', code: string): FieldError | null {
  if (field === 'title' && code === 'required') return { key: 'errors.titleRequired' };
  if (code === 'too_long') {
    const max = field === 'title' ? PROFILE_FORM_LIMITS.title : PROFILE_FORM_LIMITS.helpText;
    return { key: 'errors.tooLong', values: { max } };
  }
  return null;
}
