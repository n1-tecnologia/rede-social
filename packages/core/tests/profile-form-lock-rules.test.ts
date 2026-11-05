import { describe, expect, it } from 'vitest';
import {
  checkLocks,
  guardIssueOf,
  type LockDefinition,
  type LockInput,
} from '../server/profile-form/lock-rules';

/**
 * 12-08 (PFORM-17, D-587, T-12-20): the pure lock rules, no database and no mocks. Table-driven, one row per
 * rule, with the boundary of each (equal, one step either way) beside it.
 */

const A = { id: 'a0000000-0000-4000-8000-000000000001', label: 'Alfa' };
const B = { id: 'b0000000-0000-4000-8000-000000000002', label: 'Beta' };
const C = { id: 'c0000000-0000-4000-8000-000000000003', label: 'Gama' };

const def = (over: Partial<LockDefinition> = {}): LockDefinition => ({
  type: 'single_choice',
  showOnProfile: false,
  allowOther: false,
  options: [A, B],
  limits: {},
  ...over,
});

const check = (
  next: Partial<LockDefinition>,
  over: Partial<Omit<LockInput, 'current' | 'next'>> & { current?: Partial<LockDefinition> } = {},
) => {
  const { current, ...rest } = over;
  return checkLocks({
    current: def(current),
    next: def({ ...current, ...next }),
    answerCount: 1,
    answeredOptionIds: new Set<string>(),
    otherAnswered: false,
    ...rest,
  });
};

describe('12-08 checkLocks, behavior 1: with no answers everything is free', () => {
  const changes: [string, Partial<LockDefinition>][] = [
    ['the type', { type: 'dropdown' }],
    ['an option removed', { options: [A] }],
    ['an option relabelled', { options: [{ ...A, label: 'Outro nome' }, B] }],
    ['allowOther off', { allowOther: false }],
    ['visibility to public', { showOnProfile: true }],
    ['a number limit narrowed', { limits: { min: 5, max: 6 } }],
  ];
  it.each(changes)('answerCount 0: %s returns null', (_name, next) => {
    expect(
      check(next, {
        answerCount: 0,
        answeredOptionIds: new Set([A.id]),
        otherAnswered: true,
        current: { allowOther: true, type: 'number', limits: { min: 1, max: 10 } },
      }),
    ).toBeNull();
  });
});

describe('12-08 checkLocks, behavior 2: with answers each rule has its code', () => {
  it('the type is locked, even with exactly one answer', () => {
    expect(check({ type: 'dropdown' })).toBe('type_locked');
    expect(check({ type: 'dropdown' }, { answerCount: 1 })).toBe('type_locked');
  });

  it('an answered option cannot be removed or relabelled; a case-only or whitespace-only change is a rename', () => {
    const answered = { answeredOptionIds: new Set([A.id]) };
    expect(check({ options: [B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'Alfa 2' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'alfa' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'Alfa ' }, B] }, answered)).toBe('option_locked');
    expect(check({ options: [{ ...A, label: 'Al fa' }, B] }, answered)).toBe('option_locked');
  });

  it('an unanswered option can be removed or relabelled beside an answered one; adding and reordering are free', () => {
    const answered = { answeredOptionIds: new Set([A.id]) };
    expect(check({ options: [A] }, answered)).toBeNull();
    expect(check({ options: [A, { ...B, label: 'Beta 2' }] }, answered)).toBeNull();
    expect(check({ options: [A, B, C] }, answered)).toBeNull();
    expect(check({ options: [B, A] }, answered)).toBeNull();
    expect(check({ options: [C, B, A] }, answered)).toBeNull();
    // The answered one renamed beside an unanswered rename is still refused.
    expect(
      check(
        {
          options: [
            { ...A, label: 'X' },
            { ...B, label: 'Y' },
          ],
        },
        answered,
      ),
    ).toBe('option_locked');
  });

  it('answered options may arrive as an array as well as a set', () => {
    expect(check({ options: [B] }, { answeredOptionIds: [A.id] })).toBe('option_locked');
  });

  it('Outro off is locked only while an Outro answer exists', () => {
    const current = { allowOther: true };
    expect(check({ allowOther: false }, { current, otherAnswered: true })).toBe('other_locked');
    expect(check({ allowOther: false }, { current, otherAnswered: false })).toBeNull();
    expect(check({ allowOther: true }, { current, otherAnswered: true })).toBeNull();
  });

  it('private to public is refused, public to private stays allowed', () => {
    expect(check({ showOnProfile: true })).toBe('visibility_locked');
    expect(check({ showOnProfile: false }, { current: { showOnProfile: true } })).toBeNull();
    expect(check({ showOnProfile: true }, { current: { showOnProfile: true } })).toBeNull();
  });

  const numberCases: [string, LockDefinition['limits'], LockDefinition['limits'], boolean][] = [
    ['min rises', { min: 1, max: 10 }, { min: 2, max: 10 }, true],
    ['min rises by one step of a decimal', { min: 0.1 }, { min: 0.2 }, true],
    ['max falls', { min: 1, max: 10 }, { min: 1, max: 9 }, true],
    ['a min is set where none existed', {}, { min: 0 }, true],
    ['a max is set where none existed', { min: 1 }, { min: 1, max: 100 }, true],
    ['the limit is equal', { min: 1, max: 10 }, { min: 1, max: 10 }, false],
    ['the limit widens', { min: 1, max: 10 }, { min: 0, max: 11 }, false],
    ['a bound is removed', { min: 1, max: 10 }, { min: 1 }, false],
    ['both bounds are removed', { min: 1, max: 10 }, {}, false],
    ['the min falls by a decimal step', { min: 0.2 }, { min: 0.1 }, false],
  ];
  it.each(numberCases)('number: %s', (_name, from, to, locked) => {
    expect(check({ limits: to }, { current: { type: 'number', options: [], limits: from } })).toBe(
      locked ? 'limits_locked' : null,
    );
  });

  const dateCases: [string, LockDefinition['limits'], LockDefinition['limits'], boolean][] = [
    ['min moves a day later', { min: '2026-01-01' }, { min: '2026-01-02' }, true],
    ['max moves a day earlier', { max: '2026-12-31' }, { max: '2026-12-30' }, true],
    ['a bound is set where none existed', {}, { max: '2026-12-31' }, true],
    [
      'the limit is equal',
      { min: '2026-01-01', max: '2026-12-31' },
      { min: '2026-01-01', max: '2026-12-31' },
      false,
    ],
    ['the limit widens', { min: '2026-01-01' }, { min: '2025-12-31' }, false],
    ['a bound is removed', { min: '2026-01-01' }, {}, false],
  ];
  it.each(dateCases)('date: %s', (_name, from, to, locked) => {
    expect(check({ limits: to }, { current: { type: 'date', options: [], limits: from } })).toBe(
      locked ? 'limits_locked' : null,
    );
  });

  it('limits on a type that has none are not a bound', () => {
    expect(
      check({ limits: { min: 3 } }, { current: { type: 'short_text', options: [] } }),
    ).toBeNull();
  });
});

describe('12-08 checkLocks, behavior 3: the first violated rule wins and the function is pure', () => {
  it('returns type, then option, then other, then visibility, then limits', () => {
    const current = {
      type: 'number',
      allowOther: true,
      options: [A, B],
      showOnProfile: false,
      limits: { min: 1 },
    };
    const worst: Partial<LockDefinition> = {
      type: 'date',
      options: [],
      allowOther: false,
      showOnProfile: true,
      limits: { min: 5 },
    };
    const facts = { answeredOptionIds: new Set([A.id]), otherAnswered: true, current };
    expect(check(worst, facts)).toBe('type_locked');
    expect(check({ ...worst, type: 'number' }, facts)).toBe('option_locked');
    expect(check({ ...worst, type: 'number', options: [A, B] }, facts)).toBe('other_locked');
    expect(check({ ...worst, type: 'number', options: [A, B], allowOther: true }, facts)).toBe(
      'visibility_locked',
    );
    expect(
      check(
        { ...worst, type: 'number', options: [A, B], allowOther: true, showOnProfile: false },
        facts,
      ),
    ).toBe('limits_locked');
  });

  it('is deterministic and leaves its input untouched', () => {
    const input: LockInput = {
      current: def(),
      next: def({ options: [B] }),
      answerCount: 3,
      answeredOptionIds: new Set([A.id]),
      otherAnswered: false,
    };
    const frozen = JSON.stringify({ ...input, answeredOptionIds: [...input.answeredOptionIds] });
    expect(checkLocks(input)).toBe(checkLocks(input));
    expect(JSON.stringify({ ...input, answeredOptionIds: [...input.answeredOptionIds] })).toBe(
      frozen,
    );
  });
});

describe('12-08 guardIssueOf: the trigger’s SQLSTATEs map to the same codes', () => {
  it.each([
    ['PF001', 'type_locked'],
    ['PF002', 'option_locked'],
    ['PF003', 'other_locked'],
    ['PF004', 'visibility_locked'],
    ['PF005', 'limits_locked'],
    ['PF006', 'condition_locked'],
    ['PF007', 'has_dependents'],
  ])('%s is %s, bare or wrapped in a cause chain', (state, issue) => {
    expect(guardIssueOf({ code: state })).toBe(issue);
    expect(guardIssueOf(new Error('x', { cause: { code: state } }))).toBe(issue);
    expect(guardIssueOf({ cause: { cause: { code: state } } })).toBe(issue);
  });

  it('anything else is null', () => {
    for (const error of [
      null,
      undefined,
      'PF001',
      { code: '23505' },
      { code: 'PF008' },
      new Error('x'),
    ]) {
      expect(guardIssueOf(error)).toBeNull();
    }
  });
});
