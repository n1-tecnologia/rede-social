import { describe, expect, it } from 'vitest';
import {
  adminQuestionSchema,
  answerEtag,
  answerValueSchema,
  archivedQuestionSchema,
  createQuestionBodySchema,
  dismissNoticeResultSchema,
  hasUnsafeChars,
  impactQuerySchema,
  impactResultSchema,
  memberFormSchema,
  missingIssue,
  normalizeOptionLabel,
  PROFILE_FORM_CHOICE_TYPES,
  PROFILE_FORM_ISSUE_SET,
  PROFILE_FORM_ISSUES,
  PROFILE_FORM_LIMITS,
  PROFILE_FORM_MODES,
  PROFILE_FORM_TYPES,
  type ProfileFormQuestionDef,
  type ProfileFormType,
  parseAnswer,
  profileFormBootstrapSchema,
  profileFormSummarySchema,
  publicAnswersSchema,
  reorderBodySchema,
  replaceQuestionBodySchema,
  saveAnswersBodySchema,
  saveAnswersResultSchema,
  staffAnswersSchema,
  updateQuestionBodySchema,
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
    });
  });

  it('the refusal list is closed, unique and mirrored by the lookup set', () => {
    expect(new Set(PROFILE_FORM_ISSUES).size).toBe(PROFILE_FORM_ISSUES.length);
    expect(PROFILE_FORM_ISSUES).toHaveLength(21);
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
  answer: { optionIds: [B], otherText: null },
};

describe('12-03 - member shapes (PFORM-07, PFORM-12, PFORM-16)', () => {
  it('memberFormSchema round-trips a sample, answered and unanswered', () => {
    const sample = {
      mode: 'returning',
      missingRequired: 1,
      formEtag: 'abc',
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
    expect(saveAnswersResultSchema.parse({ missingRequired: 0 })).toEqual({ missingRequired: 0 });
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

const adminQuestion = {
  id: A,
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
    };
    const sample = { kind: 'staff', answers: [row] };
    expect(staffAnswersSchema.parse(sample)).toEqual(sample);
    expect(
      staffAnswersSchema.safeParse({ kind: 'staff', answers: [{ ...row, extra: 1 }] }).success,
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
