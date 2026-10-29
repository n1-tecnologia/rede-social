import { z } from 'zod';

/**
 * The profile form contract (Phase 12, D-590, D-591, D-592): the thirteen question types, one constant
 * per limit, the closed list of refusal codes and `parseAnswer`, the single place that decides whether a
 * raw value is a valid answer to a question.
 *
 * Trust rule (T-12-05): the validator is built from the STORED question only (its type, options, limits
 * and `allowOther`). A caller never tells `parseAnswer` what type a value is.
 */

/**
 * The thirteen question types, in this exact order. The `type` CHECK of `profile_form_questions` is
 * generated from this list, so a new type is appended LAST (the generated CHECK keeps the list's order)
 * and is one new variant of `answerValueSchema` plus, at most, a widening of that CHECK (D-591).
 */
export const PROFILE_FORM_TYPES = [
  'short_text',
  'long_text',
  'dropdown',
  'multiple_choice',
  'single_choice',
  'number',
  'date',
  'phone',
  'email',
  'link',
  'yes_no',
  'acceptance',
  'rating',
] as const;
export type ProfileFormType = (typeof PROFILE_FORM_TYPES)[number];

/** The three types that carry options and the optional "Outro" (D-592). */
export const PROFILE_FORM_CHOICE_TYPES = ['dropdown', 'multiple_choice', 'single_choice'] as const;
export type ProfileFormChoiceType = (typeof PROFILE_FORM_CHOICE_TYPES)[number];

/** What the member form is doing right now (the `mode` of `GET /v1/me/profile-form`). */
export const PROFILE_FORM_MODES = ['none', 'first', 'returning', 'edit'] as const;
export type ProfileFormMode = (typeof PROFILE_FORM_MODES)[number];

/**
 * Every limit of the form, one constant each. Lengths are in Unicode code points after trimming (an
 * emoji is one). The database CHECKs of the questions and answers tables read these same numbers.
 */
export const PROFILE_FORM_LIMITS = {
  /** Active (non-archived) questions per tenant. */
  activeQuestions: 30,
  /** Options per choice question, "Outro" not counted. */
  options: 20,
  title: 120,
  helpText: 300,
  optionLabel: 80,
  otherText: 120,
  shortText: 120,
  longText: 1000,
  /** One stored answer value, as `octet_length(value::text)`. */
  valueBytes: 4096,
} as const;

/**
 * The closed refusal vocabulary. The web maps each code to a pt-BR string; nothing else travels.
 * Field level codes answer a member's value; admin level codes answer a builder write.
 */
export const PROFILE_FORM_ISSUES = [
  // field level
  'required',
  'not_ticked',
  'too_long',
  'invalid',
  'out_of_range',
  'unknown_option',
  'other_required',
  'other_not_allowed',
  'unknown_question',
  // admin level
  'stale_revision',
  'type_locked',
  'option_locked',
  'other_locked',
  'visibility_locked',
  'limits_locked',
  'has_answers',
  'limit_reached',
  'order_mismatch',
  'form_changed',
  'not_archived',
  'already_archived',
] as const;
export type ProfileFormIssue = (typeof PROFILE_FORM_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.profileForm`. */
export const PROFILE_FORM_ISSUE_SET: ReadonlySet<string> = new Set(PROFILE_FORM_ISSUES);

/** A question as the validator needs it: only what the database stores. */
export type ProfileFormQuestionDef = {
  id: string;
  type: ProfileFormType;
  required: boolean;
  allowOther: boolean;
  options: { id: string; label: string }[];
  /** `min` and `max` are numbers for a number question and ISO days for a date question. */
  limits: { min?: number | string; max?: number | string };
};

export type ParseAnswerResult =
  | { ok: true; value: unknown | null }
  | { ok: false; issue: ProfileFormIssue };

const ok = (value: unknown | null): ParseAnswerResult => ({ ok: true, value });
const fail = (issue: ProfileFormIssue): ParseAnswerResult => ({ ok: false, issue });

/** Length in Unicode code points (an emoji is one). */
export const codePoints = (value: string): number => Array.from(value).length;

/** The duplicate rule for option labels: trim, Unicode NFC, then pt-BR lower case. */
export function normalizeOptionLabel(label: string): string {
  return label.trim().normalize('NFC').toLocaleLowerCase('pt-BR');
}

/** What a required question that has no answer is refused with. */
export function missingIssue(question: Pick<ProfileFormQuestionDef, 'type'>): ProfileFormIssue {
  return question.type === 'acceptance' ? 'not_ticked' : 'required';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The inputs that mean "no answer": never an error, the caller decides with `missingIssue`. */
function isNoAnswer(type: ProfileFormType, raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) return raw.length === 0;
  return type === 'acceptance' && raw === false;
}

function parseText(raw: unknown, max: number): ParseAnswerResult {
  if (typeof raw !== 'string') return fail('invalid');
  const text = raw.trim();
  return codePoints(text) > max ? fail('too_long') : ok(text);
}

function parseChoice(question: ProfileFormQuestionDef, raw: unknown): ParseAnswerResult {
  const multiple = question.type === 'multiple_choice';
  let ids: unknown[];
  let rawOther: unknown;
  if (typeof raw === 'string') {
    ids = [raw];
  } else if (Array.isArray(raw)) {
    if (!multiple) return fail('invalid');
    ids = raw;
  } else if (isRecord(raw)) {
    rawOther = raw.otherText;
    if (multiple) {
      const list = raw.optionIds;
      if (list === undefined || list === null) ids = [];
      else if (Array.isArray(list)) ids = list;
      else return fail('invalid');
    } else {
      const one = raw.optionId;
      ids = one === undefined || one === null ? [] : [one];
    }
  } else {
    return fail('invalid');
  }

  let otherText: string | null = null;
  if (rawOther !== undefined && rawOther !== null) {
    if (typeof rawOther !== 'string') return fail('invalid');
    const trimmed = rawOther.trim();
    if (trimmed !== '') {
      if (!question.allowOther) return fail('other_not_allowed');
      if (codePoints(trimmed) > PROFILE_FORM_LIMITS.otherText) return fail('too_long');
      otherText = trimmed;
    }
  }

  const known = new Set(question.options.map((option) => option.id));
  const picked = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string') return fail('invalid');
    if (!known.has(id)) return fail('unknown_option');
    picked.add(id);
  }

  if (!multiple) {
    if (picked.size > 1) return fail('invalid');
    if (picked.size === 1 && otherText !== null) return fail('invalid');
    if (picked.size === 0 && otherText === null) return ok(null);
    const [optionId] = picked;
    return ok({ optionId: optionId ?? null, otherText });
  }

  if (picked.size === 0 && otherText === null) return ok(null);
  // The question's own option order, whatever order (or repeats) the client sent.
  const optionIds = question.options.filter((o) => picked.has(o.id)).map((o) => o.id);
  return ok({ optionIds, otherText });
}

function parseNumber(question: ProfileFormQuestionDef, raw: unknown): ParseAnswerResult {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail('invalid');
  if (Math.abs(raw) > Number.MAX_SAFE_INTEGER) return fail('invalid');
  const { min, max } = question.limits;
  if (typeof min === 'number' && raw < min) return fail('out_of_range');
  if (typeof max === 'number' && raw > max) return fail('out_of_range');
  // `-0 + 0` is `+0`: one stored form for zero.
  return ok(raw + 0);
}

const isoDay = z.iso.date();

function parseDate(question: ProfileFormQuestionDef, raw: unknown): ParseAnswerResult {
  if (typeof raw !== 'string') return fail('invalid');
  const day = raw.trim();
  if (!isoDay.safeParse(day).success) return fail('invalid');
  const { min, max } = question.limits;
  // ISO days sort as text: a calendar comparison with no time zone.
  if (typeof min === 'string' && day < min) return fail('out_of_range');
  if (typeof max === 'string' && day > max) return fail('out_of_range');
  return ok(day);
}

function parsePhone(raw: unknown): ParseAnswerResult {
  if (typeof raw !== 'string') return fail('invalid');
  const digits = raw.trim();
  if (!/^[0-9]+$/.test(digits)) return fail('invalid');
  if (digits.length !== 10 && digits.length !== 11) return fail('invalid');
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return fail('invalid');
  if (digits.length === 11 && digits[2] !== '9') return fail('invalid');
  return ok(digits);
}

const MAX_EMAIL = 254;
const MAX_LINK = 2048;
const emailRule = z.email();
const linkRule = z.httpUrl();

function parseEmail(raw: unknown): ParseAnswerResult {
  if (typeof raw !== 'string') return fail('invalid');
  const email = raw.trim().toLowerCase();
  if (codePoints(email) > MAX_EMAIL) return fail('too_long');
  return emailRule.safeParse(email).success ? ok(email) : fail('invalid');
}

function parseLink(raw: unknown): ParseAnswerResult {
  if (typeof raw !== 'string') return fail('invalid');
  const link = raw.trim();
  if (codePoints(link) > MAX_LINK) return fail('too_long');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\s\u0000-\u001f\u007f]/u.test(link)) return fail('invalid');
  // The exact path and query are kept as sent; only the scheme (`http:` or `https:`) is gated.
  return linkRule.safeParse(link).success ? ok(link) : fail('invalid');
}

/**
 * Decides whether `raw` is a valid answer to `question`. Pure and total: it never throws and parsing the
 * same input twice returns deeply equal values. `{ ok: true, value: null }` means "no answer" (the row
 * is absent); the caller then applies `missingIssue` when the question is required.
 */
export function parseAnswer(question: ProfileFormQuestionDef, raw: unknown): ParseAnswerResult {
  if (isNoAnswer(question.type, raw)) {
    // A choice object with no selection and no text is also "no answer"; the choice parser knows.
    return ok(null);
  }
  switch (question.type) {
    case 'short_text':
      return parseText(raw, PROFILE_FORM_LIMITS.shortText);
    case 'long_text':
      return parseText(raw, PROFILE_FORM_LIMITS.longText);
    case 'dropdown':
    case 'multiple_choice':
    case 'single_choice':
      return parseChoice(question, raw);
    case 'number':
      return parseNumber(question, raw);
    case 'date':
      return parseDate(question, raw);
    case 'phone':
      return parsePhone(raw);
    case 'email':
      return parseEmail(raw);
    case 'link':
      return parseLink(raw);
    case 'yes_no':
      return typeof raw === 'boolean' ? ok(raw) : fail('invalid');
    case 'acceptance':
      return raw === true ? ok(true) : fail('invalid');
    case 'rating':
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return fail('invalid');
      return raw >= 1 && raw <= 5 ? ok(raw) : fail('out_of_range');
  }
}

// ── The stored value shapes (D-591) ────────────────────────────────────────────────────────────

const choiceOne = z
  .object({ optionId: z.string().nullable(), otherText: z.string().nullable() })
  .refine((v) => (v.optionId === null) !== (v.otherText === null), 'invalid');
const choiceMany = z
  .object({ optionIds: z.array(z.string()), otherText: z.string().nullable() })
  .refine((v) => v.optionIds.length > 0 || v.otherText !== null, 'invalid');

/**
 * The discriminated stored answer, one variant per element of `PROFILE_FORM_TYPES`, in the same order.
 * It carries the LOOSE shape only (no per-question limits: those live in `parseAnswer`), so response
 * schemas can type `answer` without knowing the question.
 */
export const answerValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('short_text'), value: z.string().min(1) }),
  z.object({ type: z.literal('long_text'), value: z.string().min(1) }),
  z.object({ type: z.literal('dropdown'), value: choiceOne }),
  z.object({ type: z.literal('multiple_choice'), value: choiceMany }),
  z.object({ type: z.literal('single_choice'), value: choiceOne }),
  z.object({ type: z.literal('number'), value: z.number() }),
  z.object({ type: z.literal('date'), value: z.iso.date() }),
  z.object({ type: z.literal('phone'), value: z.string().regex(/^[0-9]{10,11}$/) }),
  z.object({ type: z.literal('email'), value: z.email() }),
  z.object({ type: z.literal('link'), value: z.httpUrl() }),
  z.object({ type: z.literal('yes_no'), value: z.boolean() }),
  z.object({ type: z.literal('acceptance'), value: z.literal(true) }),
  z.object({ type: z.literal('rating'), value: z.number().int().min(1).max(5) }),
]);
export type AnswerValue = z.infer<typeof answerValueSchema>;
