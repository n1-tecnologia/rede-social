import {
  type MemberForm,
  type MemberQuestion,
  missingIssue,
  PROFILE_FORM_LIMITS,
  type ProfileFormIssue,
  type ProfileFormQuestionDef,
  type ProfileFormType,
  parseAnswer,
} from '@rede-social/contracts/profile-form';
import { normalizeLink } from './link';
import { formatNumberPtBr, parseNumberPtBr } from './number';
import { onlyDigits, parseBrazilianPhone } from './phone';
import { visibleQuestionIds } from './visibility';

/**
 * The pure state of the member's completion screen (12-12, D-582, UI-D-582, UI-D-586, UI-D-587).
 *
 * A DRAFT is what a control holds while the member types; the WIRE value is what the contract's
 * `parseAnswer` accepts. Nothing here reads or writes anything outside its arguments: the answers live
 * in the component's state and nowhere else (T-12-30), and the same `parseAnswer` the server runs decides
 * validity, so the screen and the API cannot disagree about a value.
 */

/** A choice question's draft: the ticked options plus the optional "Outro" and its text. */
export type ChoiceDraft = { optionIds: string[]; other: boolean; otherText: string };

/**
 * One control's value. Text-like types hold a string, yes/no and rating hold `null` until chosen,
 * acceptance holds whether the box is ticked, choice types hold a `ChoiceDraft`.
 */
export type Draft = string | boolean | number | null | ChoiceDraft;

export type Answers = Record<string, Draft>;

/** The issues that mean "the member left a required question empty" (they flag it, UI-D-582). */
const MISSING_ISSUES: ReadonlySet<ProfileFormIssue> = new Set([
  'required',
  'not_ticked',
  'other_required',
]);

export function isChoiceDraft(draft: Draft): draft is ChoiceDraft {
  return typeof draft === 'object' && draft !== null;
}

export function isChoiceType(type: ProfileFormType): boolean {
  return type === 'dropdown' || type === 'multiple_choice' || type === 'single_choice';
}

/** The "no answer yet" draft of a type. */
export function emptyDraft(type: ProfileFormType): Draft {
  switch (type) {
    case 'dropdown':
    case 'multiple_choice':
    case 'single_choice':
      return { optionIds: [], other: false, otherText: '' };
    case 'yes_no':
    case 'rating':
      return null;
    case 'acceptance':
      return false;
    default:
      return '';
  }
}

/** The draft a stored answer pre-fills (UI-D-582: the screen is always pre-filled). */
export function draftFromStored(question: MemberQuestion): Draft {
  const stored = question.answer;
  switch (question.type) {
    case 'short_text':
    case 'long_text':
    case 'date':
    case 'phone':
    case 'email':
    case 'link':
      return typeof stored === 'string' ? stored : '';
    case 'number':
      return typeof stored === 'number' ? formatNumberPtBr(stored) : '';
    case 'yes_no':
      return typeof stored === 'boolean' ? stored : null;
    case 'acceptance':
      return stored === true;
    case 'rating':
      return typeof stored === 'number' ? stored : null;
    case 'dropdown':
    case 'single_choice':
    case 'multiple_choice': {
      if (typeof stored !== 'object' || stored === null) return emptyDraft(question.type);
      const optionIds =
        'optionIds' in stored
          ? stored.optionIds
          : 'optionId' in stored && stored.optionId !== null
            ? [stored.optionId]
            : [];
      const otherText = stored.otherText ?? '';
      return { optionIds, other: stored.otherText !== null, otherText };
    }
  }
}

/** The draft of every question of `form`, from the member's stored answers. */
export function initialAnswers(form: Pick<MemberForm, 'questions'>): Answers {
  const answers: Answers = {};
  for (const question of form.questions) answers[question.id] = draftFromStored(question);
  return answers;
}

/** True when the draft holds no answer at all (the question counts as unanswered). */
export function isEmptyDraft(type: ProfileFormType, draft: Draft | undefined): boolean {
  if (draft === undefined || draft === null) return true;
  if (typeof draft === 'string') return draft.trim() === '';
  if (typeof draft === 'boolean') return type === 'acceptance' ? !draft : false;
  if (typeof draft === 'number') return false;
  return draft.optionIds.length === 0 && !draft.other;
}

/** Digits only (`parseBrazilianPhone`); text with no digit at all stays as typed so it is refused. */
function phoneWire(raw: string): string {
  if (raw.trim() === '') return '';
  const digits = onlyDigits(raw);
  return digits === '' ? raw.trim() : parseBrazilianPhone(raw);
}

/** What `parseAnswer` receives for a draft. An empty value is `null` so a required question is `missing`. */
export function toWire(question: Pick<MemberQuestion, 'type'>, draft: Draft | undefined): unknown {
  const value = draft ?? emptyDraft(question.type);
  switch (question.type) {
    case 'short_text':
    case 'long_text':
    case 'date':
    case 'email':
      return typeof value === 'string' && value.trim() !== '' ? value : null;
    case 'link':
      return typeof value === 'string' && value.trim() !== '' ? normalizeLink(value) : null;
    case 'phone':
      return typeof value === 'string' && value.trim() !== '' ? phoneWire(value) : null;
    case 'number':
      if (typeof value !== 'string' || value.trim() === '') return null;
      // A text that is not a number stays text, so `parseAnswer` refuses it (never guessed).
      return parseNumberPtBr(value) ?? value;
    case 'yes_no':
      return typeof value === 'boolean' ? value : null;
    case 'acceptance':
      return value === true ? true : null;
    case 'rating':
      return typeof value === 'number' ? value : null;
    case 'dropdown':
    case 'single_choice': {
      if (!isChoiceDraft(value)) return null;
      const otherText = value.other ? value.otherText : null;
      if (value.other) return { optionId: null, otherText };
      const [optionId] = value.optionIds;
      return optionId === undefined ? null : { optionId, otherText: null };
    }
    case 'multiple_choice': {
      if (!isChoiceDraft(value)) return null;
      return {
        optionIds: value.optionIds,
        otherText: value.other && value.otherText.trim() !== '' ? value.otherText : null,
      };
    }
  }
}

function toDef(question: MemberQuestion): ProfileFormQuestionDef {
  return {
    id: question.id,
    type: question.type,
    required: question.required,
    allowOther: question.allowOther,
    options: question.options,
    limits: question.limits,
  };
}

/**
 * Checks one draft with the contract's validator. `null` means the draft is acceptable (an empty
 * optional question is acceptable).
 */
export function issueFor(
  question: MemberQuestion,
  draft: Draft | undefined,
): ProfileFormIssue | null {
  const value = draft ?? emptyDraft(question.type);
  // "Outro" ticked with no text is a client-only rule: the contract models it as an absent otherText.
  if (isChoiceDraft(value) && value.other && value.otherText.trim() === '') return 'other_required';
  const def = toDef(question);
  const parsed = parseAnswer(def, toWire(question, value));
  if (!parsed.ok) return parsed.issue;
  if (parsed.value === null && question.required) return missingIssue(def);
  return null;
}

/** The five types whose text is judged on blur (UI-D-586): the rest are judged on "Salvar" only. */
const FORMAT_TYPES: ReadonlySet<ProfileFormType> = new Set([
  'number',
  'date',
  'phone',
  'email',
  'link',
]);

export function isFormatType(type: ProfileFormType): boolean {
  return FORMAT_TYPES.has(type);
}

/**
 * The refusal a format control shows when the member leaves it (UI-D-586). It is the contract's
 * `parseAnswer` on the same wire value "Salvar" sends, so the screen and the server cannot disagree. An
 * empty text is never an issue on blur (a required blank is judged on "Salvar"), and the other eight
 * types have no blur rule.
 */
export function validateOnBlur(question: MemberQuestion, rawText: string): ProfileFormIssue | null {
  if (!isFormatType(question.type) || rawText.trim() === '') return null;
  const parsed = parseAnswer(toDef(question), toWire(question, rawText));
  return parsed.ok ? null : parsed.issue;
}

/**
 * The text a format control shows once the member leaves it: a number comes back in pt-BR form as it was
 * parsed (`1.234,5` shows as `1234,5`, `1.5` as `1,5`), a link gets its `https://`. A text the rules
 * refuse is left exactly as typed.
 */
export function settleOnBlur(question: MemberQuestion, rawText: string): string {
  if (rawText.trim() === '') return rawText;
  if (question.type === 'number') {
    const parsed = parseNumberPtBr(rawText);
    return parsed === null ? rawText : formatNumberPtBr(parsed);
  }
  if (question.type === 'link') return normalizeLink(rawText);
  return rawText;
}

/**
 * Every invalid draft, keyed by question id, in the admin's order (UI-D-586). Only the VISIBLE questions are
 * judged (D-631, Pitfall 10): a hidden required question never blocks. `scope` (the question ids of one step)
 * restricts the check to that step; visibility is still read over every question and draft of the form.
 */
export function validateAll(
  questions: readonly MemberQuestion[],
  answers: Answers,
  scope?: ReadonlySet<string>,
): Record<string, ProfileFormIssue> {
  const visible = visibleQuestionIds({ questions }, answers);
  const errors: Record<string, ProfileFormIssue> = {};
  for (const question of questions) {
    if (!visible.has(question.id) || (scope && !scope.has(question.id))) continue;
    const issue = issueFor(question, answers[question.id]);
    if (issue) errors[question.id] = issue;
  }
  return errors;
}

/**
 * The body of the save: every VISIBLE question of the screen (or of `scope`), `null` for a blank one (it
 * clears an optional answer). A hidden question is left out; the server deletes what no longer applies (D-624).
 */
export function wireAnswers(
  questions: readonly MemberQuestion[],
  answers: Answers,
  scope?: ReadonlySet<string>,
): Record<string, unknown> {
  const visible = visibleQuestionIds({ questions }, answers);
  const wire: Record<string, unknown> = {};
  for (const question of questions) {
    if (!visible.has(question.id) || (scope && !scope.has(question.id))) continue;
    wire[question.id] = toWire(question, answers[question.id]);
  }
  return wire;
}

/**
 * The required, visible questions the member has not answered yet, by the STORED answers (returning mode).
 * `scope` restricts the list to the questions of one step.
 */
export function flaggedIds(
  form: Pick<MemberForm, 'questions'>,
  scope?: ReadonlySet<string>,
): string[] {
  const visible = visibleQuestionIds(form);
  return form.questions
    .filter((q) => visible.has(q.id) && (!scope || scope.has(q.id)))
    .filter((q) => q.required && q.answer === null)
    .map((q) => q.id);
}

/** The ids whose errors say "left blank", so a failed save can flag them (first mode flags nothing before). */
export function missingErrorIds(errors: Record<string, ProfileFormIssue>): string[] {
  return Object.entries(errors)
    .filter(([, issue]) => MISSING_ISSUES.has(issue))
    .map(([id]) => id);
}

/** The first question (in the admin's order) that has an error. */
export function firstInvalidId(
  questions: readonly MemberQuestion[],
  errors: Record<string, ProfileFormIssue>,
): string | null {
  return questions.find((question) => errors[question.id] !== undefined)?.id ?? null;
}

function keepSurvivingOptions(draft: ChoiceDraft, question: MemberQuestion): ChoiceDraft {
  const known = new Set(question.options.map((option) => option.id));
  const optionIds = draft.optionIds.filter((id) => known.has(id));
  return question.allowOther
    ? { optionIds, other: draft.other, otherText: draft.otherText }
    : { optionIds, other: false, otherText: '' };
}

export type MergedForm = {
  form: MemberForm;
  answers: Answers;
  /** Questions that are required now and were not before (new, or made required) and are still blank. */
  flagged: string[];
};

/**
 * A 409 `form_changed` carries the fresh form (UI-D-587): the question list is replaced in place, the typed
 * drafts of the questions that still exist (same id and type) are KEPT, the ones that went away are dropped,
 * a new or retyped question starts from its stored answer, and any newly required, still blank question is
 * flagged. The order is the fresh form's, so a new question appears where the admin put it. 12.1: the fresh
 * form carries `stepId`, `condition` and `steps`, and a hidden question is never flagged (D-631).
 */
export function mergeFreshForm(
  current: Pick<MemberForm, 'questions'>,
  answers: Answers,
  fresh: MemberForm,
  scope?: ReadonlySet<string>,
): MergedForm {
  const before = new Map(current.questions.map((question) => [question.id, question]));
  const merged: Answers = {};
  const candidates: string[] = [];
  for (const question of fresh.questions) {
    const previous = before.get(question.id);
    const sameType = previous !== undefined && previous.type === question.type;
    const draft = sameType ? answers[question.id] : undefined;
    const next = draft === undefined ? draftFromStored(question) : draft;
    merged[question.id] =
      isChoiceDraft(next) && isChoiceType(question.type)
        ? keepSurvivingOptions(next, question)
        : next;
    const newlyRequired = question.required && (previous === undefined || !previous.required);
    if (newlyRequired && isEmptyDraft(question.type, merged[question.id]))
      candidates.push(question.id);
  }
  // A hidden question never blocks (D-631): only the ones the merged drafts leave visible are flagged.
  const visible = visibleQuestionIds(fresh, merged);
  const flagged = candidates.filter((id) => visible.has(id) && (!scope || scope.has(id)));
  return { form: fresh, answers: merged, flagged };
}

/** A catalog key under `profileForm.member` plus its interpolation values. */
export type MessageSpec = { key: string; values?: Record<string, string | number> };

function formatLimit(question: MemberQuestion, value: number | string | undefined) {
  if (value === undefined) return undefined;
  if (question.type === 'date' && typeof value === 'string') {
    return value.split('-').reverse().join('/');
  }
  return typeof value === 'number' ? new Intl.NumberFormat('pt-BR').format(value) : String(value);
}

/** "Entre {min} e {max}.", "A partir de {min}.", "Até {max}." for a number or date question (UI-D-584). */
export function limitHint(question: MemberQuestion): MessageSpec | null {
  if (question.type !== 'number' && question.type !== 'date') return null;
  const min = formatLimit(question, question.limits.min);
  const max = formatLimit(question, question.limits.max);
  if (min !== undefined && max !== undefined)
    return { key: 'controls.between', values: { min, max } };
  if (min !== undefined) return { key: 'controls.from', values: { min } };
  if (max !== undefined) return { key: 'controls.until', values: { max } };
  return null;
}

function rangeSpec(question: MemberQuestion, kind: 'number' | 'date'): MessageSpec {
  const min = formatLimit(question, question.limits.min);
  const max = formatLimit(question, question.limits.max);
  if (min !== undefined && max !== undefined) {
    return { key: `errors.${kind}Range`, values: { min, max } };
  }
  if (min !== undefined) return { key: `errors.${kind}Min`, values: { min } };
  if (max !== undefined) return { key: `errors.${kind}Max`, values: { max } };
  return { key: `errors.${kind}Invalid` };
}

/** The pt-BR sentence (catalog key and values) that explains an issue on a question (UI-D-586). */
export function errorSpec(question: MemberQuestion, issue: ProfileFormIssue): MessageSpec {
  const { type } = question;
  switch (issue) {
    case 'required':
      if (type === 'dropdown' || type === 'single_choice') return { key: 'errors.choice' };
      if (type === 'multiple_choice') return { key: 'errors.multiple' };
      return { key: 'errors.required' };
    case 'not_ticked':
      return { key: 'errors.acceptance' };
    case 'unknown_option':
      return { key: type === 'multiple_choice' ? 'errors.multiple' : 'errors.choice' };
    case 'other_required':
      return { key: 'errors.otherRequired' };
    case 'too_long':
      if (type === 'short_text') {
        return { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.shortText } };
      }
      if (type === 'long_text') {
        return { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.longText } };
      }
      if (isChoiceType(type)) {
        return { key: 'errors.tooLong', values: { max: PROFILE_FORM_LIMITS.otherText } };
      }
      if (type === 'email') return { key: 'errors.email' };
      if (type === 'link') return { key: 'errors.link' };
      return { key: 'errors.generic' };
    case 'out_of_range':
      if (type === 'number') return rangeSpec(question, 'number');
      if (type === 'date') return rangeSpec(question, 'date');
      return { key: 'errors.generic' };
    case 'invalid':
      if (type === 'number') return { key: 'errors.numberInvalid' };
      if (type === 'date') return { key: 'errors.dateInvalid' };
      if (type === 'phone') return { key: 'errors.phone' };
      if (type === 'email') return { key: 'errors.email' };
      if (type === 'link') return { key: 'errors.link' };
      return { key: 'errors.generic' };
    default:
      return { key: 'errors.generic' };
  }
}
