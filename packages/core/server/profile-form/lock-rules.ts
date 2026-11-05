import type { ProfileFormIssue } from '@rede-social/contracts/profile-form';

/**
 * The D-587 lock rules, PURE (Phase 12-08, PFORM-17, T-12-20): what an admin may not change on a question that
 * already has answers, because the change would reinterpret or expose what members stored. No database, no
 * I/O, no clock: the service reads the facts (how many answers, which options they name, whether an "Outro"
 * answer exists) and asks this function, which answers with the FIRST violated rule or `null`.
 *
 * The plan-04 trigger `app.profile_form_question_guard` states the same five rules in SQL (PF001..PF005) as the
 * backstop of a race that gets past the service; the two must stay in step, and `guardIssueOf` below is the map
 * from the trigger's SQLSTATEs back to the same codes.
 *
 * Free on an answered question: title, help text, `required`, position, ADDING an option, reordering options,
 * widening a limit, turning "show on profile" off. Locked (the check order is this order): the TYPE
 * (`type_locked`), every option that has answers, removed or relabelled (`option_locked`), switching "Outro"
 * off while an "Outro" answer exists (`other_locked`), private to public (`visibility_locked`, the one-way
 * ratchet of PU-1) and narrowing a number or date limit (`limits_locked`).
 *
 * 12.1 (D-625, D-632): the trigger states two more rules, PF006 and PF007 (a condition cannot be gained or
 * changed on an answered question; an opener with active dependents cannot be archived, retyped or lose a
 * referenced option). Their pure twins live in `condition-rules.ts` (`checkConditionLock`,
 * `checkOpenerChange`); `guardIssueOf` maps both SQLSTATEs below.
 */

export type LockLimits = { min?: number | string; max?: number | string };

/** The part of a question the lock rules look at. */
export type LockDefinition = {
  type: string;
  showOnProfile: boolean;
  allowOther: boolean;
  options: readonly { id: string; label: string }[];
  limits: LockLimits;
};

export type LockInput = {
  current: LockDefinition;
  next: LockDefinition;
  /** How many answers the question has. Zero means every field is free, the type included. */
  answerCount: number;
  /** The ids of the options at least one answer names (single and multiple choice alike). */
  answeredOptionIds: ReadonlySet<string> | readonly string[];
  /** Whether at least one answer carries an "Outro" text. */
  otherAnswered: boolean;
};

/**
 * A bound that did not exist and now does is a narrowing; so is a minimum that rises or a maximum that
 * falls. Numbers compare as numbers (0.1 to 0.2 as a minimum narrows), dates as calendar days (ISO days
 * order the same as text). A bound whose stored kind does not match the type is not a bound.
 */
function narrows(type: string, current: LockLimits, next: LockLimits): boolean {
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

/** The first D-587 rule the change breaks, or `null` when it is allowed. Pure: same input, same output. */
export function checkLocks(input: LockInput): ProfileFormIssue | null {
  const { current, next, answerCount, otherAnswered } = input;
  if (answerCount <= 0) return null;
  const answered =
    input.answeredOptionIds instanceof Set
      ? input.answeredOptionIds
      : new Set(input.answeredOptionIds);

  if (next.type !== current.type) return 'type_locked';

  // An answered option may be neither removed nor relabelled: the label compares exactly (a case-only or
  // inner-whitespace change is still a rename). Adding options and reordering them are free.
  for (const option of current.options) {
    if (!answered.has(option.id)) continue;
    const kept = next.options.find((candidate) => candidate.id === option.id);
    if (!kept || kept.label !== option.label) return 'option_locked';
  }

  if (current.allowOther && !next.allowOther && otherAnswered) return 'other_locked';

  if (!current.showOnProfile && next.showOnProfile) return 'visibility_locked';

  if (narrows(current.type, current.limits, next.limits)) return 'limits_locked';

  return null;
}

/** The SQLSTATEs of the plan-04 guard trigger and the code each one means. */
const GUARD_CODES: Readonly<Record<string, ProfileFormIssue>> = {
  PF001: 'type_locked',
  PF002: 'option_locked',
  PF003: 'other_locked',
  PF004: 'visibility_locked',
  PF005: 'limits_locked',
  PF006: 'condition_locked',
  PF007: 'has_dependents',
};

/**
 * The lock code a database error means when it is (or wraps, through `.cause`) one of the guard trigger's
 * SQLSTATEs PF001..PF005; otherwise `null`. The trigger is the backstop of a race that got past
 * `checkLocks`, and it must answer the same coded 409, never a 500.
 */
export function guardIssueOf(error: unknown): ProfileFormIssue | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && Object.hasOwn(GUARD_CODES, code))
      return GUARD_CODES[code] ?? null;
    current = cause;
  }
  return null;
}
