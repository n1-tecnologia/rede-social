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
  issueFor,
  limitHint,
  mergeFreshForm,
  missingErrorIds,
  toWire,
  validateAll,
  wireAnswers,
} from './form-state';
import { form, options, question } from './test-fixtures';

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
    for (const type of ['short_text', 'long_text', 'date', 'email', 'link'] as const) {
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
