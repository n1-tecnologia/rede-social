// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import {
  draftFromStored,
  emptyDraft,
  errorSpec,
  firstInvalidId,
  flaggedIds,
  initialAnswers,
  isEmptyDraft,
  isFormatType,
  issueFor,
  limitHint,
  mergeFreshForm,
  missingErrorIds,
  settleOnBlur,
  toWire,
  validateAll,
  validateOnBlur,
  wireAnswers,
} from './form-state';
import { branch, form, options, question } from './test-fixtures';

/**
 * 12-12 (D-582, UI-D-582, UI-D-586, UI-D-587; T-12-30) — the pure state of the completion screen:
 * drafts to wire values per type, the contract validator on the whole screen, which questions are
 * flagged, and the merge of a fresh form after a 409. Answers never touch the browser's storage.
 */

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('toWire: a draft becomes what parseAnswer accepts', () => {
  it('text-like types send the string, blank is null', () => {
    for (const type of ['short_text', 'long_text', 'date', 'email'] as const) {
      const q = question(type);
      expect(toWire(q, 'abc')).toBe('abc');
      expect(toWire(q, '   ')).toBeNull();
      expect(toWire(q, '')).toBeNull();
    }
  });

  it('phone keeps digits only and drops a pasted +55 country code', () => {
    const q = question('phone');
    expect(toWire(q, '(11) 91234-5678')).toBe('11912345678');
    expect(toWire(q, '+55 11 91234-5678')).toBe('11912345678');
    expect(toWire(q, '5511912345678')).toBe('11912345678');
    expect(toWire(q, 'abc')).toBe('abc');
    expect(toWire(q, '')).toBeNull();
  });

  it('number accepts the pt-BR comma and the dot, and leaves a non-number as text', () => {
    const q = question('number');
    expect(toWire(q, '12,5')).toBe(12.5);
    expect(toWire(q, '12.5')).toBe(12.5);
    expect(toWire(q, '1.234,5')).toBe(1234.5);
    expect(toWire(q, '-3')).toBe(-3);
    expect(toWire(q, 'abc')).toBe('abc');
    expect(toWire(q, '')).toBeNull();
  });

  it('yes/no, acceptance and rating', () => {
    expect(toWire(question('yes_no'), true)).toBe(true);
    expect(toWire(question('yes_no'), false)).toBe(false);
    expect(toWire(question('yes_no'), null)).toBeNull();
    expect(toWire(question('acceptance'), true)).toBe(true);
    expect(toWire(question('acceptance'), false)).toBeNull();
    expect(toWire(question('rating'), 4)).toBe(4);
    expect(toWire(question('rating'), null)).toBeNull();
  });

  it('single answer choices send one option, or the typed Outro text, never both', () => {
    const opts = options('A', 'B');
    for (const type of ['dropdown', 'single_choice'] as const) {
      const q = question(type, { options: opts, allowOther: true });
      expect(toWire(q, { optionIds: [opts[1]?.id ?? ''], other: false, otherText: '' })).toEqual({
        optionId: opts[1]?.id,
        otherText: null,
      });
      expect(toWire(q, { optionIds: [], other: true, otherText: 'Outra' })).toEqual({
        optionId: null,
        otherText: 'Outra',
      });
      expect(toWire(q, { optionIds: [], other: false, otherText: '' })).toBeNull();
    }
  });

  it('multiple choice sends the ids and the Outro text', () => {
    const opts = options('A', 'B', 'C');
    const q = question('multiple_choice', { options: opts, allowOther: true });
    expect(
      toWire(q, { optionIds: [opts[0]?.id ?? '', opts[2]?.id ?? ''], other: true, otherText: 'x' }),
    ).toEqual({ optionIds: [opts[0]?.id, opts[2]?.id], otherText: 'x' });
    expect(toWire(q, { optionIds: [opts[0]?.id ?? ''], other: false, otherText: 'x' })).toEqual({
      optionIds: [opts[0]?.id],
      otherText: null,
    });
  });
});

describe('initialAnswers: the screen is always pre-filled from the stored answers', () => {
  it('maps every stored shape back to a draft', () => {
    const opts = options('A', 'B');
    const questions = [
      question('short_text', { answer: 'Designer' }),
      question('number', { answer: 12.5 }),
      question('yes_no', { answer: false }),
      question('acceptance', { answer: true }),
      question('rating', { answer: 3 }),
      question('dropdown', {
        options: opts,
        answer: { optionId: opts[1]?.id ?? '', otherText: null },
      }),
      question('single_choice', {
        options: opts,
        allowOther: true,
        answer: { optionId: null, otherText: 'Outra' },
      }),
      question('multiple_choice', {
        options: opts,
        answer: { optionIds: [opts[0]?.id ?? ''], otherText: null },
      }),
      question('email'),
    ];
    const answers = initialAnswers({ questions });
    const at = (i: number) => answers[questions[i]?.id ?? ''];
    expect(at(0)).toBe('Designer');
    expect(at(1)).toBe('12,5');
    expect(at(2)).toBe(false);
    expect(at(3)).toBe(true);
    expect(at(4)).toBe(3);
    expect(at(5)).toEqual({ optionIds: [opts[1]?.id], other: false, otherText: '' });
    expect(at(6)).toEqual({ optionIds: [], other: true, otherText: 'Outra' });
    expect(at(7)).toEqual({ optionIds: [opts[0]?.id], other: false, otherText: '' });
    expect(at(8)).toBe('');
  });

  it('a stored answer that went through toWire comes back equal (the round trip)', () => {
    const q = question('number', { answer: 1234.5 });
    expect(toWire(q, draftFromStored(q))).toBe(1234.5);
  });
});

describe('validateAll: the contract validator on the whole screen (UI-D-586)', () => {
  it('returns the keyed issues for required-and-empty, in the admin order', () => {
    const a = question('short_text', { required: true });
    const b = question('acceptance', { required: true });
    const c = question('short_text');
    const d = question('dropdown', { required: true, options: options('A', 'B') });
    const errors = validateAll([a, b, c, d], initialAnswers({ questions: [a, b, c, d] }));
    expect(errors).toEqual({ [a.id]: 'required', [b.id]: 'not_ticked', [d.id]: 'required' });
    expect(Object.keys(errors)).toEqual([a.id, b.id, d.id]);
  });

  it('an optional blank question is fine; a required answered one is fine', () => {
    const a = question('short_text', { required: true });
    const b = question('number');
    expect(validateAll([a, b], { [a.id]: 'x', [b.id]: '' })).toEqual({});
  });

  it('format and range refusals come from the same parseAnswer the server runs', () => {
    const num = question('number', { limits: { min: 1, max: 10 } });
    const email = question('email');
    const phone = question('phone');
    const link = question('link');
    const date = question('date', { limits: { min: '2026-01-01', max: '2026-12-31' } });
    const errors = validateAll([num, email, phone, link, date], {
      [num.id]: '11',
      [email.id]: 'nope',
      [phone.id]: '123',
      [link.id]: 'ftp://x',
      [date.id]: '2027-01-01',
    });
    expect(errors).toEqual({
      [num.id]: 'out_of_range',
      [email.id]: 'invalid',
      [phone.id]: 'invalid',
      [link.id]: 'invalid',
      [date.id]: 'out_of_range',
    });
  });

  it('a chosen Outro with no text is other_required (a client-only rule)', () => {
    const q = question('single_choice', { allowOther: true, options: options('A', 'B') });
    expect(issueFor(q, { optionIds: [], other: true, otherText: '  ' })).toBe('other_required');
    expect(issueFor(q, { optionIds: [], other: true, otherText: 'x' })).toBeNull();
  });

  it('text over the cap is too_long', () => {
    const q = question('short_text');
    expect(issueFor(q, 'x'.repeat(121))).toBe('too_long');
  });
});

describe('flags, the first invalid question and the blank test', () => {
  it('flaggedIds lists only the required questions with no stored answer', () => {
    const a = question('short_text', { required: true });
    const b = question('short_text', { required: true, answer: 'ok' });
    const c = question('short_text');
    expect(flaggedIds({ questions: [a, b, c] })).toEqual([a.id]);
  });

  it('missingErrorIds keeps only the left-blank issues; firstInvalidId follows the admin order', () => {
    const a = question('short_text');
    const b = question('short_text');
    const errors = { [b.id]: 'required', [a.id]: 'too_long' } as const;
    expect(missingErrorIds(errors)).toEqual([b.id]);
    expect(firstInvalidId([a, b], errors)).toBe(a.id);
    expect(firstInvalidId([a, b], {})).toBeNull();
  });

  it('isEmptyDraft knows every draft shape', () => {
    expect(isEmptyDraft('short_text', '  ')).toBe(true);
    expect(isEmptyDraft('short_text', 'x')).toBe(false);
    expect(isEmptyDraft('acceptance', false)).toBe(true);
    expect(isEmptyDraft('acceptance', true)).toBe(false);
    expect(isEmptyDraft('yes_no', false)).toBe(false);
    expect(isEmptyDraft('rating', null)).toBe(true);
    expect(isEmptyDraft('rating', 2)).toBe(false);
    expect(isEmptyDraft('dropdown', emptyDraft('dropdown'))).toBe(true);
    expect(isEmptyDraft('dropdown', { optionIds: [], other: true, otherText: '' })).toBe(false);
  });
});

describe('mergeFreshForm: a 409 refreshes the list and keeps what was typed (UI-D-587)', () => {
  it('keeps typed answers of surviving questions, drops the removed, keeps the fresh order', () => {
    const a = question('short_text');
    const b = question('short_text');
    const gone = question('short_text');
    const added = question('short_text', { required: true });
    const current = { questions: [a, gone, b] };
    const typed = { [a.id]: 'typed A', [gone.id]: 'typed gone', [b.id]: 'typed B' };
    const fresh = form([b, added, a], { formEtag: 'etag-2' });
    const merged = mergeFreshForm(current, typed, fresh);
    expect(merged.form.questions.map((q) => q.id)).toEqual([b.id, added.id, a.id]);
    expect(merged.answers).toEqual({ [b.id]: 'typed B', [added.id]: '', [a.id]: 'typed A' });
    expect(merged.answers[gone.id]).toBeUndefined();
    expect(merged.flagged).toEqual([added.id]);
  });

  it('flags a question that became required and is still blank, not one already answered', () => {
    const before = question('short_text', { required: false });
    const becameRequired = { ...before, required: true };
    const blank = mergeFreshForm(
      { questions: [before] },
      { [before.id]: '' },
      form([becameRequired]),
    );
    expect(blank.flagged).toEqual([before.id]);
    const typed = mergeFreshForm(
      { questions: [before] },
      { [before.id]: 'x' },
      form([becameRequired]),
    );
    expect(typed.flagged).toEqual([]);
  });

  it('prunes options that no longer exist from a kept choice draft and re-reads a retyped question', () => {
    const opts = options('A', 'B', 'C');
    const choice = question('multiple_choice', { options: opts });
    const typed = {
      [choice.id]: {
        optionIds: [opts[0]?.id ?? '', opts[2]?.id ?? ''],
        other: false,
        otherText: '',
      },
    };
    const fresh = form([{ ...choice, options: [opts[0] ?? { id: '', label: '' }] }]);
    const merged = mergeFreshForm({ questions: [choice] }, typed, fresh);
    expect(merged.answers[choice.id]).toEqual({
      optionIds: [opts[0]?.id],
      other: false,
      otherText: '',
    });

    const retyped = mergeFreshForm(
      { questions: [choice] },
      typed,
      form([{ ...choice, type: 'short_text', options: [], answer: 'stored' }]),
    );
    expect(retyped.answers[choice.id]).toBe('stored');
  });
});

describe('messages: which sentence explains which refusal (UI-D-586)', () => {
  it('maps issues to catalog keys by type', () => {
    expect(errorSpec(question('short_text'), 'required').key).toBe('errors.required');
    expect(errorSpec(question('dropdown'), 'required').key).toBe('errors.choice');
    expect(errorSpec(question('multiple_choice'), 'required').key).toBe('errors.multiple');
    expect(errorSpec(question('acceptance'), 'not_ticked').key).toBe('errors.acceptance');
    expect(errorSpec(question('short_text'), 'too_long')).toEqual({
      key: 'errors.tooLong',
      values: { max: 120 },
    });
    expect(errorSpec(question('phone'), 'invalid').key).toBe('errors.phone');
    expect(errorSpec(question('short_text'), 'unknown_question').key).toBe('errors.generic');
  });

  it('range sentences carry the formatted limits', () => {
    const num = question('number', { limits: { min: 1, max: 1500 } });
    expect(errorSpec(num, 'out_of_range')).toEqual({
      key: 'errors.numberRange',
      values: { min: '1', max: '1.500' },
    });
    const date = question('date', { limits: { min: '2026-01-31' } });
    expect(errorSpec(date, 'out_of_range')).toEqual({
      key: 'errors.dateMin',
      values: { min: '31/01/2026' },
    });
    expect(limitHint(question('number', { limits: { max: 5 } }))).toEqual({
      key: 'controls.until',
      values: { max: '5' },
    });
    expect(limitHint(question('short_text'))).toBeNull();
  });
});

describe('answers never touch the browser storage (T-12-30)', () => {
  it('leaves both stores empty after exercising every function with a secret answer', () => {
    const q = question('short_text', { required: true });
    const f = form([q]);
    const answers = { [q.id]: 'segredo-do-membro' };
    validateAll(f.questions, answers);
    wireAnswers(f.questions, answers);
    initialAnswers(f);
    mergeFreshForm(f, answers, f);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('validateOnBlur: the contract judges a format control when the member leaves it (12-13)', () => {
  it('a phone with the wrong DDD or no leading 9 is refused, a good one passes, empty is never an issue', () => {
    const q = question('phone');
    expect(validateOnBlur(q, '0198765432')).toBe('invalid');
    expect(validateOnBlur(q, '11887654321')).toBe('invalid');
    expect(validateOnBlur(q, '123')).toBe('invalid');
    expect(validateOnBlur(q, '11912345678')).toBeNull();
    expect(validateOnBlur(q, '1112345678')).toBeNull();
    expect(validateOnBlur(q, '')).toBeNull();
    expect(validateOnBlur(question('phone', { required: true }), '')).toBeNull();
  });

  it('e-mail, link, number and date use the same refusals as validateAll', () => {
    expect(validateOnBlur(question('email'), 'nope')).toBe('invalid');
    expect(validateOnBlur(question('email'), 'a@b.com')).toBeNull();
    expect(validateOnBlur(question('link'), 'ftp://x')).toBe('invalid');
    expect(validateOnBlur(question('link'), 'javascript:alert(1)')).toBe('invalid');
    expect(validateOnBlur(question('link'), 'exemplo.com.br')).toBeNull();
    expect(validateOnBlur(question('number'), 'abc')).toBe('invalid');
    expect(validateOnBlur(question('number', { limits: { min: 1, max: 10 } }), '11')).toBe(
      'out_of_range',
    );
    expect(validateOnBlur(question('number', { limits: { min: 1, max: 10 } }), '1,5')).toBeNull();
    const date = question('date', { limits: { min: '2026-01-01', max: '2026-12-31' } });
    expect(validateOnBlur(date, '2027-01-01')).toBe('out_of_range');
    expect(validateOnBlur(date, '2026-06-15')).toBeNull();
    expect(validateOnBlur(date, '2026-02-31')).toBe('invalid');
  });

  it('has no rule for the eight other types', () => {
    for (const type of ['short_text', 'long_text', 'yes_no', 'rating', 'acceptance'] as const) {
      expect(isFormatType(type)).toBe(false);
      expect(validateOnBlur(question(type), 'x'.repeat(5000))).toBeNull();
    }
    for (const type of ['number', 'date', 'phone', 'email', 'link'] as const) {
      expect(isFormatType(type)).toBe(true);
    }
  });

  it('agrees with validateAll on every case it judges (one rule, no second copy)', () => {
    const cases: [ReturnType<typeof question>, string][] = [
      [question('phone'), '0198765432'],
      [question('email'), 'x@'],
      [question('link'), 'ftp://x'],
      [question('number', { limits: { max: 3 } }), '4'],
      [question('date'), '2026-13-01'],
    ];
    for (const [q, text] of cases) {
      expect(validateOnBlur(q, text)).toBe(validateAll([q], { [q.id]: text })[q.id] ?? null);
    }
  });
});

describe('settleOnBlur: the text a format control shows after the member leaves it (12-13)', () => {
  it('a number comes back as it was parsed, in pt-BR form', () => {
    const q = question('number');
    expect(settleOnBlur(q, '1.234,5')).toBe('1234,5');
    expect(settleOnBlur(q, '1.5')).toBe('1,5');
    expect(settleOnBlur(q, '1.234')).toBe('1234');
    expect(settleOnBlur(q, 'abc')).toBe('abc');
    expect(settleOnBlur(q, '')).toBe('');
  });

  it('a link gets its https:// and a refused scheme is left alone', () => {
    const q = question('link');
    expect(settleOnBlur(q, 'exemplo.com.br')).toBe('https://exemplo.com.br');
    expect(settleOnBlur(q, 'javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(settleOnBlur(q, '')).toBe('');
  });

  it('the other types are left exactly as typed', () => {
    expect(settleOnBlur(question('email'), ' A@B.com ')).toBe(' A@B.com ');
    expect(settleOnBlur(question('phone'), '11912345678')).toBe('11912345678');
    expect(settleOnBlur(question('date'), '2026-06-15')).toBe('2026-06-15');
  });
});

describe('the string the member sees converts to exactly the stored shape and back (PFORM-14, 26)', () => {
  it('phone: the mask converts to the national number and the stored number to the digits', () => {
    const q = question('phone');
    expect(toWire(q, '(11) 91234-5678')).toBe('11912345678');
    expect(toWire(q, '(11) 1234-5678')).toBe('1112345678');
    expect(draftFromStored({ ...q, answer: '11912345678' })).toBe('11912345678');
    expect(validateAll([q], { [q.id]: '(11) 91234-5678' })).toEqual({});
  });

  it('number: the pt-BR text converts to a JSON number and the stored number comes back with a comma', () => {
    const q = question('number');
    for (const [shown, stored] of [
      ['1234,5', 1234.5],
      ['1.234,5', 1234.5],
      ['12', 12],
      ['-3,25', -3.25],
      ['0,5', 0.5],
    ] as const) {
      expect(toWire(q, shown)).toBe(stored);
      expect(typeof toWire(q, shown)).toBe('number');
    }
    expect(draftFromStored({ ...q, answer: 1234.5 })).toBe('1234,5');
    expect(draftFromStored({ ...q, answer: -3.25 })).toBe('-3,25');
    expect(toWire(q, draftFromStored({ ...q, answer: 1234.5 }))).toBe(1234.5);
  });

  it('date: the ISO day goes through unchanged both ways, with no time zone', () => {
    const q = question('date');
    expect(toWire(q, '2026-06-15')).toBe('2026-06-15');
    expect(draftFromStored({ ...q, answer: '2026-06-15' })).toBe('2026-06-15');
  });

  it('e-mail: the text is sent as typed and the server stores it trimmed and lower-cased', () => {
    const q = question('email');
    expect(toWire(q, 'nome@exemplo.com.br')).toBe('nome@exemplo.com.br');
    expect(draftFromStored({ ...q, answer: 'nome@exemplo.com.br' })).toBe('nome@exemplo.com.br');
  });

  it('link: a bare address is sent with https:// and an http or https link is sent as typed', () => {
    const q = question('link');
    expect(toWire(q, 'exemplo.com.br')).toBe('https://exemplo.com.br');
    expect(toWire(q, 'http://exemplo.com.br/a?b=1')).toBe('http://exemplo.com.br/a?b=1');
    expect(toWire(q, 'ftp://x')).toBe('ftp://x');
    expect(draftFromStored({ ...q, answer: 'https://exemplo.com.br' })).toBe(
      'https://exemplo.com.br',
    );
  });

  it('an ambiguous number is sent as the documented rule reads it, or as text so it is refused', () => {
    const q = question('number');
    expect(toWire(q, '1.234')).toBe(1234);
    expect(toWire(q, '1.5')).toBe(1.5);
    expect(toWire(q, '1,2,3')).toBe('1,2,3');
    expect(validateAll([q], { [q.id]: '1,2,3' })).toEqual({ [q.id]: 'invalid' });
  });
});

describe('limitHint: a date question shows its limits too', () => {
  it('uses dd/MM/yyyy with no time zone', () => {
    expect(
      limitHint(question('date', { limits: { min: '2026-01-01', max: '2026-12-31' } })),
    ).toEqual({ key: 'controls.between', values: { min: '01/01/2026', max: '31/12/2026' } });
    expect(limitHint(question('date', { limits: { min: '2026-01-31' } }))).toEqual({
      key: 'controls.from',
      values: { min: '31/01/2026' },
    });
    expect(limitHint(question('date', { limits: { max: '2026-12-31' } }))).toEqual({
      key: 'controls.until',
      values: { max: '31/12/2026' },
    });
    expect(limitHint(question('date'))).toBeNull();
  });
});

describe('the visible set drives the form state (12.1-13 task 1: D-631, Pitfall 10, UI-D-662)', () => {
  const opts = options('A', 'B');
  const [optA, optB] = [opts[0]?.id ?? '', opts[1]?.id ?? ''];
  const picked = (id: string) => ({ optionIds: [id], other: false, otherText: '' });

  function conditioned() {
    const opener = question('single_choice', { options: opts });
    const whenA = branch({ openerQuestionId: opener.id, values: [optA] });
    const hiddenRequired = question('short_text', { required: true, branchId: whenA.id });
    return { opener, hiddenRequired, whenA, questions: [opener, hiddenRequired] };
  }

  it('flaggedIds flags a required unanswered question only when it is visible by the stored answers', () => {
    const { opener, hiddenRequired, whenA } = conditioned();
    expect(flaggedIds(form([opener, hiddenRequired], { branches: [whenA] }))).toEqual([]);
    const answered = { ...opener, answer: { optionId: optA, otherText: null } };
    expect(flaggedIds(form([answered, hiddenRequired], { branches: [whenA] }))).toEqual([
      hiddenRequired.id,
    ]);
  });

  it('validateAll does not judge a hidden required question and judges a revealed one', () => {
    const { opener, hiddenRequired, whenA, questions } = conditioned();
    const branches = [whenA];
    expect(
      validateAll(
        questions,
        { [opener.id]: picked(optB), [hiddenRequired.id]: '' },
        undefined,
        branches,
      ),
    ).toEqual({});
    expect(
      validateAll(
        questions,
        { [opener.id]: picked(optA), [hiddenRequired.id]: '' },
        undefined,
        branches,
      ),
    ).toEqual({
      [hiddenRequired.id]: 'required',
    });
  });

  it('wireAnswers leaves a hidden question out of the body and sends a visible one', () => {
    const { opener, hiddenRequired, whenA, questions } = conditioned();
    const closed = wireAnswers(
      questions,
      { [opener.id]: picked(optB), [hiddenRequired.id]: 'typed' },
      undefined,
      [whenA],
    );
    expect(Object.keys(closed)).toEqual([opener.id]);
    const open = wireAnswers(
      questions,
      { [opener.id]: picked(optA), [hiddenRequired.id]: 'typed' },
      undefined,
      [whenA],
    );
    expect(open[hiddenRequired.id]).toBe('typed');
  });

  it('without the branches a question that names a branch is hidden: validate and wire fail closed (D-644)', () => {
    const { opener, hiddenRequired, questions } = conditioned();
    const drafts = { [opener.id]: picked(optA), [hiddenRequired.id]: 'typed' };
    expect(validateAll(questions, { ...drafts, [hiddenRequired.id]: '' })).toEqual({});
    expect(Object.keys(wireAnswers(questions, drafts))).toEqual([opener.id]);
  });

  it('the step scope restricts validateAll and wireAnswers to the questions of one step', () => {
    const inStepOne = question('short_text', { required: true });
    const otherStep = '00000000-0000-4000-8000-000000000999';
    const inStepTwo = question('short_text', { required: true, stepId: otherStep });
    const all = [inStepOne, inStepTwo];
    const scope = new Set([inStepOne.id]);
    expect(validateAll(all, {}, scope)).toEqual({ [inStepOne.id]: 'required' });
    expect(
      Object.keys(wireAnswers(all, { [inStepOne.id]: 'a', [inStepTwo.id]: 'b' }, scope)),
    ).toEqual([inStepOne.id]);
    expect(flaggedIds(form(all), scope)).toEqual([inStepOne.id]);
  });

  it('mergeFreshForm keeps typed drafts of surviving questions and carries stepId, branchId, branches and steps', () => {
    const { opener, hiddenRequired } = conditioned();
    const otherStep = '00000000-0000-4000-8000-000000000998';
    const whenB = branch({ openerQuestionId: opener.id, values: [optB] });
    const movedDependent = { ...hiddenRequired, stepId: otherStep, branchId: whenB.id };
    const fresh = form([opener, movedDependent], {
      steps: [
        { id: opener.stepId, title: 'Etapa 1' },
        { id: otherStep, title: 'Etapa 2' },
      ],
      branches: [whenB],
    });
    const merged = mergeFreshForm(
      { questions: [opener, hiddenRequired] },
      { [opener.id]: picked(optB), [hiddenRequired.id]: 'typed' },
      fresh,
    );
    expect(merged.answers[hiddenRequired.id]).toBe('typed');
    expect(merged.form.steps.map((s) => s.id)).toEqual([opener.stepId, otherStep]);
    const carried = merged.form.questions.find((q) => q.id === hiddenRequired.id);
    expect(carried?.stepId).toBe(otherStep);
    expect(carried?.branchId).toBe(whenB.id);
    expect(merged.form.branches).toEqual([whenB]);
  });

  it('mergeFreshForm flags a newly required question only while it is visible', () => {
    const { opener, hiddenRequired, whenA } = conditioned();
    const wasOptional = { ...hiddenRequired, required: false };
    const fresh = form([opener, hiddenRequired], { branches: [whenA] });
    const shut = mergeFreshForm(
      { questions: [opener, wasOptional] },
      { [opener.id]: picked(optB), [hiddenRequired.id]: '' },
      fresh,
    );
    expect(shut.flagged).toEqual([]);
    const open = mergeFreshForm(
      { questions: [opener, wasOptional] },
      { [opener.id]: picked(optA), [hiddenRequired.id]: '' },
      fresh,
    );
    expect(open.flagged).toEqual([hiddenRequired.id]);
  });

  describe('a nested block: a question under two branches (D-641, D-644)', () => {
    function nested() {
      const opener = question('single_choice', { options: opts });
      const first = branch({ openerQuestionId: opener.id, values: [optA] });
      const middle = question('yes_no', { branchId: first.id });
      const second = branch({ openerQuestionId: middle.id, values: ['true'] });
      const leaf = question('short_text', { required: true, branchId: second.id });
      const wasOptional = { ...leaf, required: false };
      const fresh = form([opener, middle, leaf], { branches: [first, second] });
      return { opener, middle, leaf, wasOptional, fresh };
    }

    it('keeps the draft typed under a block the fresh form still shows', () => {
      const { opener, middle, leaf, wasOptional, fresh } = nested();
      const merged = mergeFreshForm(
        { questions: [opener, middle, wasOptional] },
        { [opener.id]: picked(optA), [middle.id]: true, [leaf.id]: 'typed' },
        fresh,
      );
      expect(merged.answers[leaf.id]).toBe('typed');
      expect(merged.flagged).toEqual([]);
    });

    it('flags a newly required blank question only while every branch above it is open', () => {
      const { opener, middle, leaf, wasOptional, fresh } = nested();
      const current = { questions: [opener, middle, wasOptional] };
      const open = mergeFreshForm(
        current,
        { [opener.id]: picked(optA), [middle.id]: true, [leaf.id]: '' },
        fresh,
      );
      expect(open.flagged).toEqual([leaf.id]);
      const middleClosed = mergeFreshForm(
        current,
        { [opener.id]: picked(optA), [middle.id]: false, [leaf.id]: '' },
        fresh,
      );
      expect(middleClosed.flagged).toEqual([]);
      const topClosed = mergeFreshForm(
        current,
        { [opener.id]: picked(optB), [middle.id]: true, [leaf.id]: '' },
        fresh,
      );
      expect(topClosed.flagged).toEqual([]);
    });
  });
});
