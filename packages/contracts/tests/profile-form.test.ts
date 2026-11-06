import { describe, expect, it } from 'vitest';
import {
  adminQuestionListSchema,
  adminQuestionSchema,
  adminStepSchema,
  answerEtag,
  answerTokens,
  answerValueSchema,
  archivedQuestionSchema,
  createQuestionBodySchema,
  createStepBodySchema,
  deleteStepResultSchema,
  dependentSchema,
  dismissNoticeResultSchema,
  hasDependentsDetailsSchema,
  hasUnsafeChars,
  impactQuerySchema,
  impactResultSchema,
  isQuestionVisible,
  layoutBodySchema,
  legacyReorderBodySchema,
  memberFormSchema,
  memberStepSchema,
  missingIssue,
  normalizeOptionLabel,
  PROFILE_FORM_CHOICE_TYPES,
  PROFILE_FORM_CONDITION_OPENER_TYPES,
  PROFILE_FORM_DEFAULT_STEP_TITLE,
  PROFILE_FORM_IMPACT_CHANGES,
  PROFILE_FORM_ISSUE_SET,
  PROFILE_FORM_ISSUES,
  PROFILE_FORM_LIMITS,
  PROFILE_FORM_MODES,
  PROFILE_FORM_TYPES,
  PROFILE_FORM_VISIBILITY_CASES,
  type ProfileFormQuestionDef,
  type ProfileFormType,
  parseAnswer,
  parseConditionValues,
  profileFormBootstrapSchema,
  profileFormConditionSchema,
  profileFormSummarySchema,
  publicAnswersSchema,
  reorderBodySchema,
  replaceQuestionBodySchema,
  saveAnswersBodySchema,
  saveAnswersResultSchema,
  staffAnswersSchema,
  updateQuestionBodySchema,
  updateStepBodySchema,
  visibleSteps,
} from '../src/profile-form';

/**
 * 12-03 (D-590, D-591, D-592; PFORM-04, 05, 06): the thirteen answer validators, the limits and the
 * closed refusal list. `parseAnswer` is built from the STORED question only (T-12-05).
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const OTHER_QUESTION_OPTION = '99999999-9999-4999-8999-999999999999';

function q(
  type: ProfileFormType,
  extra: Partial<ProfileFormQuestionDef> = {},
): ProfileFormQuestionDef {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    type,
    required: false,
    allowOther: false,
    options: [],
    limits: {},
    ...extra,
  };
}

const OPTIONS = [
  { id: A, label: 'a' },
  { id: B, label: 'b' },
  { id: C, label: 'c' },
];
const choice = (type: ProfileFormType, extra: Partial<ProfileFormQuestionDef> = {}) =>
  q(type, { options: OPTIONS, ...extra });

const accepted = (def: ProfileFormQuestionDef, raw: unknown) => parseAnswer(def, raw);
const parsedValue = (def: ProfileFormQuestionDef, raw: unknown) => {
  const result = parseAnswer(def, raw);
  if (!result.ok) throw new Error(`expected ok, got ${result.issue}`);
  return result.value;
};
const issueOf = (def: ProfileFormQuestionDef, raw: unknown) => {
  const result = parseAnswer(def, raw);
  if (result.ok) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`);
  return result.issue;
};

describe('12-03 - the constants (D-590, D-591)', () => {
  it('lists the thirteen types in the documented order, the last one being the append point', () => {
    expect(PROFILE_FORM_TYPES).toHaveLength(13);
    expect(PROFILE_FORM_TYPES).toEqual([
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
    ]);
    expect(new Set(PROFILE_FORM_TYPES).size).toBe(13);
  });

  it('the choice types are a subset of the types, and the modes are the four of the member read', () => {
    for (const type of PROFILE_FORM_CHOICE_TYPES) expect(PROFILE_FORM_TYPES).toContain(type);
    expect(PROFILE_FORM_MODES).toEqual(['none', 'first', 'returning', 'edit']);
  });

  it('keeps every limit as ONE constant', () => {
    expect(PROFILE_FORM_LIMITS).toEqual({
      activeQuestions: 30,
      options: 20,
      title: 120,
      helpText: 300,
      optionLabel: 80,
      otherText: 120,
      shortText: 120,
      longText: 1000,
      valueBytes: 4096,
      steps: 10,
      stepTitle: 60,
      branchDepth: 3,
      branches: 15,
      branchName: 60,
    });
  });

  it('the refusal list is closed, unique and mirrored by the lookup set', () => {
    expect(new Set(PROFILE_FORM_ISSUES).size).toBe(PROFILE_FORM_ISSUES.length);
    expect(PROFILE_FORM_ISSUES).toHaveLength(28);
    expect(PROFILE_FORM_ISSUES.slice(-7)).toEqual([
      'condition_locked',
      'condition_invalid',
      'condition_order',
      'has_dependents',
      'step_not_empty',
      'last_step',
      'unknown_step',
    ]);
    expect(PROFILE_FORM_ISSUES.at(-1)).toBe('unknown_step');
    for (const issue of PROFILE_FORM_ISSUES) expect(PROFILE_FORM_ISSUE_SET.has(issue)).toBe(true);
    expect(PROFILE_FORM_ISSUE_SET.has('nope')).toBe(false);
  });

  it('PFORM-05 (TypeScript half): the answer schema has exactly one variant per type, in order', () => {
    expect(answerValueSchema.options.map((variant) => variant.shape.type.value)).toEqual([
      ...PROFILE_FORM_TYPES,
    ]);
  });
});

describe('12-03 - one valid answer per type (PFORM-04)', () => {
  it('short_text and long_text store the trimmed string', () => {
    expect(parsedValue(q('short_text'), '  Maria  ')).toBe('Maria');
    expect(parsedValue(q('long_text'), ' uma linha\noutra ')).toBe('uma linha\noutra');
  });

  it('dropdown and single_choice store { optionId, otherText } with exactly one side set', () => {
    for (const type of ['dropdown', 'single_choice'] as const) {
      expect(parsedValue(choice(type), B)).toEqual({ optionId: B, otherText: null });
      expect(parsedValue(choice(type), { optionId: B })).toEqual({ optionId: B, otherText: null });
      expect(parsedValue(choice(type, { allowOther: true }), { otherText: ' Talvez ' })).toEqual({
        optionId: null,
        otherText: 'Talvez',
      });
    }
  });

  it('multiple_choice stores { optionIds, otherText } with at least one selection in total', () => {
    expect(parsedValue(choice('multiple_choice'), [C, A])).toEqual({
      optionIds: [A, C],
      otherText: null,
    });
    expect(
      parsedValue(choice('multiple_choice', { allowOther: true }), {
        optionIds: [],
        otherText: 'x',
      }),
    ).toEqual({ optionIds: [], otherText: 'x' });
    expect(
      parsedValue(choice('multiple_choice', { allowOther: true }), {
        optionIds: [B],
        otherText: 'x',
      }),
    ).toEqual({ optionIds: [B], otherText: 'x' });
  });

  it('number stores the finite JSON number as sent', () => {
    expect(parsedValue(q('number'), 1234.5)).toBe(1234.5);
    expect(parsedValue(q('number'), -3)).toBe(-3);
  });

  it('date stores the calendar day', () => {
    expect(parsedValue(q('date'), ' 2026-02-28 ')).toBe('2026-02-28');
    expect(parsedValue(q('date'), '2028-02-29')).toBe('2028-02-29');
  });

  it('phone stores the national digits', () => {
    expect(parsedValue(q('phone'), '1198765432')).toBe('1198765432');
    expect(parsedValue(q('phone'), '11987654321')).toBe('11987654321');
  });

  it('email stores the lower-cased address', () => {
    expect(parsedValue(q('email'), '  Maria@Exemplo.COM.br ')).toBe('maria@exemplo.com.br');
  });

  it('link keeps the exact path and query of an http or https address', () => {
    expect(parsedValue(q('link'), 'https://exemplo.com.br/a/B?x=1&Y=2#topo')).toBe(
      'https://exemplo.com.br/a/B?x=1&Y=2#topo',
    );
    expect(parsedValue(q('link'), 'http://exemplo.com.br')).toBe('http://exemplo.com.br');
  });

  it('yes_no stores a boolean, both values are answers', () => {
    expect(parsedValue(q('yes_no'), true)).toBe(true);
    expect(parsedValue(q('yes_no'), false)).toBe(false);
  });

  it('acceptance stores the literal true', () => {
    expect(parsedValue(q('acceptance'), true)).toBe(true);
  });

  it('rating stores an integer 1 to 5', () => {
    for (const n of [1, 2, 3, 4, 5]) expect(parsedValue(q('rating'), n)).toBe(n);
  });

  it('every stored value validates against its answerValueSchema variant', () => {
    const samples: [ProfileFormQuestionDef, unknown][] = [
      [q('short_text'), 'a'],
      [q('long_text'), 'a'],
      [choice('dropdown'), A],
      [choice('multiple_choice'), [A, B]],
      [choice('single_choice'), B],
      [q('number'), 4],
      [q('date'), '2026-10-29'],
      [q('phone'), '11987654321'],
      [q('email'), 'a@b.co'],
      [q('link'), 'https://a.co'],
      [q('yes_no'), false],
      [q('acceptance'), true],
      [q('rating'), 3],
    ];
    for (const [def, raw] of samples) {
      const result = answerValueSchema.safeParse({ type: def.type, value: parsedValue(def, raw) });
      expect(result.success, def.type).toBe(true);
    }
  });
});

describe('12-03 - boundary: the value at the limit and one step beyond (PFORM-04)', () => {
  it('boundary: short text 120 code points is accepted, 121 is too_long', () => {
    expect(accepted(q('short_text'), 'a'.repeat(120)).ok).toBe(true);
    expect(issueOf(q('short_text'), 'a'.repeat(121))).toBe('too_long');
  });

  it('boundary: long text 1000 code points is accepted, 1001 is too_long', () => {
    expect(accepted(q('long_text'), 'a'.repeat(1000)).ok).toBe(true);
    expect(issueOf(q('long_text'), 'a'.repeat(1001))).toBe('too_long');
  });

  it('boundary: the "Outro" text at 120 is accepted, 121 is too_long', () => {
    const def = choice('single_choice', { allowOther: true });
    expect(accepted(def, { otherText: 'x'.repeat(120) }).ok).toBe(true);
    expect(issueOf(def, { otherText: 'x'.repeat(121) })).toBe('too_long');
  });

  it('boundary: a number exactly at min and at max is accepted, one step beyond is out_of_range', () => {
    const def = q('number', { limits: { min: 1.5, max: 10 } });
    expect(parsedValue(def, 1.5)).toBe(1.5);
    expect(parsedValue(def, 10)).toBe(10);
    expect(issueOf(def, 1.4999999)).toBe('out_of_range');
    expect(issueOf(def, 10.0000001)).toBe('out_of_range');
  });

  it('boundary: a date equal to min or max is accepted, a day beyond is out_of_range', () => {
    const def = q('date', { limits: { min: '2026-01-01', max: '2026-12-31' } });
    expect(parsedValue(def, '2026-01-01')).toBe('2026-01-01');
    expect(parsedValue(def, '2026-12-31')).toBe('2026-12-31');
    expect(issueOf(def, '2025-12-31')).toBe('out_of_range');
    expect(issueOf(def, '2027-01-01')).toBe('out_of_range');
  });

  it('boundary: rating 1 and 5 are accepted, 0 and 6 are out_of_range, 2.5 is invalid', () => {
    expect(parsedValue(q('rating'), 1)).toBe(1);
    expect(parsedValue(q('rating'), 5)).toBe(5);
    expect(issueOf(q('rating'), 0)).toBe('out_of_range');
    expect(issueOf(q('rating'), 6)).toBe('out_of_range');
    expect(issueOf(q('rating'), 2.5)).toBe('invalid');
  });

  it('boundary: phone with 10 and 11 digits is accepted, 9 and 12 are invalid', () => {
    expect(accepted(q('phone'), '1198765432').ok).toBe(true);
    expect(accepted(q('phone'), '11987654321').ok).toBe(true);
    expect(issueOf(q('phone'), '119876543')).toBe('invalid');
    expect(issueOf(q('phone'), '119876543210')).toBe('invalid');
  });

  it('boundary: DDD 11 and 99 are accepted, 10 and 01 are invalid; 11 digits need the 9', () => {
    expect(accepted(q('phone'), '1198765432').ok).toBe(true);
    expect(accepted(q('phone'), '9998765432').ok).toBe(true);
    expect(issueOf(q('phone'), '1098765432')).toBe('invalid');
    expect(issueOf(q('phone'), '0198765432')).toBe('invalid');
    expect(issueOf(q('phone'), '11887654321')).toBe('invalid');
  });

  it('boundary: an e-mail of 254 characters is accepted, 255 is too_long; a link of 2048 and 2049', () => {
    // 64-character local part, then dot-separated labels of at most 63 characters
    const withLength = (n: number) => {
      const local = 'a'.repeat(64);
      const domainLength = n - local.length - 1;
      const labels = [];
      let left = domainLength - '.co'.length;
      while (left > 0) {
        const take = Math.min(63, left);
        labels.push('b'.repeat(take));
        left -= take + 1;
      }
      return `${local}@${labels.join('.')}.co`;
    };
    expect(withLength(254)).toHaveLength(254);
    expect(accepted(q('email'), withLength(254)).ok).toBe(true);
    expect(issueOf(q('email'), `${'a'.repeat(250)}@b.co`)).toBe('too_long');
    const link = (n: number) => `https://a.co/${'x'.repeat(n - 'https://a.co/'.length)}`;
    expect(accepted(q('link'), link(2048)).ok).toBe(true);
    expect(issueOf(q('link'), link(2049))).toBe('too_long');
  });
});

describe('12-03 - adjacency: equal limits, duplicate labels, ids over labels (PFORM-04, PFORM-06)', () => {
  it('adjacency: min equal to max accepts exactly that one number', () => {
    const def = q('number', { limits: { min: 7, max: 7 } });
    expect(parsedValue(def, 7)).toBe(7);
    expect(issueOf(def, 6)).toBe('out_of_range');
    expect(issueOf(def, 8)).toBe('out_of_range');
  });

  it('adjacency: min equal to max accepts exactly that one day', () => {
    const def = q('date', { limits: { min: '2026-05-05', max: '2026-05-05' } });
    expect(parsedValue(def, '2026-05-05')).toBe('2026-05-05');
    expect(issueOf(def, '2026-05-04')).toBe('out_of_range');
    expect(issueOf(def, '2026-05-06')).toBe('out_of_range');
  });

  it('adjacency: labels that differ only by case or surrounding spaces collide', () => {
    expect(normalizeOptionLabel(' Sim ')).toBe(normalizeOptionLabel('sim'));
    expect(normalizeOptionLabel('SIM')).toBe(normalizeOptionLabel('sim'));
    expect(normalizeOptionLabel('Sim')).not.toBe(normalizeOptionLabel('Sima'));
  });

  it('adjacency: an option id equal to another option label text is resolved by id only', () => {
    const def = q('single_choice', {
      options: [
        { id: A, label: B },
        { id: B, label: 'second' },
      ],
    });
    // B is both the label of the first option and the id of the second: the id wins.
    expect(parsedValue(def, B)).toEqual({ optionId: B, otherText: null });
    // the label text of an option is not an id
    expect(issueOf(q('single_choice', { options: [{ id: A, label: 'rótulo' }] }), 'rótulo')).toBe(
      'unknown_option',
    );
  });
});

describe('12-03 - empty: no answer is not an error (PFORM-04, PFORM-06)', () => {
  const NO_ANSWER = [null, undefined, '', '   ', '\n\t', []];

  it('empty: null, undefined, blank strings and [] parse to no answer for every type', () => {
    for (const type of PROFILE_FORM_TYPES) {
      const def = PROFILE_FORM_CHOICE_TYPES.includes(type as never) ? choice(type) : q(type);
      for (const raw of NO_ANSWER)
        expect(parseAnswer(def, raw), `${type} ${String(raw)}`).toEqual({
          ok: true,
          value: null,
        });
    }
  });

  it('empty: false for acceptance is no answer, false for yes_no is an answer', () => {
    expect(parseAnswer(q('acceptance'), false)).toEqual({ ok: true, value: null });
    expect(parseAnswer(q('yes_no'), false)).toEqual({ ok: true, value: false });
  });

  it('empty: a multiple_choice with optionIds [] and no "Outro" text is no answer', () => {
    const def = choice('multiple_choice', { allowOther: true });
    expect(parseAnswer(def, { optionIds: [] })).toEqual({ ok: true, value: null });
    expect(parseAnswer(def, { optionIds: [], otherText: '  ' })).toEqual({ ok: true, value: null });
    expect(parseAnswer(def, { optionIds: [], otherText: null })).toEqual({ ok: true, value: null });
  });

  it('empty: a single choice object with no selection and no text is no answer', () => {
    const def = choice('dropdown', { allowOther: true });
    expect(parseAnswer(def, { optionId: null, otherText: null })).toEqual({
      ok: true,
      value: null,
    });
    expect(parseAnswer(def, {})).toEqual({ ok: true, value: null });
  });

  it('empty: missingIssue is not_ticked for acceptance and required for every other type', () => {
    expect(missingIssue(q('acceptance', { required: true }))).toBe('not_ticked');
    for (const type of PROFILE_FORM_TYPES.filter((t) => t !== 'acceptance')) {
      expect(missingIssue(q(type, { required: true })), type).toBe('required');
    }
  });

  it('empty: nothing throws, whatever the garbage', () => {
    const garbage = [NaN, Infinity, {}, [[]], Symbol.iterator, () => 1, new Date(0), 10n, 'x'];
    for (const type of PROFILE_FORM_TYPES) {
      const def = PROFILE_FORM_CHOICE_TYPES.includes(type as never) ? choice(type) : q(type);
      for (const raw of garbage) expect(() => parseAnswer(def, raw), `${type}`).not.toThrow();
    }
  });
});

describe('12-03 - encoding: code points, trimming, digits only (PFORM-04, PFORM-06)', () => {
  it('encoding: a 120-emoji short text is accepted and 121 is refused (code points, not code units)', () => {
    expect(accepted(q('short_text'), '😀'.repeat(120)).ok).toBe(true);
    expect(issueOf(q('short_text'), '😀'.repeat(121))).toBe('too_long');
  });

  it('encoding: length is measured after trimming', () => {
    expect(accepted(q('short_text'), ` ${'a'.repeat(120)} `).ok).toBe(true);
  });

  it('encoding: the phone check strips nothing and accepts digits only', () => {
    expect(issueOf(q('phone'), '(11) 98765-4321')).toBe('invalid');
    expect(issueOf(q('phone'), '+5511987654321')).toBe('invalid');
    expect(issueOf(q('phone'), '11 98765432')).toBe('invalid');
    expect(issueOf(q('phone'), '１１９８７６５４３２１')).toBe('invalid');
  });

  it('encoding: an e-mail is trimmed and lower-cased before the check', () => {
    expect(parsedValue(q('email'), ' A.B@EXEMPLO.COM ')).toBe('a.b@exemplo.com');
    expect(issueOf(q('email'), 'sem-arroba')).toBe('invalid');
    expect(issueOf(q('email'), 'a b@exemplo.com')).toBe('invalid');
  });

  it('encoding: a link keeps its exact path and query and refuses every other scheme', () => {
    expect(parsedValue(q('link'), 'https://a.co/Caminho%20Com%20Espaco?q=1&r=%C3%A9')).toBe(
      'https://a.co/Caminho%20Com%20Espaco?q=1&r=%C3%A9',
    );
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://a.b',
      'file:///etc/passwd',
      '//a.co',
      'a.co',
      'https://a.co/ x',
    ]) {
      expect(issueOf(q('link'), bad), bad).toBe('invalid');
    }
  });

  it('encoding: option labels are measured in code points and normalised to NFC', () => {
    expect(normalizeOptionLabel('Ação')).toBe(normalizeOptionLabel('Ação'));
    expect(normalizeOptionLabel('  ÉCOLE ')).toBe('école');
  });
});

describe('12-03 - ordering: multiple choice follows the question, parsing is stable (PFORM-04)', () => {
  it("ordering: ['b','a','a'] over [a,b,c] stores the question's order without duplicates", () => {
    expect(parsedValue(choice('multiple_choice'), [B, A, A])).toEqual({
      optionIds: [A, B],
      otherText: null,
    });
    expect(parsedValue(choice('multiple_choice'), { optionIds: [C, B, A, C] })).toEqual({
      optionIds: [A, B, C],
      otherText: null,
    });
  });

  it('ordering: parsing the same input twice returns deeply equal values', () => {
    const def = choice('multiple_choice', { allowOther: true });
    const raw = { optionIds: [C, A], otherText: ' x ' };
    expect(parseAnswer(def, raw)).toEqual(parseAnswer(def, raw));
    expect(parseAnswer(q('number'), 12.25)).toEqual(parseAnswer(q('number'), 12.25));
    expect(parseAnswer(q('email'), 'A@B.CO')).toEqual(parseAnswer(q('email'), 'A@B.CO'));
  });

  it('ordering: the input is never mutated', () => {
    const raw = { optionIds: [C, A, A], otherText: ' x ' };
    const copy = structuredClone(raw);
    parseAnswer(choice('multiple_choice', { allowOther: true }), raw);
    expect(raw).toEqual(copy);
  });
});

describe('12-03 - precision: finite numbers, exact limits, calendar days (PFORM-04)', () => {
  it('precision: NaN, Infinity, -Infinity and 2**60 are invalid', () => {
    for (const n of [NaN, Infinity, -Infinity, 2 ** 60, -(2 ** 60), Number.MAX_SAFE_INTEGER + 2]) {
      expect(issueOf(q('number'), n), String(n)).toBe('invalid');
    }
    expect(accepted(q('number'), Number.MAX_SAFE_INTEGER).ok).toBe(true);
    expect(accepted(q('number'), -Number.MAX_SAFE_INTEGER).ok).toBe(true);
  });

  it('precision: a numeric string is not a number', () => {
    expect(issueOf(q('number'), '12')).toBe('invalid');
  });

  it('precision: limits are compared exactly, with no rounding and no tolerance', () => {
    const def = q('number', { limits: { min: 0.1, max: 0.3 } });
    expect(parsedValue(def, 0.1)).toBe(0.1);
    expect(parsedValue(def, 0.3)).toBe(0.3);
    expect(issueOf(def, 0.30000000000000004)).toBe('out_of_range');
    expect(parsedValue(q('number'), 1234.5)).toBe(1234.5);
  });

  it('precision: negative zero is stored as zero', () => {
    expect(Object.is(parsedValue(q('number'), -0), 0)).toBe(true);
  });

  it('precision: dates are real calendar days with no time zone', () => {
    expect(issueOf(q('date'), '2026-02-30')).toBe('invalid');
    expect(issueOf(q('date'), '2026-13-01')).toBe('invalid');
    expect(issueOf(q('date'), '2027-02-29')).toBe('invalid');
    expect(issueOf(q('date'), '2026-10-29T10:00:00Z')).toBe('invalid');
    expect(issueOf(q('date'), '29/10/2026')).toBe('invalid');
    expect(issueOf(q('date'), 20261029)).toBe('invalid');
  });
});

describe('12-03 - choices: options and "Outro" (PFORM-06, D-592)', () => {
  it('an id that is not in the question is unknown_option, including an id of another question', () => {
    expect(issueOf(choice('single_choice'), OTHER_QUESTION_OPTION)).toBe('unknown_option');
    expect(issueOf(choice('multiple_choice'), [A, OTHER_QUESTION_OPTION])).toBe('unknown_option');
    expect(issueOf(choice('dropdown'), { optionId: OTHER_QUESTION_OPTION })).toBe('unknown_option');
  });

  it('"Outro" text on a question without allowOther is other_not_allowed', () => {
    for (const type of PROFILE_FORM_CHOICE_TYPES) {
      expect(issueOf(choice(type), { otherText: 'x' }), type).toBe('other_not_allowed');
    }
    expect(issueOf(choice('multiple_choice'), { optionIds: [A], otherText: 'x' })).toBe(
      'other_not_allowed',
    );
  });

  it('a single choice with both an option and a text is invalid', () => {
    const def = choice('single_choice', { allowOther: true });
    expect(issueOf(def, { optionId: A, otherText: 'x' })).toBe('invalid');
    expect(issueOf(choice('dropdown', { allowOther: true }), { optionId: A, otherText: 'x' })).toBe(
      'invalid',
    );
  });

  it('a single choice refuses several options and an array', () => {
    expect(issueOf(choice('single_choice'), [A, B])).toBe('invalid');
    expect(issueOf(choice('dropdown'), [A])).toBe('invalid');
  });

  it('non-string ids and non-string text are invalid', () => {
    expect(issueOf(choice('multiple_choice'), [1])).toBe('invalid');
    expect(issueOf(choice('single_choice', { allowOther: true }), { otherText: 5 })).toBe(
      'invalid',
    );
    expect(issueOf(choice('single_choice'), 7)).toBe('invalid');
  });

  it('the "Outro" text is not counted in the 20-option limit (limit is a body rule, text is 120)', () => {
    expect(PROFILE_FORM_LIMITS.options).toBe(20);
    expect(PROFILE_FORM_LIMITS.otherText).toBe(120);
  });
});

describe('12-03 - the server never trusts a claimed type (T-12-05)', () => {
  it('the validator follows the stored type: a text sent to a number question is invalid', () => {
    expect(issueOf(q('number'), 'abc')).toBe('invalid');
    expect(issueOf(q('rating'), '5')).toBe('invalid');
    expect(issueOf(q('yes_no'), 'true')).toBe('invalid');
    expect(issueOf(q('acceptance'), 'true')).toBe('invalid');
    expect(issueOf(q('short_text'), 12)).toBe('invalid');
  });

  it('an object or an array is never a valid scalar', () => {
    for (const type of ['short_text', 'long_text', 'date', 'phone', 'email', 'link'] as const) {
      expect(issueOf(q(type), { value: 'x' }), type).toBe('invalid');
      expect(issueOf(q(type), ['x']), type).toBe('invalid');
    }
  });

  it('a forged type key in the raw value changes nothing', () => {
    expect(issueOf(q('number'), { type: 'short_text', value: 'x' })).toBe('invalid');
  });
});

// ── Task 2: the wire schemas ─────────────────────────────────────────────────────────────────

const issuesOf = (
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: { message: string; path: PropertyKey[] }[] };
    };
  },
  body: unknown,
) => {
  const result = schema.safeParse(body);
  if (result.success) throw new Error('expected a refusal');
  return (result.error?.issues ?? []).map((i) => i.message);
};

const label = (n: number) => ({ label: `Opção ${n}` });
const labels = (n: number) => Array.from({ length: n }, (_, i) => label(i + 1));

describe('12-03 - createQuestionBodySchema (PFORM-02, PFORM-06)', () => {
  it('accepts a minimal text question and fills the defaults', () => {
    const parsed = createQuestionBodySchema.parse({ type: 'short_text', title: '  Cidade  ' });
    expect(parsed).toEqual({
      type: 'short_text',
      title: 'Cidade',
      helpText: null,
      required: false,
      showOnProfile: false,
      allowOther: false,
      options: [],
      limits: {},
    });
  });

  it('accepts a choice question with 2 to 20 options and "Outro"', () => {
    expect(
      createQuestionBodySchema.safeParse({ type: 'dropdown', title: 'Estado', options: labels(2) })
        .success,
    ).toBe(true);
    expect(
      createQuestionBodySchema.safeParse({
        type: 'multiple_choice',
        title: 'Interesses',
        allowOther: true,
        options: labels(20),
      }).success,
    ).toBe(true);
  });

  it('refuses a choice question with 0 or 1 option (empty)', () => {
    for (const n of [0, 1]) {
      const codes = issuesOf(createQuestionBodySchema, {
        type: 'single_choice',
        title: 'x',
        options: labels(n),
      });
      expect(codes).toContain('invalid');
    }
  });

  it('refuses 21 options with limit_reached (boundary)', () => {
    expect(
      issuesOf(createQuestionBodySchema, { type: 'dropdown', title: 'x', options: labels(21) }),
    ).toContain('limit_reached');
  });

  it('refuses labels that collide after trimming, NFC and case folding (adjacency, encoding)', () => {
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'single_choice',
        title: 'x',
        options: [{ label: 'Sim' }, { label: ' sim ' }],
      }),
    ).toContain('invalid');
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'single_choice',
        title: 'x',
        options: [{ label: 'Ação' }, { label: 'AÇÃO' }],
      }),
    ).toContain('invalid');
  });

  it('refuses an empty option label and an option label over 80 code points', () => {
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'single_choice',
        title: 'x',
        options: [{ label: 'a' }, { label: '   ' }],
      }),
    ).toContain('required');
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'single_choice',
        title: 'x',
        options: [{ label: 'a' }, { label: 'b'.repeat(81) }],
      }),
    ).toContain('too_long');
    expect(
      createQuestionBodySchema.safeParse({
        type: 'single_choice',
        title: 'x',
        options: [{ label: 'a' }, { label: '😀'.repeat(80) }],
      }).success,
    ).toBe(true);
  });

  it('refuses options on a non-choice question and allowOther on a text question', () => {
    expect(
      issuesOf(createQuestionBodySchema, { type: 'number', title: 'x', options: labels(2) }),
    ).toContain('invalid');
    expect(
      issuesOf(createQuestionBodySchema, { type: 'short_text', title: 'x', allowOther: true }),
    ).toContain('other_not_allowed');
  });

  it('accepts limits only on number and date, finite and with min <= max', () => {
    expect(
      createQuestionBodySchema.safeParse({
        type: 'number',
        title: 'x',
        limits: { min: 1, max: 1 },
      }).success,
    ).toBe(true);
    expect(
      createQuestionBodySchema.safeParse({
        type: 'date',
        title: 'x',
        limits: { min: '2026-01-01', max: '2026-01-01' },
      }).success,
    ).toBe(true);
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'number',
        title: 'x',
        limits: { min: 5, max: 4 },
      }),
    ).toContain('out_of_range');
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'date',
        title: 'x',
        limits: { min: '2026-02-01', max: '2026-01-01' },
      }),
    ).toContain('out_of_range');
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'date',
        title: 'x',
        limits: { min: '2026-02-30' },
      }),
    ).toContain('invalid');
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'number',
        title: 'x',
        limits: { min: Number.POSITIVE_INFINITY },
      }),
    ).toContain('invalid');
    expect(
      issuesOf(createQuestionBodySchema, { type: 'number', title: 'x', limits: { min: '1' } }),
    ).toContain('invalid');
    expect(
      issuesOf(createQuestionBodySchema, { type: 'short_text', title: 'x', limits: { max: 5 } }),
    ).toContain('invalid');
  });

  it('title is 1 to 120 and help text at most 300 code points (boundary)', () => {
    expect(
      createQuestionBodySchema.safeParse({ type: 'short_text', title: 'a'.repeat(120) }).success,
    ).toBe(true);
    expect(
      issuesOf(createQuestionBodySchema, { type: 'short_text', title: 'a'.repeat(121) }),
    ).toEqual(['too_long']);
    expect(issuesOf(createQuestionBodySchema, { type: 'short_text', title: '   ' })).toEqual([
      'required',
    ]);
    expect(
      createQuestionBodySchema.safeParse({
        type: 'short_text',
        title: 'x',
        helpText: 'a'.repeat(300),
      }).success,
    ).toBe(true);
    expect(
      issuesOf(createQuestionBodySchema, {
        type: 'short_text',
        title: 'x',
        helpText: 'a'.repeat(301),
      }),
    ).toEqual(['too_long']);
    expect(
      createQuestionBodySchema.parse({ type: 'short_text', title: 'x', helpText: '   ' }).helpText,
    ).toBeNull();
  });

  it('required and showOnProfile are free on every type', () => {
    for (const type of PROFILE_FORM_TYPES) {
      const options = PROFILE_FORM_CHOICE_TYPES.includes(type as never) ? labels(2) : [];
      expect(
        createQuestionBodySchema.safeParse({
          type,
          title: 'x',
          required: true,
          showOnProfile: true,
          options,
        }).success,
        type,
      ).toBe(true);
    }
  });

  it('every message of a refused body is a code of the closed list', () => {
    const bodies: unknown[] = [
      {},
      { type: 'nope', title: 'x' },
      { type: 'short_text', title: 5 },
      { type: 'short_text', title: 'x', required: 'yes' },
      { type: 'dropdown', title: 'x', options: [{ label: 5 }, { label: 6 }] },
      { type: 'dropdown', title: 'x', options: labels(30) },
      { type: 'number', title: 'x', limits: { min: 3, max: 1 } },
    ];
    for (const body of bodies) {
      const result = createQuestionBodySchema.safeParse(body);
      expect(result.success).toBe(false);
      for (const issue of result.error?.issues ?? []) {
        if (issue.code === 'unrecognized_keys') continue;
        expect(PROFILE_FORM_ISSUE_SET.has(issue.message), issue.message).toBe(true);
      }
    }
  });

  it('refuses an unknown key (strict)', () => {
    expect(
      createQuestionBodySchema.safeParse({ type: 'short_text', title: 'x', position: 3 }).success,
    ).toBe(false);
  });
});

describe('12-03 - updateQuestionBodySchema, reorder and replace (PFORM-02, PFORM-17)', () => {
  it('needs the revision and accepts a partial edit with kept and new options', () => {
    expect(updateQuestionBodySchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateQuestionBodySchema.safeParse({ revision: 0 }).success).toBe(false);
    expect(updateQuestionBodySchema.safeParse({ revision: 1 }).success).toBe(true);
    expect(
      updateQuestionBodySchema.safeParse({
        revision: 3,
        title: 'Novo',
        required: true,
        options: [{ id: A, label: 'a' }, { label: 'nova' }],
      }).success,
    ).toBe(true);
  });

  it('keeps the option rules on an edit', () => {
    expect(
      issuesOf(updateQuestionBodySchema, { revision: 1, options: [{ label: 'a' }] }),
    ).toContain('invalid');
    expect(
      issuesOf(updateQuestionBodySchema, {
        revision: 1,
        options: [{ label: 'a' }, { label: 'A ' }],
      }),
    ).toContain('invalid');
    expect(
      issuesOf(updateQuestionBodySchema, { revision: 1, limits: { min: 2, max: 1 } }),
    ).toContain('out_of_range');
  });

  it('reorder takes 1 to 30 unique ids', () => {
    expect(reorderBodySchema.safeParse({ ids: [A, B] }).success).toBe(true);
    expect(issuesOf(reorderBodySchema, { ids: [] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { ids: [A, A] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { ids: ['x'] })).toContain('order_mismatch');
    const ids = Array.from(
      { length: 31 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(reorderBodySchema.safeParse({ ids: ids.slice(0, 30) }).success).toBe(true);
    expect(reorderBodySchema.safeParse({ ids }).success).toBe(false);
    // More than 30 ids is the keyed order_mismatch (the route's 409), not a generic validation issue.
    expect(issuesOf(reorderBodySchema, { ids })).toContain('order_mismatch');
  });

  it('12.1-09: reorder takes the legacy { ids } OR the layout { steps } for one release, and anything else is the keyed order_mismatch', () => {
    const [first, second] = [
      { id: A, questionIds: [B] },
      { id: C, questionIds: [] },
    ];
    // Both shapes parse, and each keeps its own strictness.
    expect(reorderBodySchema.safeParse({ ids: [A, B] }).success).toBe(true);
    expect(reorderBodySchema.safeParse({ steps: [first, second] }).success).toBe(true);
    // A body that is neither shape (or both at once) is the keyed mismatch, so the route answers its 409.
    expect(issuesOf(reorderBodySchema, {})).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { ids: [A], steps: [first] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { steps: [] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { steps: [first, first] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { steps: [{ id: A, questionIds: ['x'] }] })).toContain(
      'order_mismatch',
    );
    // The legacy refusals keep their text through the union.
    expect(issuesOf(reorderBodySchema, { ids: [A, A] })).toContain('order_mismatch');
    expect(issuesOf(reorderBodySchema, { ids: [] })).toContain('order_mismatch');
    // The legacy schema alone is still the strict Phase 12 body.
    expect(legacyReorderBodySchema.safeParse({ ids: [A], steps: [first] }).success).toBe(false);
  });

  it('replace is the create body plus the replaced id, with the same definition rules', () => {
    expect(
      replaceQuestionBodySchema.safeParse({ type: 'short_text', title: 'x', replaces: A }).success,
    ).toBe(true);
    expect(replaceQuestionBodySchema.safeParse({ type: 'short_text', title: 'x' }).success).toBe(
      false,
    );
    expect(
      issuesOf(replaceQuestionBodySchema, {
        type: 'dropdown',
        title: 'x',
        replaces: A,
        options: [],
      }),
    ).toContain('invalid');
  });
});

const memberQuestion = {
  id: A,
  type: 'multiple_choice',
  title: 'Interesses',
  helpText: null,
  required: true,
  showOnProfile: true,
  options: [
    { id: B, label: 'a' },
    { id: C, label: 'b' },
  ],
  allowOther: true,
  limits: {},
  stepId: C,
  condition: null,
  answer: { optionIds: [B], otherText: null },
};

describe('12-03 - member shapes (PFORM-07, PFORM-12, PFORM-16)', () => {
  it('memberFormSchema round-trips a sample, answered and unanswered', () => {
    const sample = {
      mode: 'returning',
      missingRequired: 1,
      formEtag: 'abc',
      steps: [{ id: C, title: 'Sobre você' }],
      questions: [
        memberQuestion,
        { ...memberQuestion, id: B, type: 'rating', options: [], allowOther: false, answer: null },
        {
          ...memberQuestion,
          id: C,
          type: 'number',
          options: [],
          allowOther: false,
          limits: { min: 1, max: 9 },
          answer: 4.5,
        },
      ],
    };
    expect(memberFormSchema.parse(sample)).toEqual(sample);
    expect(memberFormSchema.safeParse({ ...sample, mode: 'other' }).success).toBe(false);
  });

  it('12.1-11: the member form carries steps and each question its stepId and condition (D-628, D-630)', () => {
    const conditional = {
      ...memberQuestion,
      id: B,
      stepId: A,
      condition: { questionId: C, values: [B] },
    };
    const sample = {
      mode: 'first',
      missingRequired: 0,
      formEtag: 'abc',
      steps: [
        { id: C, title: 'Sobre você' },
        { id: A, title: 'Detalhes' },
      ],
      questions: [memberQuestion, conditional],
    };
    expect(memberFormSchema.parse(sample)).toEqual(sample);
    const { steps: _steps, ...withoutSteps } = sample;
    expect(memberFormSchema.safeParse(withoutSteps).success).toBe(false);
    const { stepId: _stepId, ...noStep } = memberQuestion;
    expect(memberFormSchema.safeParse({ ...sample, questions: [noStep] }).success).toBe(false);
    const { condition: _condition, ...noCondition } = memberQuestion;
    expect(memberFormSchema.safeParse({ ...sample, questions: [noCondition] }).success).toBe(false);
    expect(
      memberFormSchema.safeParse({
        ...sample,
        questions: [{ ...memberQuestion, condition: { questionId: C, values: [] } }],
      }).success,
    ).toBe(false);
  });

  it('saveAnswersBodySchema keys the answers by question id, at most 30 keys', () => {
    expect(
      saveAnswersBodySchema.safeParse({ formEtag: 'e', answers: { [A]: 'x', [B]: null, [C]: [1] } })
        .success,
    ).toBe(true);
    expect(saveAnswersBodySchema.safeParse({ formEtag: 'e', answers: { nope: 'x' } }).success).toBe(
      false,
    );
    expect(saveAnswersBodySchema.safeParse({ answers: {} }).success).toBe(false);
    const thirtyOne = Object.fromEntries(
      Array.from({ length: 31 }, (_, i) => [
        `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        'x',
      ]),
    );
    expect(issuesOf(saveAnswersBodySchema, { formEtag: 'e', answers: thirtyOne })).toContain(
      'limit_reached',
    );
  });

  it('the small result shapes round-trip', () => {
    expect(saveAnswersResultSchema.parse({ missingRequired: 0, missingQuestionIds: [] })).toEqual({
      missingRequired: 0,
      missingQuestionIds: [],
    });
    expect(saveAnswersResultSchema.parse({ missingRequired: 1, missingQuestionIds: [A] })).toEqual({
      missingRequired: 1,
      missingQuestionIds: [A],
    });
    expect(saveAnswersResultSchema.safeParse({ missingRequired: 0 }).success).toBe(false);
    expect(
      saveAnswersResultSchema.safeParse({ missingRequired: 1, missingQuestionIds: ['x'] }).success,
    ).toBe(false);
    expect(dismissNoticeResultSchema.parse({ newOptional: 2 })).toEqual({ newOptional: 2 });
    expect(profileFormBootstrapSchema.parse({ pendingRequired: 1, newOptional: 0 })).toEqual({
      pendingRequired: 1,
      newOptional: 0,
    });
    expect(
      profileFormBootstrapSchema.safeParse({ pendingRequired: -1, newOptional: 0 }).success,
    ).toBe(false);
  });
});

const STEP_ID = '55555555-5555-4555-8555-555555555555';

const adminQuestion = {
  id: A,
  stepId: STEP_ID,
  type: 'dropdown',
  title: 'Estado',
  helpText: 'Onde mora',
  required: false,
  showOnProfile: true,
  options: [
    { id: B, label: 'SP', answerCount: 3 },
    { id: C, label: 'RJ', answerCount: 0 },
  ],
  allowOther: false,
  limits: {},
  position: 1,
  revision: 2,
  answerCount: 3,
  condition: null,
  opensCount: 0,
  createdAt: '2026-10-29T10:00:00.000Z',
  listedAt: '2026-10-29T10:00:00.000Z',
};

describe('12-03 - admin and read shapes (PFORM-02, PFORM-18, PFORM-19, PFORM-23)', () => {
  it('adminQuestionSchema and archivedQuestionSchema round-trip', () => {
    expect(adminQuestionSchema.parse(adminQuestion)).toEqual(adminQuestion);
    const archived = { ...adminQuestion, archivedAt: '2026-10-30T10:00:00.000Z' };
    expect(archivedQuestionSchema.parse(archived)).toEqual(archived);
    expect(archivedQuestionSchema.safeParse(adminQuestion).success).toBe(false);
  });

  it('12.1-08: every admin and archived question carries a uuid stepId, and the list carries steps and stepLimit', () => {
    const { stepId: _omitted, ...withoutStep } = adminQuestion;
    expect(adminQuestionSchema.safeParse(withoutStep).success).toBe(false);
    expect(adminQuestionSchema.safeParse({ ...adminQuestion, stepId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(
      archivedQuestionSchema.safeParse({
        ...withoutStep,
        archivedAt: '2026-10-30T10:00:00.000Z',
      }).success,
    ).toBe(false);

    const step = { id: STEP_ID, title: 'Etapa', position: 1, revision: 1, questionCount: 1 };
    const list = {
      questions: [adminQuestion],
      activeCount: 1,
      limit: 30,
      steps: [step],
      stepLimit: PROFILE_FORM_LIMITS.steps,
    };
    expect(adminQuestionListSchema.parse(list)).toEqual(list);
    // The empty form: no question and no step (a read never creates the default step).
    const empty = { questions: [], activeCount: 0, limit: 30, steps: [], stepLimit: 10 };
    expect(adminQuestionListSchema.parse(empty)).toEqual(empty);
    // Both new keys are required, and a step needs its count.
    expect(
      adminQuestionListSchema.safeParse({ questions: [], activeCount: 0, limit: 30 }).success,
    ).toBe(false);
    expect(adminQuestionListSchema.safeParse({ ...list, stepLimit: 0 }).success).toBe(false);
    expect(
      adminQuestionListSchema.safeParse({ ...list, steps: [{ ...step, questionCount: undefined }] })
        .success,
    ).toBe(false);
  });

  it('12.1-08: the default step title is the confirmed literal and fits the step title limit', () => {
    expect(PROFILE_FORM_DEFAULT_STEP_TITLE).toBe('Informações gerais');
    expect([...PROFILE_FORM_DEFAULT_STEP_TITLE].length).toBeLessThanOrEqual(
      PROFILE_FORM_LIMITS.stepTitle,
    );
    expect(createStepBodySchema.safeParse({ title: PROFILE_FORM_DEFAULT_STEP_TITLE }).success).toBe(
      true,
    );
  });

  it('12.1-08: deleteStepResultSchema is { deleted: true } and nothing else', () => {
    expect(deleteStepResultSchema.parse({ deleted: true })).toEqual({ deleted: true });
    expect(deleteStepResultSchema.safeParse({ deleted: false }).success).toBe(false);
    expect(deleteStepResultSchema.safeParse({}).success).toBe(false);
  });

  it('the summary and the impact shapes round-trip; the impact query names one of four changes', () => {
    expect(profileFormSummarySchema.parse({ total: 10, complete: 4, hasRequired: true })).toEqual({
      total: 10,
      complete: 4,
      hasRequired: true,
    });
    expect(impactResultSchema.parse({ members: 7 })).toEqual({ members: 7 });
    for (const change of ['create_required', 'make_required', 'reactivate', 'replace']) {
      expect(impactQuerySchema.safeParse({ change }).success).toBe(true);
    }
    expect(impactQuerySchema.safeParse({ change: 'archive' }).success).toBe(false);
    expect(impactQuerySchema.safeParse({ change: 'replace', questionId: A }).success).toBe(true);
    expect(impactQuerySchema.safeParse({ change: 'replace', questionId: 'x' }).success).toBe(false);
  });

  it('12.1-10: the admin question carries condition (nullable) and opensCount (an integer from 0)', () => {
    const conditional = {
      ...adminQuestion,
      condition: { questionId: B, values: [C] },
      opensCount: 0,
    };
    expect(adminQuestionSchema.parse(conditional)).toEqual(conditional);
    const opener = { ...adminQuestion, opensCount: 2 };
    expect(adminQuestionSchema.parse(opener)).toEqual(opener);
    const { condition: _c, ...withoutCondition } = adminQuestion;
    expect(adminQuestionSchema.safeParse(withoutCondition).success).toBe(false);
    const { opensCount: _o, ...withoutOpens } = adminQuestion;
    expect(adminQuestionSchema.safeParse(withoutOpens).success).toBe(false);
    expect(adminQuestionSchema.safeParse({ ...adminQuestion, opensCount: -1 }).success).toBe(false);
    expect(adminQuestionSchema.safeParse({ ...adminQuestion, opensCount: 1.5 }).success).toBe(
      false,
    );
    // The condition is the shared schema: an empty value set is refused.
    expect(
      adminQuestionSchema.safeParse({ ...adminQuestion, condition: { questionId: B, values: [] } })
        .success,
    ).toBe(false);
    const archived = { ...conditional, archivedAt: '2026-10-30T10:00:00.000Z' };
    expect(archivedQuestionSchema.parse(archived)).toEqual(archived);
  });

  it('12.1-10: remove_condition is the LAST impact change and the query takes the optional condition', () => {
    expect(PROFILE_FORM_IMPACT_CHANGES.at(-1)).toBe('remove_condition');
    expect(PROFILE_FORM_IMPACT_CHANGES.slice(0, 4)).toEqual([
      'create_required',
      'make_required',
      'reactivate',
      'replace',
    ]);
    expect(impactQuerySchema.safeParse({ change: 'remove_condition', questionId: A }).success).toBe(
      true,
    );
    expect(
      impactQuerySchema.safeParse({
        change: 'create_required',
        conditionQuestionId: B,
        conditionValues: `${C},true`,
      }).success,
    ).toBe(true);
    // Strict, a uuid opener and a bounded value list.
    expect(
      impactQuerySchema.safeParse({ change: 'replace', conditionQuestionId: 'x' }).success,
    ).toBe(false);
    expect(
      impactQuerySchema.safeParse({ change: 'replace', conditionValues: 'a'.repeat(2001) }).success,
    ).toBe(false);
    expect(impactQuerySchema.safeParse({ change: 'replace', other: 1 }).success).toBe(false);
  });

  it('12.1-10: parseConditionValues splits on commas, trims and drops empty tokens', () => {
    expect(parseConditionValues('a, b ,,c,')).toEqual(['a', 'b', 'c']);
    expect(parseConditionValues('true')).toEqual(['true']);
    expect(parseConditionValues('')).toEqual([]);
    expect(parseConditionValues(' , ,')).toEqual([]);
  });

  it('publicAnswersSchema rejects an unknown key at either level (strictness)', () => {
    const row = {
      questionId: A,
      title: 'Estado',
      type: 'dropdown',
      options: [{ id: B, label: 'SP' }],
      value: { optionId: B, otherText: null },
    };
    const sample = { kind: 'member', answers: [row] };
    expect(publicAnswersSchema.parse(sample)).toEqual(sample);
    expect(publicAnswersSchema.safeParse({ ...sample, extra: 1 }).success).toBe(false);
    expect(
      publicAnswersSchema.safeParse({ kind: 'member', answers: [{ ...row, showOnProfile: true }] })
        .success,
    ).toBe(false);
    expect(
      publicAnswersSchema.safeParse({ kind: 'member', answers: [{ ...row, email: 'a@b.co' }] })
        .success,
    ).toBe(false);
    expect(publicAnswersSchema.safeParse({ kind: 'staff', answers: [] }).success).toBe(false);
  });

  it('staffAnswersSchema carries the flags staff need and stays strict', () => {
    const row = {
      questionId: A,
      title: 'Estado',
      type: 'dropdown',
      options: [{ id: B, label: 'SP' }],
      value: null,
      showOnProfile: false,
      position: 2,
      archivedAt: null,
      answered: false,
      required: true,
      condition: null,
    };
    const sample = { kind: 'staff', answers: [row] };
    expect(staffAnswersSchema.parse(sample)).toEqual(sample);
    expect(
      staffAnswersSchema.safeParse({ kind: 'staff', answers: [{ ...row, extra: 1 }] }).success,
    ).toBe(false);
    // 12.1 (D-634, UI-D-659): the row carries its condition (or null) and the key is required.
    const conditioned = { ...row, condition: { questionId: B, values: ['true'] } };
    expect(staffAnswersSchema.parse({ kind: 'staff', answers: [conditioned] }).answers[0]).toEqual(
      conditioned,
    );
    const { condition: _omitted, ...withoutCondition } = row;
    expect(
      staffAnswersSchema.safeParse({ kind: 'staff', answers: [withoutCondition] }).success,
    ).toBe(false);
    // Only a condition shape, never an answer value, can ride on the row.
    expect(
      staffAnswersSchema.safeParse({
        kind: 'staff',
        answers: [{ ...row, condition: { questionId: B, values: ['true'], value: 'x' } }],
      }).success,
    ).toBe(false);
    // The public rows are not touched: no condition key is accepted there.
    expect(
      publicAnswersSchema.safeParse({
        kind: 'member',
        answers: [
          {
            questionId: A,
            title: 'T',
            type: 'short_text',
            options: [],
            value: 'x',
            condition: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('12-03 - answerEtag', () => {
  it('is the id:revision pairs in list order, and changes with a revision or the order', () => {
    const list = [
      { id: A, revision: 1 },
      { id: B, revision: 4 },
    ];
    expect(answerEtag(list)).toBe(`${A}:1|${B}:4`);
    expect(answerEtag([{ id: A, revision: 2 }, list[1] as (typeof list)[number]])).not.toBe(
      answerEtag(list),
    );
    expect(answerEtag([...list].reverse())).not.toBe(answerEtag(list));
    expect(answerEtag([])).toBe('');
  });
});

describe('12-REVIEW WR-02 - NUL and unpaired surrogates are refused as invalid, never thrown or stored', () => {
  const NUL = 'a\u0000b';
  const LONE_HIGH = 'a\uD83Db';
  const LONE_LOW = 'a\uDE00b';

  it('hasUnsafeChars flags NUL and lone surrogates and passes well-formed text, emoji included', () => {
    expect(hasUnsafeChars(NUL)).toBe(true);
    expect(hasUnsafeChars(LONE_HIGH)).toBe(true);
    expect(hasUnsafeChars(LONE_LOW)).toBe(true);
    expect(hasUnsafeChars('Ação 😀')).toBe(false);
  });

  it('a short or long text answer with a bad character is the keyed invalid, not a throw', () => {
    for (const type of ['short_text', 'long_text'] as const) {
      for (const bad of [NUL, LONE_HIGH, LONE_LOW, '\u0000']) {
        expect(issueOf(q(type), bad), `${type} ${JSON.stringify(bad)}`).toBe('invalid');
      }
    }
    expect(accepted(q('short_text'), 'Ação 😀').ok).toBe(true);
  });

  it('a link answer with a lone surrogate is the keyed invalid, not a value Postgres would refuse', () => {
    // The URL parser accepts these, so only the shared check catches them (phase 12 security audit).
    for (const bad of ['https://a.com/\uD800', 'https://a.com/x\uDE00y', 'https://a.com/\u0000']) {
      expect(issueOf(q('link'), bad), JSON.stringify(bad)).toBe('invalid');
    }
    expect(accepted(q('link'), 'https://a.com/%F0%9F%98%80').ok).toBe(true);
  });

  it('the "Outro" text of a choice answer is refused the same way', () => {
    for (const bad of [NUL, LONE_HIGH]) {
      expect(issueOf(choice('single_choice', { allowOther: true }), { otherText: bad })).toBe(
        'invalid',
      );
      expect(
        issueOf(choice('multiple_choice', { allowOther: true }), {
          optionIds: [A],
          otherText: bad,
        }),
      ).toBe('invalid');
    }
  });

  it('a question title, help text and option label with a bad character fail with invalid', () => {
    for (const bad of [NUL, LONE_HIGH]) {
      expect(issuesOf(createQuestionBodySchema, { type: 'short_text', title: bad })).toContain(
        'invalid',
      );
      expect(
        issuesOf(createQuestionBodySchema, { type: 'short_text', title: 'x', helpText: bad }),
      ).toContain('invalid');
      expect(
        issuesOf(createQuestionBodySchema, {
          type: 'dropdown',
          title: 'x',
          options: [{ label: bad }, { label: 'ok' }],
        }),
      ).toContain('invalid');
      expect(issuesOf(updateQuestionBodySchema, { revision: 1, title: bad })).toContain('invalid');
      expect(issuesOf(updateQuestionBodySchema, { revision: 1, helpText: bad })).toContain(
        'invalid',
      );
      expect(
        issuesOf(updateQuestionBodySchema, {
          revision: 1,
          options: [{ label: bad }, { label: 'ok' }],
        }),
      ).toContain('invalid');
      expect(
        issuesOf(replaceQuestionBodySchema, { type: 'short_text', title: bad, replaces: A }),
      ).toContain('invalid');
    }
  });
});

describe('12.1-01 - the visibility rule: stored answer to tokens to visible (D-621, D-628, PFORM-41)', () => {
  const OPENER = '55555555-5555-4555-8555-555555555555';
  const STEP_1 = '66666666-6666-4666-8666-666666666661';
  const STEP_2 = '66666666-6666-4666-8666-666666666662';
  const STEP_3 = '66666666-6666-4666-8666-666666666663';

  it('answerTokens reads the three stored shapes and nothing else', () => {
    expect(answerTokens(true)).toEqual(['true']);
    expect(answerTokens(false)).toEqual(['false']);
    expect(answerTokens({ optionId: A, otherText: null })).toEqual([A]);
    expect(answerTokens({ optionId: null, otherText: 'x' })).toEqual([]);
    expect(answerTokens({ optionIds: [A, B], otherText: null })).toEqual([A, B]);
    expect(answerTokens({ optionIds: [], otherText: 'x' })).toEqual([]);
    for (const other of ['text', 7, null, undefined]) expect(answerTokens(other)).toEqual([]);
  });

  it('isQuestionVisible: no condition is visible, a condition needs one shared token', () => {
    const tokens = (map: Record<string, string[]>) => (id: string) => map[id];
    expect(isQuestionVisible({ condition: null }, () => undefined)).toBe(true);
    const shown = { condition: { questionId: OPENER, values: [A, B] } };
    expect(isQuestionVisible(shown, tokens({ [OPENER]: [B, C] }))).toBe(true);
    expect(isQuestionVisible(shown, tokens({ [OPENER]: [C] }))).toBe(false);
    expect(isQuestionVisible(shown, tokens({}))).toBe(false);
    expect(isQuestionVisible(shown, tokens({ [OPENER]: [] }))).toBe(false);
  });

  it('visibleSteps keeps the step order, drops a step with only hidden or no questions', () => {
    const steps = [{ id: STEP_1 }, { id: STEP_2 }, { id: STEP_3 }];
    const shown = (id: string, stepId: string) => ({
      id,
      stepId,
      condition: { questionId: OPENER, values: ['true'] },
    });
    const tokensOf = (id: string) => (id === OPENER ? ['false'] : undefined);
    // step 1: one free question among hidden ones; step 2: only hidden; step 3: no question at all.
    const questions = [
      { id: OPENER, stepId: STEP_1, condition: null },
      shown(A, STEP_1),
      shown(B, STEP_2),
      shown(C, STEP_2),
    ];
    expect(visibleSteps(steps, questions, tokensOf)).toEqual([STEP_1]);
    expect(visibleSteps(steps, questions, () => ['true'])).toEqual([STEP_1, STEP_2]);
    expect(visibleSteps([...steps].reverse(), questions, () => ['true'])).toEqual([STEP_2, STEP_1]);
    expect(visibleSteps(steps, [], tokensOf)).toEqual([]);
  });

  it('the parity table has the planned breadth', () => {
    expect(PROFILE_FORM_VISIBILITY_CASES.length).toBeGreaterThanOrEqual(14);
    const names = PROFILE_FORM_VISIBILITY_CASES.map((row) => row.name).join('\n');
    for (const needle of [
      'yes_no true',
      'yes_no false',
      'Outro',
      'unanswered',
      'any-of',
      'unknown',
    ]) {
      expect(names).toContain(needle);
    }
    expect(new Set(PROFILE_FORM_VISIBILITY_CASES.map((row) => row.name)).size).toBe(
      PROFILE_FORM_VISIBILITY_CASES.length,
    );
    expect(PROFILE_FORM_VISIBILITY_CASES.some((row) => row.expected)).toBe(true);
    expect(PROFILE_FORM_VISIBILITY_CASES.some((row) => !row.expected)).toBe(true);
  });

  for (const row of PROFILE_FORM_VISIBILITY_CASES) {
    it(`parity row: ${row.name}`, () => {
      const tokens = answerTokens(row.stored);
      const visible = isQuestionVisible(
        { condition: { questionId: OPENER, values: row.values } },
        () => tokens,
      );
      expect(visible).toBe(row.expected);
    });
  }
});

describe('12.1-01 - limits, opener types and the condition schema (D-620, D-621, D-633, T-12.1-17)', () => {
  const OPENER = '55555555-5555-4555-8555-555555555555';
  const tokens = (count: number) => Array.from({ length: count }, (_, i) => `token-${i}`);

  it('the opener types are the four of D-620, in the order of PROFILE_FORM_TYPES, and nothing else', () => {
    expect(PROFILE_FORM_CONDITION_OPENER_TYPES).toEqual([
      'dropdown',
      'multiple_choice',
      'single_choice',
      'yes_no',
    ]);
    const positions = PROFILE_FORM_CONDITION_OPENER_TYPES.map((type) =>
      PROFILE_FORM_TYPES.indexOf(type),
    );
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
    for (const type of [
      'number',
      'date',
      'short_text',
      'phone',
      'email',
      'link',
      'acceptance',
      'rating',
    ]) {
      expect(PROFILE_FORM_CONDITION_OPENER_TYPES).not.toContain(type);
    }
  });

  it('a condition is strict { questionId, values } with 1 to 20 unique non-empty tokens', () => {
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: ['true'] }).success,
    ).toBe(true);
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: tokens(20) }).success,
    ).toBe(true);
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: tokens(21) }).success,
    ).toBe(false);
    expect(profileFormConditionSchema.safeParse({ questionId: OPENER, values: [] }).success).toBe(
      false,
    );
    expect(profileFormConditionSchema.safeParse({ questionId: OPENER, values: [''] }).success).toBe(
      false,
    );
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: ['x'.repeat(64)] })
        .success,
    ).toBe(true);
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: ['x'.repeat(65)] })
        .success,
    ).toBe(false);
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: ['a', 'a'] }).success,
    ).toBe(false);
    expect(
      profileFormConditionSchema.safeParse({ questionId: 'nope', values: ['a'] }).success,
    ).toBe(false);
    // D-622: no chain, no parent.
    expect(
      profileFormConditionSchema.safeParse({ questionId: OPENER, values: ['a'], parent: OPENER })
        .success,
    ).toBe(false);
  });

  it('a refused condition carries the condition_invalid code the route hook lifts', () => {
    const result = profileFormConditionSchema.safeParse({ questionId: OPENER, values: [] });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages).toEqual(['condition_invalid']);
    expect(PROFILE_FORM_ISSUE_SET.has('condition_invalid')).toBe(true);
  });

  it('create, update and replace accept the optional stepId and condition, and update takes null to remove one', () => {
    const condition = { questionId: OPENER, values: ['true'] };
    expect(
      createQuestionBodySchema.safeParse({ type: 'short_text', title: 'x', stepId: A, condition })
        .success,
    ).toBe(true);
    expect(createQuestionBodySchema.safeParse({ type: 'short_text', title: 'x' }).success).toBe(
      true,
    );
    expect(
      createQuestionBodySchema.safeParse({ type: 'short_text', title: 'x', stepId: 'nope' })
        .success,
    ).toBe(false);
    expect(
      issuesOf(createQuestionBodySchema, { type: 'short_text', title: 'x', stepId: 'nope' }),
    ).toContain('unknown_step');
    expect(
      replaceQuestionBodySchema.safeParse({
        type: 'short_text',
        title: 'x',
        replaces: A,
        stepId: B,
        condition,
      }).success,
    ).toBe(true);
    expect(updateQuestionBodySchema.safeParse({ revision: 1, condition }).success).toBe(true);
    expect(updateQuestionBodySchema.safeParse({ revision: 1, condition: null }).success).toBe(true);
    expect(updateQuestionBodySchema.safeParse({ revision: 1, stepId: A }).success).toBe(true);
    expect(
      updateQuestionBodySchema.safeParse({
        revision: 1,
        condition: { questionId: OPENER, values: [] },
      }).success,
    ).toBe(false);
  });

  it('saveAnswersBodySchema takes an optional stepId and stays strict', () => {
    const base = { formEtag: 'e', answers: {} };
    expect(saveAnswersBodySchema.safeParse(base).success).toBe(true);
    expect(saveAnswersBodySchema.safeParse({ ...base, stepId: A }).success).toBe(true);
    expect(saveAnswersBodySchema.safeParse({ ...base, stepId: 'nope' }).success).toBe(false);
    expect(saveAnswersBodySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('12.1-01 - step and layout schemas (D-629, D-632, D-633, T-12.1-17)', () => {
  const stepsOf = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      questionIds: [] as string[],
    }));
  const qid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('a step title is 1 to 60 code points, trimmed, on create and update', () => {
    expect(createStepBodySchema.safeParse({ title: 'x'.repeat(60) }).success).toBe(true);
    expect(createStepBodySchema.safeParse({ title: 'x'.repeat(61) }).success).toBe(false);
    expect(issuesOf(createStepBodySchema, { title: 'x'.repeat(61) })).toContain('too_long');
    expect(issuesOf(createStepBodySchema, { title: '   ' })).toContain('required');
    expect(createStepBodySchema.safeParse({ title: 'ok', extra: 1 }).success).toBe(false);
    expect(updateStepBodySchema.safeParse({ revision: 1, title: 'x'.repeat(60) }).success).toBe(
      true,
    );
    expect(updateStepBodySchema.safeParse({ revision: 1, title: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(updateStepBodySchema.safeParse({ revision: 0, title: 'ok' }).success).toBe(false);
  });

  it('a layout accepts 10 steps and refuses 11, 31 question ids and a repeated id', () => {
    expect(layoutBodySchema.safeParse({ steps: stepsOf(10) }).success).toBe(true);
    expect(layoutBodySchema.safeParse({ steps: stepsOf(11) }).success).toBe(false);
    expect(layoutBodySchema.safeParse({ steps: [] }).success).toBe(false);
    const thirty = Array.from({ length: 30 }, (_, i) => qid(i + 1));
    expect(
      layoutBodySchema.safeParse({ steps: [{ id: stepsOf(1)[0]?.id, questionIds: thirty }] })
        .success,
    ).toBe(true);
    expect(
      layoutBodySchema.safeParse({
        steps: [{ id: stepsOf(1)[0]?.id, questionIds: [...thirty, qid(31)] }],
      }).success,
    ).toBe(false);
    const [first, second] = stepsOf(2);
    expect(
      layoutBodySchema.safeParse({
        steps: [
          { id: first?.id, questionIds: [qid(1)] },
          { id: second?.id, questionIds: [qid(1)] },
        ],
      }).success,
    ).toBe(false);
    expect(issuesOf(layoutBodySchema, { steps: [first, first] })).toContain('order_mismatch');
    expect(layoutBodySchema.safeParse({ steps: stepsOf(1), extra: 1 }).success).toBe(false);
  });

  it('the member and admin step shapes and the has_dependents body parse their samples', () => {
    expect(memberStepSchema.parse({ id: A, title: 'Sobre você' })).toEqual({
      id: A,
      title: 'Sobre você',
    });
    const admin = { id: A, title: 't', position: 0, revision: 1, questionCount: 0 };
    expect(adminStepSchema.parse(admin)).toEqual(admin);
    expect(adminStepSchema.safeParse({ ...admin, revision: 0 }).success).toBe(false);
    const body = { profileForm: 'has_dependents', dependents: [{ id: B, title: 'Qual?' }] };
    expect(hasDependentsDetailsSchema.parse(body)).toEqual(body);
    expect(hasDependentsDetailsSchema.safeParse({ ...body, profileForm: 'x' }).success).toBe(false);
    expect(dependentSchema.safeParse({ id: 'nope', title: 't' }).success).toBe(false);
  });

  it('answerEtag keeps its old output and changes with a stepId or a step revision', () => {
    const list = [
      { id: A, revision: 1 },
      { id: B, revision: 4 },
    ];
    expect(answerEtag(list)).toBe(`${A}:1|${B}:4`);
    expect(answerEtag([])).toBe('');
    const moved = [{ id: A, revision: 1, stepId: C }, list[1] as (typeof list)[number]];
    expect(answerEtag(moved)).toBe(`${A}:1:${C}|${B}:4`);
    expect(answerEtag(moved)).not.toBe(answerEtag(list));
    const other = [{ id: A, revision: 1, stepId: B }, list[1] as (typeof list)[number]];
    expect(answerEtag(other)).not.toBe(answerEtag(moved));
    const steps = [{ id: C, revision: 1 }];
    expect(answerEtag(list, steps)).toBe(`${A}:1|${B}:4;steps=${C}:1`);
    expect(answerEtag(list, [{ id: C, revision: 2 }])).not.toBe(answerEtag(list, steps));
    expect(answerEtag(list, [])).toBe(`${A}:1|${B}:4;steps=`);
  });
});
