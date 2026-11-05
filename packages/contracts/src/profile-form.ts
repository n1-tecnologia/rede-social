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

/**
 * True when a free-text value cannot be stored: a NUL (`jsonb` and `text` both refuse it) or an unpaired
 * surrogate (not valid UTF-8). Such a value is refused as `invalid` instead of reaching the insert and
 * becoming a 500 (review WR-02). A regex rather than `String.prototype.isWellFormed`, which the shared
 * `lib` target (ES2023 for the web bundle) does not type.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
export const hasUnsafeChars = (value: string): boolean =>
  value.includes('\u0000') || UNPAIRED_SURROGATE.test(value);

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
  if (hasUnsafeChars(text)) return fail('invalid');
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
      if (hasUnsafeChars(trimmed)) return fail('invalid');
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
  // An unpaired surrogate passes the URL parser but Postgres refuses it in `jsonb` (22P02): keyed, not a 500.
  if (hasUnsafeChars(link)) return fail('invalid');
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

// ── 12.1-01: the visibility rule (D-621, D-628, PFORM-41) ──────────────────────────────────────

/** A condition on the shown question: one opener and the tokens that open it (D-621, D-622). */
export type ProfileFormCondition = { questionId: string; values: string[] };

/**
 * The tokens a STORED answer value contributes to a condition (D-621): an option id for a choice
 * answer, the literal `'true'` or `'false'` for a yes/no answer. "Outro" (no option id), an empty
 * multiple-choice set and every other shape contribute none. Pure.
 *
 * TypeScript twin of the SQL helper `app.profile_form_answer_tokens` plus array overlap (plans 06 and
 * 07). Both are asserted against `PROFILE_FORM_VISIBILITY_CASES`; a new stored-answer shape adds a row
 * to that table in the same change (FA-41).
 */
export function answerTokens(stored: unknown): string[] {
  if (typeof stored === 'boolean') return [String(stored)];
  if (!isRecord(stored)) return [];
  if (Array.isArray(stored.optionIds)) {
    return stored.optionIds.filter((id): id is string => typeof id === 'string');
  }
  return typeof stored.optionId === 'string' ? [stored.optionId] : [];
}

/**
 * Whether a question is shown (D-621, D-631): no condition is always visible; with one, the opener must
 * have an answer whose tokens share at least one value with the condition. An opener the caller knows
 * nothing about (`undefined`) or one with no tokens hides the question. Pure; the server recomputes it
 * on every save, the browser's copy is a convenience (T-12.1-16).
 */
export function isQuestionVisible(
  question: { condition: ProfileFormCondition | null },
  tokensOf: (questionId: string) => readonly string[] | undefined,
): boolean {
  if (question.condition === null) return true;
  const opener = tokensOf(question.condition.questionId);
  return opener !== undefined && question.condition.values.some((value) => opener.includes(value));
}

/**
 * The ids of the steps that hold at least one visible question, in the given step order (D-628). A step
 * whose questions are all hidden, and a step with no question, are absent.
 */
export function visibleSteps(
  steps: readonly { id: string }[],
  questions: readonly { id: string; stepId: string; condition: ProfileFormCondition | null }[],
  tokensOf: (questionId: string) => readonly string[] | undefined,
): string[] {
  const withVisible = new Set(
    questions.filter((question) => isQuestionVisible(question, tokensOf)).map((q) => q.stepId),
  );
  return steps.filter((step) => withVisible.has(step.id)).map((step) => step.id);
}

const CASE_A = '11111111-1111-4111-8111-111111111111';
const CASE_B = '22222222-2222-4222-8222-222222222222';
const CASE_C = '33333333-3333-4333-8333-333333333333';

/**
 * The parity table (PFORM-41): `(stored opener value, condition values) -> visible`. The contracts unit
 * test runs each row through `answerTokens` and `isQuestionVisible`; the pgTAP file of plan 07 and the
 * integration test of plan 12 run the same rows through the SQL helper and the gate.
 */
export const PROFILE_FORM_VISIBILITY_CASES: readonly {
  name: string;
  stored: unknown;
  values: string[];
  expected: boolean;
}[] = [
  { name: 'yes_no true opens a true condition', stored: true, values: ['true'], expected: true },
  {
    name: 'yes_no false opens a false condition',
    stored: false,
    values: ['false'],
    expected: true,
  },
  {
    name: 'yes_no true does not open a false condition',
    stored: true,
    values: ['false'],
    expected: false,
  },
  {
    name: 'yes_no false does not open a true condition',
    stored: false,
    values: ['true'],
    expected: false,
  },
  {
    name: 'yes_no true opens a both-values condition',
    stored: true,
    values: ['true', 'false'],
    expected: true,
  },
  {
    name: 'yes_no as a string is not a boolean answer',
    stored: 'true',
    values: ['true'],
    expected: false,
  },
  {
    name: 'single choice: the chosen option opens',
    stored: { optionId: CASE_A, otherText: null },
    values: [CASE_A],
    expected: true,
  },
  {
    name: 'single choice: another option does not open',
    stored: { optionId: CASE_A, otherText: null },
    values: [CASE_B],
    expected: false,
  },
  {
    name: 'single choice: mixed list, the chosen option is among them',
    stored: { optionId: CASE_A, otherText: null },
    values: [CASE_B, CASE_A, CASE_C],
    expected: true,
  },
  {
    name: 'multiple choice any-of: one of two chosen options is enough',
    stored: { optionIds: [CASE_A, CASE_B], otherText: null },
    values: [CASE_B],
    expected: true,
  },
  {
    name: 'multiple choice: none of the chosen options is in the condition',
    stored: { optionIds: [CASE_A, CASE_B], otherText: null },
    values: [CASE_C],
    expected: false,
  },
  {
    name: 'multiple choice: one chosen option against a list that omits it',
    stored: { optionIds: [CASE_A], otherText: null },
    values: [CASE_B, CASE_C],
    expected: false,
  },
  {
    name: 'multiple choice with Outro text still opens by its option ids',
    stored: { optionIds: [CASE_A], otherText: 'texto' },
    values: [CASE_A],
    expected: true,
  },
  {
    name: 'Outro on a single choice (optionId null) opens nothing',
    stored: { optionId: null, otherText: 'texto' },
    values: [CASE_A],
    expected: false,
  },
  {
    name: 'Outro only on a multiple choice opens nothing',
    stored: { optionIds: [], otherText: 'texto' },
    values: [CASE_A],
    expected: false,
  },
  {
    name: 'multiple choice: an empty set opens nothing',
    stored: { optionIds: [], otherText: null },
    values: [CASE_A],
    expected: false,
  },
  {
    name: 'unanswered opener (no stored value) is hidden',
    stored: null,
    values: [CASE_A],
    expected: false,
  },
  {
    name: 'unknown option id stored for the opener opens nothing',
    stored: { optionId: '99999999-9999-4999-8999-999999999999', otherText: null },
    values: [CASE_A],
    expected: false,
  },
];

// ── 12-03 Task 2: the wire schemas of every route ─────────────────────────────────────────────

const CHOICE_SET: ReadonlySet<string> = new Set(PROFILE_FORM_CHOICE_TYPES);
const isChoiceType = (type: string): boolean => CHOICE_SET.has(type);

const typeField = z.enum(PROFILE_FORM_TYPES, { error: 'invalid' });

/** A trimmed text of 1 to `max` code points; an empty value is `required`, a long one `too_long`. */
const requiredText = (max: number) =>
  z
    .string({ error: 'invalid' })
    .trim()
    .min(1, 'required')
    .refine((value) => !hasUnsafeChars(value), 'invalid')
    .refine((value) => codePoints(value) <= max, 'too_long');

/** Help text: trimmed, at most 300 code points, an empty value means "none" (`null`). */
const helpTextField = z
  .string({ error: 'invalid' })
  .trim()
  .refine((value) => !hasUnsafeChars(value), 'invalid')
  .refine((value) => codePoints(value) <= PROFILE_FORM_LIMITS.helpText, 'too_long')
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** `min` and `max` of a number question (numbers) or a date question (ISO days). */
const limitValue = z.union([z.number(), z.string()], { error: 'invalid' });
const limitsSchema = z.object({ min: limitValue.optional(), max: limitValue.optional() }).strict();
export type ProfileFormLimits = z.infer<typeof limitsSchema>;

type DefinitionIssueCtx = z.core.$RefinementCtx;

/** The limits rules that do not depend on the type: finite numbers or ISO days, `min <= max`. */
function checkLimitValues(limits: ProfileFormLimits, ctx: DefinitionIssueCtx): void {
  const { min, max } = limits;
  for (const [key, value] of [
    ['min', min],
    ['max', max],
  ] as const) {
    if (value === undefined) continue;
    const valid =
      typeof value === 'number'
        ? Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
        : isoDay.safeParse(value).success;
    if (!valid) ctx.addIssue({ code: 'custom', message: 'invalid', path: ['limits', key] });
  }
  if (min !== undefined && max !== undefined) {
    if (typeof min !== typeof max) {
      ctx.addIssue({ code: 'custom', message: 'invalid', path: ['limits', 'max'] });
    } else if (min > max) {
      ctx.addIssue({ code: 'custom', message: 'out_of_range', path: ['limits', 'min'] });
    }
  }
}

/** The option rules: 2 to 20, unique after `normalizeOptionLabel`, each label 1 to 80 code points. */
function checkOptionList(options: { label: string }[], ctx: DefinitionIssueCtx): void {
  if (options.length < 2) {
    ctx.addIssue({ code: 'custom', message: 'invalid', path: ['options'] });
  } else if (options.length > PROFILE_FORM_LIMITS.options) {
    ctx.addIssue({ code: 'custom', message: 'limit_reached', path: ['options'] });
  }
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const label = option.label.trim();
    if (label === '') {
      ctx.addIssue({ code: 'custom', message: 'required', path: ['options', index, 'label'] });
      return;
    }
    if (hasUnsafeChars(label)) {
      ctx.addIssue({ code: 'custom', message: 'invalid', path: ['options', index, 'label'] });
      return;
    }
    if (codePoints(label) > PROFILE_FORM_LIMITS.optionLabel) {
      ctx.addIssue({ code: 'custom', message: 'too_long', path: ['options', index, 'label'] });
    }
    const key = normalizeOptionLabel(label);
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', message: 'invalid', path: ['options', index, 'label'] });
    }
    seen.add(key);
  });
}

type QuestionDefinitionBody = {
  type: ProfileFormType;
  options: { label: string }[];
  allowOther: boolean;
  limits: ProfileFormLimits;
};

/** The cross-field rules of a question definition (create and replace share them). */
function checkDefinition(body: QuestionDefinitionBody, ctx: DefinitionIssueCtx): void {
  const choice = isChoiceType(body.type);
  if (choice) {
    checkOptionList(body.options, ctx);
  } else if (body.options.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'invalid', path: ['options'] });
  }
  if (body.allowOther && !choice) {
    ctx.addIssue({ code: 'custom', message: 'other_not_allowed', path: ['allowOther'] });
  }
  const limitKeys = Object.values(body.limits).filter((value) => value !== undefined);
  if (body.type === 'number' || body.type === 'date') {
    checkLimitValues(body.limits, ctx);
    for (const [key, value] of Object.entries(body.limits)) {
      if (value === undefined) continue;
      const rightKind =
        body.type === 'number' ? typeof value === 'number' : typeof value === 'string';
      if (!rightKind) ctx.addIssue({ code: 'custom', message: 'invalid', path: ['limits', key] });
    }
  } else if (limitKeys.length > 0) {
    ctx.addIssue({ code: 'custom', message: 'invalid', path: ['limits'] });
  }
}

const createQuestionShape = z
  .object({
    type: typeField,
    title: requiredText(PROFILE_FORM_LIMITS.title),
    helpText: helpTextField.default(null),
    required: z.boolean({ error: 'invalid' }).default(false),
    showOnProfile: z.boolean({ error: 'invalid' }).default(false),
    allowOther: z.boolean({ error: 'invalid' }).default(false),
    options: z
      .array(z.object({ label: z.string({ error: 'invalid' }) }).strict())
      .max(PROFILE_FORM_LIMITS.options + 1, 'limit_reached')
      .default([]),
    limits: limitsSchema.default({}),
  })
  .strict();

/** `POST /questions` (PFORM-02, PFORM-06): the definition of a new question. */
export const createQuestionBodySchema = createQuestionShape.superRefine(checkDefinition);
export type CreateQuestionBody = z.infer<typeof createQuestionBodySchema>;

/**
 * `PUT /questions/{id}` (PFORM-17): `revision` is the optimistic lock; every other key is optional.
 * An option with an `id` keeps a stored option, one without adds a new one. `type` is accepted here and
 * refused by the service with `type_locked` once the question has answers.
 */
export const updateQuestionBodySchema = z
  .object({
    revision: z.number({ error: 'invalid' }).int('invalid').min(1, 'invalid'),
    type: typeField.optional(),
    title: requiredText(PROFILE_FORM_LIMITS.title).optional(),
    helpText: helpTextField.optional(),
    required: z.boolean({ error: 'invalid' }).optional(),
    showOnProfile: z.boolean({ error: 'invalid' }).optional(),
    allowOther: z.boolean({ error: 'invalid' }).optional(),
    options: z
      .array(
        z
          .object({
            id: z.uuid({ error: 'invalid' }).optional(),
            label: z.string({ error: 'invalid' }),
          })
          .strict(),
      )
      .max(PROFILE_FORM_LIMITS.options + 1, 'limit_reached')
      .optional(),
    limits: limitsSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.options !== undefined) checkOptionList(body.options, ctx);
    if (body.limits !== undefined) checkLimitValues(body.limits, ctx);
  });
export type UpdateQuestionBody = z.infer<typeof updateQuestionBodySchema>;

/** `PUT /questions/order`: the whole active list, ids unique. */
export const reorderBodySchema = z
  .object({
    ids: z
      .array(z.uuid({ error: 'order_mismatch' }), { error: 'order_mismatch' })
      .min(1, 'order_mismatch')
      .max(PROFILE_FORM_LIMITS.activeQuestions, 'order_mismatch'),
  })
  .strict()
  .refine((body) => new Set(body.ids).size === body.ids.length, 'order_mismatch');
export type ReorderBody = z.infer<typeof reorderBodySchema>;

/** `POST /questions/replace` (PFORM-17): a new question that takes the place of `replaces`. */
export const replaceQuestionBodySchema = createQuestionShape
  .extend({ replaces: z.uuid({ error: 'invalid' }) })
  .superRefine(checkDefinition);
export type ReplaceQuestionBody = z.infer<typeof replaceQuestionBodySchema>;

const optionSchema = z.object({ id: z.string(), label: z.string() });

const questionCore = {
  id: z.uuid(),
  type: typeField,
  title: z.string(),
  helpText: z.string().nullable(),
  required: z.boolean(),
  showOnProfile: z.boolean(),
  allowOther: z.boolean(),
  limits: limitsSchema,
};

/** The stored answer as the member read returns it: the loose shape of any type, or `null`. */
const storedValueSchema = z.union([z.string(), z.number(), z.boolean(), choiceOne, choiceMany]);

/** One question of the member form (`GET /v1/me/profile-form`). */
export const memberQuestionSchema = z.object({
  ...questionCore,
  options: z.array(optionSchema),
  answer: storedValueSchema.nullable(),
});
export type MemberQuestion = z.infer<typeof memberQuestionSchema>;

/** `GET /v1/me/profile-form`: staff and a module that is off get `mode: 'none'` and no questions. */
export const memberFormSchema = z.object({
  mode: z.enum(PROFILE_FORM_MODES),
  missingRequired: z.number().int().min(0),
  formEtag: z.string(),
  questions: z.array(memberQuestionSchema),
});
export type MemberForm = z.infer<typeof memberFormSchema>;

/** `PUT /v1/me/profile-form/answers`: the whole screen at once, keyed by question id. */
export const saveAnswersBodySchema = z
  .object({
    formEtag: z.string().min(1).max(256),
    answers: z
      .record(z.uuid(), z.unknown())
      .refine(
        (answers) => Object.keys(answers).length <= PROFILE_FORM_LIMITS.activeQuestions,
        'limit_reached',
      ),
  })
  .strict();
export type SaveAnswersBody = z.infer<typeof saveAnswersBodySchema>;

export const saveAnswersResultSchema = z.object({ missingRequired: z.number().int().min(0) });
export type SaveAnswersResult = z.infer<typeof saveAnswersResultSchema>;

export const dismissNoticeResultSchema = z.object({ newOptional: z.number().int().min(0) });
export type DismissNoticeResult = z.infer<typeof dismissNoticeResultSchema>;

/** The block `GET /v1/me/bootstrap` gains (plan 05): what the redirect and the notice need. */
export const profileFormBootstrapSchema = z.object({
  pendingRequired: z.number().int().min(0),
  newOptional: z.number().int().min(0),
});
export type ProfileFormBootstrap = z.infer<typeof profileFormBootstrapSchema>;

const adminCore = {
  ...questionCore,
  options: z.array(optionSchema.extend({ answerCount: z.number().int().min(0) })),
  position: z.number().int(),
  revision: z.number().int().min(1),
  answerCount: z.number().int().min(0),
  createdAt: z.string(),
  listedAt: z.string(),
};

/** One row of the builder's active list: the member fields without `answer`, plus counts. */
export const adminQuestionSchema = z.object(adminCore);
export type AdminQuestion = z.infer<typeof adminQuestionSchema>;

/**
 * `GET /v1/profile_form/questions`: the builder's active list in the admin's order, with the aggregate counts.
 * `activeCount` is the number of active questions and `limit` the most the tenant may have
 * (`PROFILE_FORM_LIMITS.activeQuestions`). **Aggregates only (D-593, PFORM-23):** no field of this payload is
 * ever an individual member's answer.
 */
export const adminQuestionListSchema = z.object({
  questions: z.array(adminQuestionSchema),
  activeCount: z.number().int().min(0),
  limit: z.number().int().min(1),
});
export type AdminQuestionList = z.infer<typeof adminQuestionListSchema>;

export const archivedQuestionSchema = z.object({ ...adminCore, archivedAt: z.string() });
export type ArchivedQuestion = z.infer<typeof archivedQuestionSchema>;

/** `GET /v1/profile_form/archived`: the archived questions, newest archive first. Aggregates only. */
export const archivedQuestionListSchema = z.object({ questions: z.array(archivedQuestionSchema) });
export type ArchivedQuestionList = z.infer<typeof archivedQuestionListSchema>;

export const profileFormSummarySchema = z.object({
  total: z.number().int().min(0),
  complete: z.number().int().min(0),
  hasRequired: z.boolean(),
});
export type ProfileFormSummary = z.infer<typeof profileFormSummarySchema>;

export const PROFILE_FORM_IMPACT_CHANGES = [
  'create_required',
  'make_required',
  'reactivate',
  'replace',
] as const;
export type ProfileFormImpactChange = (typeof PROFILE_FORM_IMPACT_CHANGES)[number];

/** `GET /impact`: how many members a change would ask to answer. */
export const impactQuerySchema = z
  .object({ change: z.enum(PROFILE_FORM_IMPACT_CHANGES), questionId: z.uuid().optional() })
  .strict();
export type ImpactQuery = z.infer<typeof impactQuerySchema>;

export const impactResultSchema = z.object({ members: z.number().int().min(0) });
export type ImpactResult = z.infer<typeof impactResultSchema>;

/**
 * `GET /v1/members/{id}/profile-answers` for a member viewer: public and answered rows only. **Strict
 * on purpose (PFORM-18):** an extra key (a private flag, an e-mail, a question the member left blank)
 * is a contract change a reviewer sees.
 */
export const publicAnswersSchema = z
  .object({
    kind: z.literal('member'),
    answers: z.array(
      z
        .object({
          questionId: z.uuid(),
          title: z.string(),
          type: typeField,
          options: z.array(optionSchema),
          value: storedValueSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type PublicAnswers = z.infer<typeof publicAnswersSchema>;

/** The same read for staff (PFORM-19): every row, archived included, with the flags staff need. */
export const staffAnswersSchema = z
  .object({
    kind: z.literal('staff'),
    answers: z.array(
      z
        .object({
          questionId: z.uuid(),
          title: z.string(),
          type: typeField,
          options: z.array(optionSchema),
          value: storedValueSchema.nullable(),
          showOnProfile: z.boolean(),
          position: z.number().int(),
          archivedAt: z.string().nullable(),
          answered: z.boolean(),
          required: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type StaffAnswers = z.infer<typeof staffAnswersSchema>;

/**
 * The canonical text of a form's identity: `id:revision` pairs in list order. The server hashes it into
 * `formEtag`, so a member who opened the form before an admin edit is told it changed (`form_changed`).
 */
export function answerEtag(questions: readonly { id: string; revision: number }[]): string {
  return questions.map((question) => `${question.id}:${question.revision}`).join('|');
}
