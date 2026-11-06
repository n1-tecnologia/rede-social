import {
  type AdminQuestion,
  type AdminStep,
  codePoints,
  type Dependent,
  normalizeOptionLabel,
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
  type ProfileFormLimits,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import {
  type ConditionDescription,
  formatDisjunction,
} from '@/lib/profile-form/describe-condition';
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

/**
 * The draft of a condition (12.1-17, D-620..D-622): one opener and the tokens that open the question. While the
 * switch is on and no opener is chosen yet, `questionId` is the empty string and `values` is empty; the draft
 * `null` means "always shown". A token is an option id for a choice opener, `'true'` or `'false'` for yes/no.
 */
export interface DraftCondition {
  questionId: string;
  values: string[];
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
  /** The step the question sits in (12.1-17, D-627); `null` while the form has no step the sheet knows. */
  stepId: string | null;
  /** The condition that shows the question, or `null` for an always-shown one (D-621). */
  condition: DraftCondition | null;
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
export function blankDraft(stepId: string | null = null): QuestionDraft {
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
    stepId,
    condition: null,
  };
}

/** A condition copied, so a draft never shares its array with the stored question. */
export function copyCondition(condition: DraftCondition | null): DraftCondition | null {
  return condition === null
    ? null
    : { questionId: condition.questionId, values: [...condition.values] };
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
    stepId: question.stepId,
    condition: copyCondition(question.condition),
  };
}

/**
 * The draft of a replacement (UI-D-574): the old title, help text, `required` and `showOnProfile` are
 * copied, and so are the step and the condition (12.1-17, UI-D-647), so the admin picks the new type from an
 * open grid. The old answers are not read.
 */
export function replaceDraftFrom(question: AdminQuestion): QuestionDraft {
  return {
    ...blankDraft(question.stepId),
    condition: copyCondition(question.condition),
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
  /** Present only when the draft names a step (12.1-17); absent means the last step (D-629). */
  stepId?: string;
  /** Present only for a conditional question (12.1-17); a replacement does not inherit one (plan 10). */
  condition?: DraftCondition;
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
    ...(draft.stepId ? { stepId: draft.stepId } : {}),
    ...(draft.condition
      ? {
          condition: {
            questionId: draft.condition.questionId,
            values: [...draft.condition.values],
          },
        }
      : {}),
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
  /** The step the question moves to (12.1-17); absent when it stays. */
  stepId?: string;
  /** The new condition, or `null` to remove it (D-625); absent when it is unchanged. */
  condition?: DraftCondition | null;
}

/** Two conditions name the same opener and the same SET of tokens (the order of the tokens is not a change). */
export function sameCondition(a: DraftCondition | null, b: DraftCondition | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.questionId !== b.questionId || a.values.length !== b.values.length) return false;
  const wanted = new Set(b.values);
  return a.values.every((value) => wanted.has(value));
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

  if (draft.stepId !== null && draft.stepId !== question.stepId) body.stepId = draft.stepId;
  if (!sameCondition(draft.condition, question.condition)) {
    body.condition = copyCondition(draft.condition);
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
    stepId: draft.stepId,
    condition: draft.condition,
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
  /** No opener chosen while the condition switch is on (12.1-17, UI-D-648). */
  conditionOpener?: FieldError;
  /** An opener chosen and no answer ticked. */
  conditionValues?: FieldError;
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
  Object.assign(errors, validateCondition(draft));
  return errors;
}

/**
 * The two rules of a switched-on condition (UI-D-648): an opener is chosen, and at least one answer opens the
 * question. Nothing is said while the switch is off. The server repeats every rule (`condition_invalid`).
 */
export function validateCondition(
  draft: Pick<QuestionDraft, 'condition'>,
): Pick<DraftErrors, 'conditionOpener' | 'conditionValues'> {
  const { condition } = draft;
  if (condition === null) return {};
  if (condition.questionId === '') return { conditionOpener: { key: 'condition.errors.opener' } };
  if (condition.values.length === 0) return { conditionValues: { key: 'condition.errors.values' } };
  return {};
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
  change: 'create_required' | 'make_required' | 'replace' | 'remove_condition';
  /** The dialog's case (its title and confirm label). */
  kind: 'add' | 'make' | 'replace' | 'unconditional';
  questionId?: string;
  /**
   * The condition the NEW question will have (a create or a replace, 12.1-17, D-634): the impact then counts only
   * the members who would see it. Present only when the draft's condition is complete.
   */
  condition?: DraftCondition;
}

/** The draft's condition when it names an opener and at least one answer; a half-made one counts as none. */
function completeCondition(
  condition: DraftCondition | null | undefined,
): DraftCondition | undefined {
  return condition != null && condition.questionId !== '' && condition.values.length > 0
    ? (copyCondition(condition) ?? undefined)
    : undefined;
}

/**
 * Whether saving this draft REOPENS the form (D-585, D-634, UI-D-576, UI-D-649): a new required question, an
 * optional question turned required, a replacement that is required, or the removal of the condition of a
 * question that stays required (members who do not see it today will owe an answer). Making a required
 * question optional, editing anything else, or replacing with an optional one frees members and needs no count.
 * A create and a replace carry the condition the new question will have, so the count is of who would see it.
 */
export function reopeningOf(
  mode: EditorMode,
  draft: Pick<QuestionDraft, 'required'> & { condition?: DraftCondition | null },
  question: { id: string; required: boolean; condition?: DraftCondition | null } | null,
): Reopening | null {
  if (!draft.required) return null;
  const condition = completeCondition(draft.condition);
  if (mode === 'create') {
    return { change: 'create_required', kind: 'add', ...(condition ? { condition } : {}) };
  }
  if (!question) return null;
  if (mode === 'replace') {
    return {
      change: 'replace',
      kind: 'replace',
      questionId: question.id,
      ...(condition ? { condition } : {}),
    };
  }
  if (!question.required) return { change: 'make_required', kind: 'make', questionId: question.id };
  if (question.condition && draft.condition == null) {
    return { change: 'remove_condition', kind: 'unconditional', questionId: question.id };
  }
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

// ── 12.1-17: where a question sits and what can open it (D-620..D-623, UI-D-647, UI-D-648) ────────

/**
 * The active questions in the order members see them: the steps in order, each holding its questions in list
 * order. A question of a step the list does not know rides with the last step (the API puts every question in
 * one, so this never hides a row). With no step known the list is returned as it came.
 */
export function layoutOrder(
  questions: readonly AdminQuestion[],
  steps: readonly AdminStep[],
): AdminQuestion[] {
  if (steps.length === 0) return [...questions];
  const known = new Set(steps.map((step) => step.id));
  const last = steps[steps.length - 1];
  return steps.flatMap((step) =>
    questions.filter(
      (question) => question.stepId === step.id || (step === last && !known.has(question.stepId)),
    ),
  );
}

/** A step id to its place in the form, 0-based. */
function stepRanks(steps: readonly AdminStep[]): Map<string, number> {
  return new Map(steps.map((step, at) => [step.id, at] as const));
}

/** The one list of types that can open a question lives in the contract (D-620); this only reads it. */
const OPENER_TYPES: readonly string[] = PROFILE_FORM_CONDITION_OPENER_TYPES;

/** Whether a question of this type can decide whether another one shows (D-620). */
export function isOpenerType(type: string): boolean {
  return OPENER_TYPES.includes(type);
}

/** What `eligibleOpeners` needs to know about the question being edited and where it will sit. */
export interface OpenerScope {
  /** The ACTIVE questions the builder holds, in the API's order. */
  questions: readonly AdminQuestion[];
  steps: readonly AdminStep[];
  /** The question being edited, or the one being replaced (never its own opener); `null` for a new one. */
  selfId: string | null;
  /** Where the edited question sits today; `null` for a new or replaced one, which land at the end of a step. */
  storedStepId: string | null;
  /** The step the draft names (`null` means the last step, D-629). */
  stepId: string | null;
}

/**
 * The questions the editor may offer as the opener (D-620, D-622, D-623, UI-D-648): ACTIVE (the list holds
 * nothing else), of a type that can open, carrying NO condition, never the question itself, and EARLIER in the
 * form than it: an earlier step, or the same step at an earlier position. A question that keeps its step is
 * measured at its place; one that moves, or a new one, goes to the END of its step, so every question of that
 * step and of the steps before it comes first. The server (`checkCondition`) is the authority; this only
 * keeps the editor from offering what it would refuse (T-12.1-01).
 */
export function eligibleOpeners(scope: OpenerScope): AdminQuestion[] {
  const { questions, steps, selfId, storedStepId, stepId } = scope;
  const ordered = layoutOrder(questions, steps);
  const stays = storedStepId !== null && (stepId === null || stepId === storedStepId);

  let before: AdminQuestion[];
  if (stays && selfId !== null) {
    const at = ordered.findIndex((question) => question.id === selfId);
    before = at === -1 ? ordered : ordered.slice(0, at);
  } else if (steps.length > 0) {
    const ranks = stepRanks(steps);
    const lastRank = steps.length - 1;
    const target = stepId === null ? lastRank : (ranks.get(stepId) ?? lastRank);
    before = ordered.filter((question) => (ranks.get(question.stepId) ?? lastRank) <= target);
  } else {
    before = ordered;
  }
  return before.filter(
    (question) =>
      question.id !== selfId &&
      question.condition === null &&
      isOpenerType(question.type) &&
      // The list holds ACTIVE questions only; an archived row that slipped in is never an opener.
      !('archivedAt' in question),
  );
}

/** What a change of the step field does (UI-D-647). */
export type StepChange =
  | { kind: 'ok'; clearOpener: boolean }
  | { kind: 'mustFollow'; opener: string }
  | { kind: 'mustPrecede'; dependent: string };

/**
 * D-623 for a change of the step field. A question lands at the END of its new step, so: its stored opener
 * must sit in that step or an earlier one (otherwise the field snaps back, `mustFollow`); and a dependent of
 * it must sit in a LATER step than the new one (otherwise `mustPrecede`: at the end of the dependent's step it
 * would come after it). A draft opener that the new step no longer allows, and that is not the stored
 * condition, is only cleared (`clearOpener`), with the polite note. Moving back to the step it already has
 * is never a change.
 */
export function checkStepChange(input: {
  questions: readonly AdminQuestion[];
  steps: readonly AdminStep[];
  /** The question being edited; `null` for a new or replaced one. */
  stored: AdminQuestion | null;
  condition: DraftCondition | null;
  nextStepId: string;
}): StepChange {
  const { questions, steps, stored, condition, nextStepId } = input;
  if (stored && nextStepId === stored.stepId) return { kind: 'ok', clearOpener: false };
  const ranks = stepRanks(steps);
  const lastRank = steps.length - 1;
  const rankOf = (id: string) => ranks.get(id) ?? lastRank;
  const next = rankOf(nextStepId);

  if (stored) {
    const dependent = questions.find(
      (question) => question.condition?.questionId === stored.id && rankOf(question.stepId) <= next,
    );
    if (dependent) return { kind: 'mustPrecede', dependent: dependent.title };
  }

  if (condition !== null && condition.questionId !== '') {
    const opener = questions.find((question) => question.id === condition.questionId);
    if (opener && rankOf(opener.stepId) > next) {
      return stored?.condition?.questionId === opener.id
        ? { kind: 'mustFollow', opener: opener.title }
        : { kind: 'ok', clearOpener: true };
    }
  }
  return { kind: 'ok', clearOpener: false };
}

/** The words of the sentence for a yes/no opener (the catalog's, never typed here). */
export interface YesNoWords {
  yes: string;
  no: string;
}

/**
 * The `{options}` of "Só aparece se “{opener}” for {options}." (D-621, UI-D-650): the quoted option labels as a
 * pt-BR disjunction, or for a yes/no opener the plain words, unquoted. Empty when the condition names no
 * option the opener still has (the caller then leaves the sentence out rather than print half of it).
 */
export function conditionOptionsText(description: ConditionDescription, words: YesNoWords): string {
  if (!description.yesNo) {
    return description.labels.length === 0 ? '' : formatDisjunction(description.labels);
  }
  const plain = description.values.map((value) => (value === 'true' ? words.yes : words.no));
  return new Intl.ListFormat('pt-BR', { type: 'disjunction' }).format(plain);
}

/** The questions a condition can name, in the shape `describeCondition` reads. */
export function openerIndex(questions: readonly AdminQuestion[]) {
  return new Map(
    questions.map(
      (question) =>
        [
          question.id,
          { title: question.title, type: question.type, options: question.options },
        ] as const,
    ),
  );
}

// ── 12.1-17: the opener side (D-632, UI-D-650, UI-D-651) ───────────────────────────────────────────

/**
 * The ACTIVE questions that name `openerId` as their opener, with their titles, in form order. The client's
 * mirror of the 12.1 server rule `dependentsOf` (retired in 12.2, now `dependentBranchesOf` in `branch-rules.ts`) over `AdminQuestion.condition`, so a refusal can be shown
 * without a round trip. The server (`checkOpenerChange`) stays the authority: it answers 409 `has_dependents`
 * with its own list when the page was stale (D-632, T-12.1-02).
 */
export function dependentsOf(questions: readonly AdminQuestion[], openerId: string): Dependent[] {
  return layoutOrder(questions, []).flatMap((question) =>
    question.condition?.questionId === openerId ? [{ id: question.id, title: question.title }] : [],
  );
}

/** Option id to the number of ACTIVE questions whose condition names that option of `openerId`. */
export function optionUsage(
  questions: readonly AdminQuestion[],
  openerId: string,
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const question of questions) {
    if (question.condition?.questionId !== openerId) continue;
    for (const value of question.condition.values) usage.set(value, (usage.get(value) ?? 0) + 1);
  }
  return usage;
}

/** What the dependents alert is about: the edit the opener refuses (UI-D-651). */
export type RefusalKind = 'archive' | 'delete' | 'type' | 'option';

/** A refusal to show: the kind, the questions that block it and, for an option, the option's label. */
export interface DependentsRefusal {
  kind: RefusalKind;
  dependents: Dependent[];
  label?: string;
}

/**
 * The refusal a server `has_dependents` 409 stands for, from what the save was changing (UI-D-651): a new type
 * is a retype; otherwise it is an option that left the list, named by its LABEL (the first one a dependent's
 * condition uses, else the first removed). `null` when the save removed nothing that explains it.
 */
export function refusalOfUpdate(
  question: AdminQuestion,
  draft: QuestionDraft,
  dependents: Dependent[],
  questions: readonly AdminQuestion[],
): DependentsRefusal | null {
  if (dependents.length === 0) return null;
  if (draft.type !== question.type) return { kind: 'type', dependents };
  const kept = new Set(draft.options.flatMap((option) => (option.id ? [option.id] : [])));
  const removed = question.options.filter((option) => !kept.has(option.id));
  if (removed.length === 0) return null;
  const used = optionUsage(questions, question.id);
  const named = removed.find((option) => used.has(option.id)) ?? removed[0];
  return { kind: 'option', dependents, label: named?.label ?? '' };
}
