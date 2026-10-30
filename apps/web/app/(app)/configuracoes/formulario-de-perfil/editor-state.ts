import {
  type AdminQuestion,
  codePoints,
  normalizeOptionLabel,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
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

/** The draft of a stored question: its options keep their server ids, its limits are shown as text. */
export function draftFromQuestion(question: AdminQuestion): QuestionDraft {
  return {
    type: question.type,
    title: question.title,
    helpText: question.helpText ?? '',
    required: question.required,
    showOnProfile: question.showOnProfile,
    allowOther: question.allowOther,
    options: question.options.map((option) => ({
      key: option.id,
      id: option.id,
      label: option.label,
    })),
    min: limitText(question.limits.min),
    max: limitText(question.limits.max),
  };
}

/**
 * The draft of a replacement (UI-D-574): the old title, help text, `required` and `showOnProfile` are
 * copied and nothing else, so the admin picks the new type from an open grid. The old answers are not read.
 */
export function replaceDraftFrom(question: AdminQuestion): QuestionDraft {
  return {
    ...blankDraft(),
    title: question.title,
    helpText: question.helpText ?? '',
    required: question.required,
    showOnProfile: question.showOnProfile,
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

/** The body of `PATCH /questions/{id}`: `revision` (the optimistic lock) and only the keys that changed. */
export interface UpdateBody {
  revision: number;
  type?: ProfileFormType;
  title?: string;
  helpText?: string | null;
  required?: boolean;
  showOnProfile?: boolean;
  allowOther?: boolean;
  options?: { id?: string; label: string }[];
  limits?: ProfileFormLimits;
}

const sameLimits = (a: ProfileFormLimits, b: ProfileFormLimits) =>
  a.min === b.min && a.max === b.max;

/**
 * The edit as the API wants it: `revision` always, then ONLY what differs from the stored question. An
 * option row that has a server id travels as `{ id, label }` (a rename or a reorder keeps what stored answers
 * mean), a new row as `{ label }`. A type change also sends the options, "Outro" and limits of the new type,
 * because the server drops what the new type cannot carry and keeps what the body does not name.
 */
export function toUpdateBody(question: AdminQuestion, draft: QuestionDraft): UpdateBody {
  if (draft.type === null) throw new Error('A question body needs a type');
  const body: UpdateBody = { revision: question.revision };
  const typeChanged = draft.type !== question.type;
  if (typeChanged) body.type = draft.type;

  const title = draft.title.trim();
  if (title !== question.title) body.title = title;
  const help = draft.helpText.trim() === '' ? null : draft.helpText.trim();
  if (help !== question.helpText) body.helpText = help;
  if (draft.required !== question.required) body.required = draft.required;
  if (draft.showOnProfile !== question.showOnProfile) body.showOnProfile = draft.showOnProfile;

  const choice = isChoiceType(draft.type);
  const allowOther = choice && draft.allowOther;
  if (allowOther !== question.allowOther) body.allowOther = allowOther;

  if (choice) {
    const next = draft.options.map((option) => ({
      ...(option.id === undefined ? {} : { id: option.id }),
      label: option.label.trim(),
    }));
    const same =
      next.length === question.options.length &&
      next.every(
        (option, index) =>
          option.id === question.options[index]?.id &&
          option.label === question.options[index]?.label,
      );
    if (typeChanged || !same) body.options = next;
  }

  if (isRangeType(draft.type)) {
    const { limits } = parseLimits(draft);
    if (typeChanged || !sameLimits(limits, question.limits)) body.limits = limits;
  }
  return body;
}

/** Whether an update body names anything besides the revision (otherwise there is nothing to save). */
export function hasChanges(body: UpdateBody): boolean {
  return Object.keys(body).some((key) => key !== 'revision');
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

/** The four rules of the options list (UI-D-571), each with its own sentence. */
export type OptionsIssue = 'min' | 'empty' | 'duplicate' | 'max';

export interface OptionsErrors {
  /** The list-level sentences, in the order they are shown. */
  issues: OptionsIssue[];
  /** The rows to mark invalid: an empty label or a repeated one. */
  rows: Record<string, 'empty' | 'duplicate'>;
}

export interface DraftErrors {
  title?: FieldError;
  helpText?: FieldError;
  options?: OptionsErrors;
  /** The pair rule: the minimum above the maximum (number) or the earlier day after the later (date). */
  limits?: FieldError;
  min?: FieldError;
  max?: FieldError;
}

/** Whether `validateDraft` found anything wrong. */
export function hasErrors(errors: DraftErrors): boolean {
  return Object.values(errors).some((value) => value !== undefined);
}

/** The options list rules: at least two rows, none empty, no repeat after `normalizeOptionLabel`, at most 20. */
export function validateOptions(options: readonly OptionDraft[]): OptionsErrors | undefined {
  const issues: OptionsIssue[] = [];
  const rows: Record<string, 'empty' | 'duplicate'> = {};
  if (options.length < 2) issues.push('min');

  const seen = new Map<string, string>();
  let duplicate = false;
  let empty = false;
  for (const option of options) {
    const label = option.label.trim();
    if (label === '') {
      empty = true;
      rows[option.key] = 'empty';
      continue;
    }
    const normal = normalizeOptionLabel(label);
    const first = seen.get(normal);
    if (first !== undefined) {
      duplicate = true;
      rows[option.key] = 'duplicate';
      rows[first] ??= 'duplicate';
    } else {
      seen.set(normal, option.key);
    }
  }
  if (empty) issues.push('empty');
  if (duplicate) issues.push('duplicate');
  if (options.length > PROFILE_FORM_LIMITS.options) issues.push('max');
  return issues.length > 0 ? { issues, rows } : undefined;
}

/**
 * The rules of the sheet: a title is required and capped at 120 code points, the help text at 300; a
 * choice question needs 2 to 20 distinct, non-empty options; a number or date pair needs values of its
 * type and a minimum that is not above the maximum. The type is not an error here (the save button stays
 * disabled until one is chosen). The server repeats every rule.
 */
export function validateDraft(draft: QuestionDraft, question?: AdminQuestion | null): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (title === '') errors.title = { key: 'errors.titleRequired' };
  else if (codePoints(title) > PROFILE_FORM_LIMITS.title) {
    errors.title = { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.title } };
  }
  if (codePoints(draft.helpText.trim()) > PROFILE_FORM_LIMITS.helpText) {
    errors.helpText = { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.helpText } };
  }

  if (isChoiceType(draft.type)) {
    const options = validateOptions(draft.options);
    if (options) errors.options = options;
  }

  if (isRangeType(draft.type)) {
    const { limits, invalid } = parseLimits(draft);
    if (invalid.min) errors.min = { key: 'errors.numberInvalid' };
    if (invalid.max) errors.max = { key: 'errors.numberInvalid' };
    const { min, max } = limits;
    if (min !== undefined && max !== undefined && min > max) {
      errors.limits = { key: draft.type === 'number' ? 'limits.errNumber' : 'limits.errDate' };
    }
    // A stored question with answers may only widen its limits (D-587): refused before any request.
    if (
      !errors.limits &&
      !errors.min &&
      !errors.max &&
      question &&
      draftLock(question, draft) === 'limits_locked'
    ) {
      errors.limits = { key: 'locked.limitsRefused' };
    }
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

/** The options sentence a server code stands for: an empty label, or more than 20 rows. Others have no single row. */
export function serverOptionsErrors(code: string): OptionsErrors | null {
  if (code === 'required') return { issues: ['empty'], rows: {} };
  if (code === 'limit_reached') return { issues: ['max'], rows: {} };
  return null;
}

/** The pair sentence a server code stands for: `out_of_range` on `limits.min` is the minimum above the maximum. */
export function serverLimitsError(type: ProfileFormType | null, code: string): FieldError | null {
  if (code !== 'out_of_range') return null;
  return { key: type === 'date' ? 'limits.errDate' : 'limits.errNumber' };
}

/** What a reopening write is called by the impact read and the dialog, and which question it concerns. */
export interface Reopening {
  /** The `change` of `GET /impact`. */
  change: 'create_required' | 'make_required' | 'replace';
  /** The dialog's case (its title and confirm label). */
  kind: 'add' | 'make' | 'replace';
  questionId?: string;
}

/**
 * Whether saving this draft REOPENS the form (D-585, UI-D-576): a new required question, an optional
 * question turned required, or a replacement that is required. Making a required question optional,
 * editing anything else, or replacing with an optional one frees members and needs no count.
 */
export function reopeningOf(
  mode: EditorMode,
  draft: Pick<QuestionDraft, 'required'>,
  question: { id: string; required: boolean } | null,
): Reopening | null {
  if (!draft.required) return null;
  if (mode === 'create') return { change: 'create_required', kind: 'add' };
  if (!question) return null;
  if (mode === 'replace') return { change: 'replace', kind: 'replace', questionId: question.id };
  if (!question.required) return { change: 'make_required', kind: 'make', questionId: question.id };
  return null;
}

// ── The options list, as pure moves ───────────────────────────────────────────────────────────────

/** The list with one more empty row at the end (the sheet then moves focus into it). */
export function addOptionRow(options: readonly OptionDraft[]): {
  options: OptionDraft[];
  key: string;
} {
  const key = newRowKey();
  return { options: [...options, { key, label: '' }], key };
}

/** The list without the row; a list of two or fewer is returned as it came (remove is disabled there). */
export function removeOptionRow(options: readonly OptionDraft[], key: string): OptionDraft[] {
  if (options.length <= 2) return [...options];
  return options.filter((option) => option.key !== key);
}

/** The list with the row moved one place; at an edge it is returned as it came. */
export function moveOptionRow(
  options: readonly OptionDraft[],
  key: string,
  delta: -1 | 1,
): OptionDraft[] {
  const from = options.findIndex((option) => option.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= options.length) return [...options];
  const next = options.slice();
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/** The list with one row's label replaced. */
export function renameOptionRow(
  options: readonly OptionDraft[],
  key: string,
  label: string,
): OptionDraft[] {
  return options.map((option) => (option.key === key ? { ...option, label } : option));
}

// ── The D-587 locks, mirrored (UI-D-574, UI-D-575, T-12-36) ───────────────────────────────────────

/** The part of a question the lock rules look at (the shape of `packages/core/server/profile-form/lock-rules.ts`). */
export interface LockDefinition {
  type: string;
  showOnProfile: boolean;
  allowOther: boolean;
  options: readonly { id: string; label: string }[];
  limits: { min?: number | string; max?: number | string };
}

export interface LockInput {
  current: LockDefinition;
  next: LockDefinition;
  answerCount: number;
  answeredOptionIds: ReadonlySet<string> | readonly string[];
  otherAnswered: boolean;
}

/**
 * A bound that did not exist and now does is a narrowing; so is a minimum that rises or a maximum that
 * falls. Numbers compare as numbers, dates as calendar days (ISO days order as text). A bound whose kind
 * does not match the type is not a bound. Same rule as the server's `narrows`.
 */
export function narrowsLimits(
  type: string,
  current: LockDefinition['limits'],
  next: LockDefinition['limits'],
): boolean {
  const isBound =
    type === 'number'
      ? (value: unknown): value is number => typeof value === 'number'
      : type === 'date'
        ? (value: unknown): value is string => typeof value === 'string'
        : null;
  if (isBound === null) return false;
  const lowers = (a: unknown, b: unknown) => (a as number | string) < (b as number | string);
  const raises = (a: unknown, b: unknown) => (a as number | string) > (b as number | string);
  if (isBound(next.min) && (!isBound(current.min) || raises(next.min, current.min))) return true;
  if (isBound(next.max) && (!isBound(current.max) || lowers(next.max, current.max))) return true;
  return false;
}

/**
 * The first D-587 rule the change breaks, or `null`: **a port of the server's `checkLocks`**
 * (`packages/core/server/profile-form/lock-rules.ts`) in the same check order (type, answered option,
 * "Outro", visibility, limits). `editor-state.test.ts` feeds it the same cases as
 * `packages/core/tests/profile-form-lock-rules.test.ts`, so the two cannot drift apart unseen. The server,
 * and the trigger behind it, stay the authority; this only keeps the sheet from offering what they refuse.
 */
export function checkDraftLocks(input: LockInput): ProfileFormIssue | null {
  const { current, next, answerCount, otherAnswered } = input;
  if (answerCount <= 0) return null;
  const answered =
    input.answeredOptionIds instanceof Set
      ? input.answeredOptionIds
      : new Set(input.answeredOptionIds);

  if (next.type !== current.type) return 'type_locked';

  for (const option of current.options) {
    if (!answered.has(option.id)) continue;
    const kept = next.options.find((candidate) => candidate.id === option.id);
    if (!kept || kept.label !== option.label) return 'option_locked';
  }

  if (current.allowOther && !next.allowOther && otherAnswered) return 'other_locked';
  if (!current.showOnProfile && next.showOnProfile) return 'visibility_locked';
  if (narrowsLimits(current.type, current.limits, next.limits)) return 'limits_locked';
  return null;
}

/** What the sheet locks or explains for a stored question that has answers (all `false` for a new one). */
export interface LockFlags {
  answerCount: number;
  /** The type picker is a read-only row. */
  typeLocked: boolean;
  /** Option id to its answer count, only for options with at least one answer: shown read-only, no remove. */
  lockedOptions: ReadonlyMap<string, number>;
  /** The "Outro" switch is locked on. */
  otherLocked: boolean;
  /** A number or date pair may only widen. */
  limitsWidenOnly: boolean;
  /** A private question cannot become public: the switch is disabled and off. */
  visibilityFrozen: boolean;
  /** A public question may be turned off but not on again: the warning line. */
  visibilityRatchet: boolean;
}

const NO_LOCKS: LockFlags = {
  answerCount: 0,
  typeLocked: false,
  lockedOptions: new Map(),
  otherLocked: false,
  limitsWidenOnly: false,
  visibilityFrozen: false,
  visibilityRatchet: false,
};

/**
 * The locks of a stored question, from the data the builder already reads (`answerCount` per question and per
 * option). One fact is not in that read: whether an "Outro" answer exists. A question that has answers and
 * allows "Outro" is therefore shown locked on, which is the safe side: the admin is never offered a switch the
 * server (`other_locked`) might refuse. The server stays the authority and the 409 alert explains a race.
 */
export function lockFlags(question: AdminQuestion | null): LockFlags {
  if (!question || question.answerCount <= 0) return NO_LOCKS;
  return {
    answerCount: question.answerCount,
    typeLocked: true,
    lockedOptions: new Map(
      question.options.filter((option) => option.answerCount > 0).map((o) => [o.id, o.answerCount]),
    ),
    otherLocked: question.allowOther,
    limitsWidenOnly: isRangeType(question.type),
    visibilityFrozen: !question.showOnProfile,
    visibilityRatchet: question.showOnProfile,
  };
}

/** The stored question as the lock rules see it. */
export function lockDefinitionOf(question: AdminQuestion): LockDefinition {
  return {
    type: question.type,
    showOnProfile: question.showOnProfile,
    allowOther: question.allowOther,
    options: question.options.map(({ id, label }) => ({ id, label })),
    limits: question.limits,
  };
}

/** The draft as the lock rules see it (option labels trimmed, as the server stores them). */
function lockDefinitionOfDraft(draft: QuestionDraft): LockDefinition {
  return {
    type: draft.type ?? '',
    showOnProfile: draft.showOnProfile,
    allowOther: isChoiceType(draft.type) && draft.allowOther,
    options: draft.options.map((option) => ({ id: option.id ?? '', label: option.label.trim() })),
    limits: parseLimits(draft).limits,
  };
}

/**
 * The first lock the draft would break for this stored question, by the mirrored rules. The sheet has no
 * control that can break the first four (they are disabled or read-only); the limits one is real, because the
 * pair is free text, and is turned into the "só é possível ampliar" sentence before any request.
 */
export function draftLock(question: AdminQuestion, draft: QuestionDraft): ProfileFormIssue | null {
  return checkDraftLocks({
    current: lockDefinitionOf(question),
    next: lockDefinitionOfDraft(draft),
    answerCount: question.answerCount,
    answeredOptionIds: question.options.filter((o) => o.answerCount > 0).map((o) => o.id),
    otherAnswered: question.allowOther,
  });
}
