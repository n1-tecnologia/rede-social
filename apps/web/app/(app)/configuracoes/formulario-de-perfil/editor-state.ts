import {
  type AdminBranch,
  type AdminQuestion,
  type AdminStep,
  codePoints,
  type Dependent,
  type HasDependentsDetails,
  normalizeOptionLabel,
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
  type ProfileFormLimits,
  type ProfileFormType,
} from '@rede-social/contracts/profile-form';
import {
  type AdminBranchTree,
  buildBranchTree,
  type EligibilityQuestion,
  eligibleBranchesFor,
  membersOf,
  referencedOptionCounts,
  usableBranch,
  usableBranchesOf,
} from '@/lib/profile-form/branch-tree';
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
  /**
   * The branch the question sits in (12.2-16, D-640, D-651), or `null` for an unconditional one. The condition
   * that shows a question is the BRANCH's: the draft only knows which branch it is in.
   */
  branchId: string | null;
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

/**
 * The draft of a question that does not exist yet: no type, nothing typed, two empty rows. `branchId` presets
 * the branch it starts in (the Lista footer "Adicionar pergunta ao ramo", D-651).
 */
export function blankDraft(
  stepId: string | null = null,
  branchId: string | null = null,
): QuestionDraft {
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
    branchId,
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
    stepId: question.stepId,
    branchId: question.branchId ?? null,
  };
}

/**
 * The draft of a replacement (UI-D-574): the old title, help text, `required` and `showOnProfile` are
 * copied, and so are the step and the branch (12.2-16, UI-D-669), so the admin picks the new type from an
 * open grid. The old answers are not read.
 */
export function replaceDraftFrom(question: AdminQuestion): QuestionDraft {
  return {
    ...blankDraft(question.stepId, question.branchId ?? null),
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
  /** Present only for a question inside a branch (12.2-16, D-640); absent means unconditional. */
  branchId?: string;
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
    ...(draft.branchId ? { branchId: draft.branchId } : {}),
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
  /** The new branch, or `null` to leave its branch (12.2-16, D-646); absent when it is unchanged. */
  branchId?: string | null;
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
  if (draft.branchId !== (question.branchId ?? null)) body.branchId = draft.branchId;
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
    branchId: draft.branchId,
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
  change: 'create_required' | 'make_required' | 'replace' | 'remove_condition';
  /** The dialog's case (its title and confirm label). */
  kind: 'add' | 'make' | 'replace' | 'unconditional';
  questionId?: string;
  /**
   * The branch the NEW question will sit in (a create or a replace, 12.2-16, D-634): the impact then counts only
   * the members for whom that branch's whole chain is open.
   */
  branchId?: string;
}

/**
 * Whether saving this draft REOPENS the form (D-585, D-634, UI-D-576, UI-D-649): a new required question, an
 * optional question turned required, a replacement that is required, or a required question that LEAVES its
 * branch (members who do not see it today will owe an answer). Making a required question optional, editing
 * anything else, entering a branch (fewer members owe it) or replacing with an optional one frees members and
 * needs no count. A create and a replace carry the branch the new question will sit in, so the count is of who
 * would see it.
 */
export function reopeningOf(
  mode: EditorMode,
  draft: Pick<QuestionDraft, 'required'> & { branchId?: string | null },
  question: { id: string; required: boolean; branchId?: string | null } | null,
): Reopening | null {
  if (!draft.required) return null;
  const branch = draft.branchId ? { branchId: draft.branchId } : {};
  if (mode === 'create') return { change: 'create_required', kind: 'add', ...branch };
  if (!question) return null;
  if (mode === 'replace') {
    return { change: 'replace', kind: 'replace', questionId: question.id, ...branch };
  }
  if (!question.required) return { change: 'make_required', kind: 'make', questionId: question.id };
  if (question.branchId && !draft.branchId) {
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

/** The one list of types that can open a question lives in the contract (D-620); this only reads it. */
const OPENER_TYPES: readonly string[] = PROFILE_FORM_CONDITION_OPENER_TYPES;

/** Whether a question of this type can decide whether another one shows (D-620). */
export function isOpenerType(type: string): boolean {
  return OPENER_TYPES.includes(type);
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

// ── 12.2-18: the opener side over branches (D-646, UI-D-673) ──────────────────────────────────────

/** A branch as the server's 409 `has_dependents` lists it (D-646): label parts and the titles of its questions. */
export type DependentBranchWire = NonNullable<HasDependentsDetails['branches']>[number];

/** One branch that blocks an edit of its opener: its label and the titles of its ACTIVE questions. */
export interface DependentGroup {
  id: string;
  label: string;
  questions: Dependent[];
}

/**
 * The ACTIVE branches that hang on `openerId`, each with the titles of the ACTIVE questions in it, in list order
 * (D-646, UI-D-673): the client's mirror of the server's `dependentBranchesOf`, so a refusal can be shown without
 * a round trip. A branch with no question is still listed (it blocks the same), with an empty `questions`. The
 * server stays the authority: it answers 409 `has_dependents` with its own list when the page was stale.
 */
export function dependentBranchesOf(
  tree: AdminBranchTree,
  openerId: string,
  labelOf: (branch: AdminBranch) => string,
): DependentGroup[] {
  return usableBranchesOf(tree, openerId).map((branch) => ({
    id: branch.id,
    label: labelOf(branch),
    questions: membersOf(tree, branch.id).map((member) => ({ id: member.id, title: member.title })),
  }));
}

/**
 * The groups a server `has_dependents` 409 stands for (a race). The label is built from what the SERVER sent
 * (name, opener, answers), which is fresher than the page's copy; a branch the page does not know yet still gets
 * its sentence, because the opener is on the page. Only ids, names and titles are read, never an answer.
 */
export function groupsFromServer(
  branches: readonly DependentBranchWire[],
  tree: AdminBranchTree,
  labelOf: (branch: AdminBranch) => string,
): DependentGroup[] {
  return branches.map((wire) => {
    const known = tree.branchById.get(wire.id);
    const asBranch: AdminBranch = {
      id: wire.id,
      openerQuestionId: wire.openerQuestionId,
      values: wire.values,
      name: wire.name,
      revision: known?.revision ?? 1,
      archivedAt: null,
      questionCount: wire.questions.length,
      answerCount: known?.answerCount ?? 0,
    };
    return { id: wire.id, label: labelOf(asBranch), questions: wire.questions };
  });
}

/** Option token to the number of ACTIVE branches whose opening set holds it ("Abre N ramos", D-646). */
export function optionUsage(tree: AdminBranchTree, openerId: string): Map<string, number> {
  return referencedOptionCounts(tree, openerId);
}

/** What the dependents alert is about: the edit the opener refuses, or the privacy rule (UI-D-673, UI-D-675). */
export type RefusalKind = 'archive' | 'delete' | 'type' | 'option' | 'privacy';

/** A refusal to show: the kind, the branches (or titles) that block it and, for an option, the option's label. */
export interface DependentsRefusal {
  kind: RefusalKind;
  groups?: DependentGroup[];
  dependents?: Dependent[];
  label?: string;
}

/**
 * The refusal a server `has_dependents` 409 stands for, from what the save was changing (UI-D-673): a new type is
 * a retype; otherwise it is an option that left the list, named by its LABEL (the first one a branch names, else
 * the first removed). `null` when there is no group or the save removed nothing that explains it.
 */
export function refusalOfUpdate(
  question: AdminQuestion,
  draft: QuestionDraft,
  groups: DependentGroup[],
  tree: AdminBranchTree,
): DependentsRefusal | null {
  if (groups.length === 0) return null;
  if (draft.type !== question.type) return { kind: 'type', groups };
  const kept = new Set(draft.options.flatMap((option) => (option.id ? [option.id] : [])));
  const removed = question.options.filter((option) => !kept.has(option.id));
  if (removed.length === 0) return null;
  const used = optionUsage(tree, question.id);
  const named = removed.find((option) => used.has(option.id)) ?? removed[0];
  return { kind: 'option', groups, label: named?.label ?? '' };
}

// ── 12.2-18: the privacy rule in the builder (WR-06, PFORM-53, UI-D-675) ───────────────────────────

/**
 * The title of the NEAREST opener on the chain of `branchId` that does not show on the member profile, or `null`
 * (RED stub of 12.2-18: inert until the GREEN commit).
 */
export function privateOpenerOf(_tree: AdminBranchTree, _branchId: string | null): string | null {
  return null;
}

/** A change the privacy pre-check judges: a question's own switch, or the opener of a branch. */
export type PrivacyChange =
  | { questionId: string; showOnProfile: boolean }
  | { branchId: string; openerQuestionId: string };

/**
 * The titles of the questions that show on the profile and would newly sit under a private opener if `change`
 * were saved (RED stub of 12.2-18: inert until the GREEN commit).
 */
export function privacyTitlesIf(_tree: AdminBranchTree, _change: PrivacyChange): string[] {
  return [];
}

// ── 12.2-16: where a question sits in the tree (D-640, D-641, D-644, D-646, UI-D-669) ──────────────

/** One group of the "Ramo" select: the branches that hang on one opener. */
export interface BranchOptionGroup {
  opener: AdminQuestion;
  branches: AdminBranch[];
}

/**
 * The groups of the "Ramo" select (UI-D-669): the branches `eligibleBranchesFor` offers, grouped by their opener
 * in form order and, inside a group, in list order. `keep` is the branch the question already sits in: it is
 * listed even when it is no longer offered (archived, or past a rule since), so the select always shows the
 * truth instead of silently reading "Nenhum". `leftOutForPrivacy` says at least one branch was left out only
 * because the question shows on the profile (the second helper line).
 */
export function branchOptionsFor(
  question: EligibilityQuestion,
  tree: AdminBranchTree,
  keep: string | null = null,
): { groups: BranchOptionGroup[]; leftOutForPrivacy: boolean } {
  const { branches, leftOutForPrivacy } = eligibleBranchesFor(question, tree);
  const offered = [...branches];
  if (keep !== null && !offered.some((branch) => branch.id === keep)) {
    const kept = tree.branchById.get(keep);
    if (kept !== undefined) offered.push(kept);
  }
  const byOpener = new Map<string, AdminBranch[]>();
  for (const branch of offered) {
    const list = byOpener.get(branch.openerQuestionId) ?? [];
    list.push(branch);
    byOpener.set(branch.openerQuestionId, list);
  }
  const listIndex = (branch: AdminBranch) => tree.branches.indexOf(branch);
  const groups: BranchOptionGroup[] = [];
  for (const [openerId, list] of byOpener) {
    const opener = tree.questionById.get(openerId);
    if (opener === undefined) continue;
    groups.push({ opener, branches: list.sort((a, b) => listIndex(a) - listIndex(b)) });
  }
  const place = (group: BranchOptionGroup) =>
    tree.flatIndex.get(group.opener.id) ?? Number.MAX_SAFE_INTEGER;
  groups.sort((a, b) => place(a) - place(b));
  return { groups, leftOutForPrivacy };
}

/** What a change of the step field does once the condition is a branch (D-623, UI-D-647). */
export type StepMove =
  | { kind: 'ok'; clearBranch: boolean }
  | { kind: 'mustFollow'; opener: string }
  | { kind: 'mustPrecede'; dependent: string };

/**
 * D-623 for a change of the step field, judged over branches. A question lands at the END of its new step, so:
 * a question that SITS in a branch must go to the step of that branch's opener or a later one (otherwise the
 * field snaps back, `mustFollow`, naming the opener); and an OPENER must go to a step BEFORE every question of
 * the branches it opens (otherwise `mustPrecede`, naming the first such question). A branch the draft chose but
 * the question does not yet sit in, and that the new step no longer allows, is only cleared (`clearBranch`).
 * Moving back to the step it already has is never a change. The server (`condition_order`) is the authority.
 */
export function checkStepMove(input: {
  questions: readonly AdminQuestion[];
  steps: readonly AdminStep[];
  branches?: readonly AdminBranch[];
  /** The question being edited; `null` for a new or replaced one. */
  stored: AdminQuestion | null;
  /** The branch the draft names. */
  branchId: string | null;
  nextStepId: string;
}): StepMove {
  const { questions, steps, stored, branchId, nextStepId } = input;
  if (stored && nextStepId === stored.stepId) return { kind: 'ok', clearBranch: false };
  const tree = buildBranchTree({ steps, questions, branches: input.branches });
  const last = Math.max(steps.length - 1, 0);
  const rankOf = (id: string) => (tree.stepOrdinal.get(id) ?? last + 1) - 1;
  const next = rankOf(nextStepId);

  if (stored) {
    for (const branch of usableBranchesOf(tree, stored.id)) {
      const dependent = membersOf(tree, branch.id).find((member) => rankOf(member.stepId) <= next);
      if (dependent) return { kind: 'mustPrecede', dependent: dependent.title };
    }
  }

  const chosen = usableBranch(tree, branchId);
  if (chosen !== undefined) {
    const opener = tree.questionById.get(chosen.openerQuestionId);
    if (opener !== undefined && rankOf(opener.stepId) > next) {
      return (stored?.branchId ?? null) === chosen.id
        ? { kind: 'mustFollow', opener: opener.title }
        : { kind: 'ok', clearBranch: true };
    }
  }
  return { kind: 'ok', clearBranch: false };
}
