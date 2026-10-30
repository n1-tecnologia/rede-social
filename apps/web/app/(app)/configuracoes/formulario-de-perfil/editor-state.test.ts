import { describe, expect, it } from 'vitest';
import {
  addOptionRow,
  blankDraft,
  canSave,
  changeType,
  hasErrors,
  isDirty,
  moveOptionRow,
  type OptionDraft,
  parseLimits,
  removeOptionRow,
  renameOptionRow,
  reopeningOf,
  serverFieldError,
  serverLimitsError,
  serverOptionsErrors,
  toCreateBody,
  validateDraft,
  validateOptions,
} from './editor-state';

/**
 * 12-16 Task 1 (D-590, D-592, UI-D-569): the pure draft of the question editor, with no rendering. The
 * rules are the sheet's; the server repeats every one of them.
 */

describe('blankDraft', () => {
  it('starts with no type, nothing typed, both switches off and two empty option rows', () => {
    const draft = blankDraft();
    expect(draft.type).toBeNull();
    expect(draft.title).toBe('');
    expect(draft.helpText).toBe('');
    expect(draft.required).toBe(false);
    expect(draft.showOnProfile).toBe(false);
    expect(draft.allowOther).toBe(false);
    expect(draft.options).toHaveLength(2);
    expect(draft.options.every((option) => option.label === '' && option.id === undefined)).toBe(
      true,
    );
    expect(new Set(draft.options.map((option) => option.key)).size).toBe(2);
  });
});

describe('canSave', () => {
  it('needs a type and a non-empty title', () => {
    const draft = blankDraft();
    expect(canSave(draft)).toBe(false);
    expect(canSave({ ...draft, type: 'short_text' })).toBe(false);
    expect(canSave({ ...draft, type: 'short_text', title: '   ' })).toBe(false);
    expect(canSave({ ...draft, title: 'Cargo' })).toBe(false);
    expect(canSave({ ...draft, type: 'short_text', title: 'Cargo' })).toBe(true);
  });
});

describe('changeType', () => {
  it('keeps the options and "Outro" between two choice types', () => {
    const draft = {
      ...changeType(blankDraft(), 'dropdown'),
      allowOther: true,
    };
    draft.options[0] = {
      ...draft.options[0],
      label: 'Instagram',
    } as (typeof draft.options)[number];
    const next = changeType(draft, 'single_choice');
    expect(next.type).toBe('single_choice');
    expect(next.options).toBe(draft.options);
    expect(next.allowOther).toBe(true);
  });

  it('drops the options and "Outro" for a type that cannot carry them', () => {
    const next = changeType({ ...blankDraft(), type: 'dropdown', allowOther: true }, 'short_text');
    expect(next.options).toEqual([]);
    expect(next.allowOther).toBe(false);
  });

  it('seeds two empty rows when a non-choice question becomes a choice one', () => {
    const next = changeType(
      { ...blankDraft(), type: 'short_text', options: [] },
      'multiple_choice',
    );
    expect(next.options).toHaveLength(2);
    expect(next.options.every((option) => option.label === '')).toBe(true);
  });

  it('keeps a limit pair only when the type stays number or date', () => {
    const base = { ...blankDraft(), type: 'number' as const, min: '1', max: '9' };
    expect(changeType(base, 'number')).toMatchObject({ min: '1', max: '9' });
    expect(changeType(base, 'date')).toMatchObject({ min: '', max: '' });
    expect(changeType(base, 'rating')).toMatchObject({ min: '', max: '' });
  });

  it('keeps the title, the help text and the switches', () => {
    const base = {
      ...blankDraft(),
      type: 'short_text' as const,
      title: 'Cargo',
      helpText: 'Seu cargo atual',
      required: true,
      showOnProfile: true,
    };
    expect(changeType(base, 'long_text')).toMatchObject({
      title: 'Cargo',
      helpText: 'Seu cargo atual',
      required: true,
      showOnProfile: true,
    });
  });
});

describe('toCreateBody', () => {
  it('trims the texts and turns an empty help text into null', () => {
    const body = toCreateBody({
      ...blankDraft(),
      type: 'short_text',
      title: '  Qual é o seu cargo?  ',
      helpText: '   ',
      required: true,
    });
    expect(body).toEqual({
      type: 'short_text',
      title: 'Qual é o seu cargo?',
      helpText: null,
      required: true,
      showOnProfile: false,
      allowOther: false,
      options: [],
      limits: {},
    });
  });

  it('refuses to build a body without a type', () => {
    expect(() => toCreateBody({ ...blankDraft(), title: 'x' })).toThrow();
  });

  it('carries the options and "Outro" only for a choice type', () => {
    const choice = changeType({ ...blankDraft(), title: 'Origem' }, 'single_choice');
    choice.options = [
      { key: 'a', label: ' Instagram ' },
      { key: 'b', label: 'Indicação' },
    ];
    choice.allowOther = true;
    expect(toCreateBody(choice)).toMatchObject({
      allowOther: true,
      options: [{ label: 'Instagram' }, { label: 'Indicação' }],
    });
    const text = toCreateBody({ ...choice, type: 'short_text' });
    expect(text.allowOther).toBe(false);
    expect(text.options).toEqual([]);
  });

  it('parses a number limit with the pt-BR rule and passes a date limit as the ISO day', () => {
    expect(
      toCreateBody({ ...blankDraft(), type: 'number', title: 'Idade', min: '1.000,5', max: '2000' })
        .limits,
    ).toEqual({ min: 1000.5, max: 2000 });
    expect(
      toCreateBody({
        ...blankDraft(),
        type: 'date',
        title: 'Início',
        min: '2026-01-01',
        max: '',
      }).limits,
    ).toEqual({ min: '2026-01-01' });
    expect(
      toCreateBody({ ...blankDraft(), type: 'rating', title: 'Nota', min: '1' }).limits,
    ).toEqual({});
  });
});

describe('parseLimits', () => {
  it('flags a number text that is not a number and ignores empty ones', () => {
    expect(parseLimits({ type: 'number', min: 'abc', max: '' })).toEqual({
      limits: {},
      invalid: { min: true, max: false },
    });
    expect(parseLimits({ type: 'short_text', min: '1', max: '2' })).toEqual({
      limits: {},
      invalid: { min: false, max: false },
    });
  });
});

describe('isDirty', () => {
  it('is false for the draft the sheet opened with and true after any change', () => {
    const initial = blankDraft();
    expect(isDirty(initial, { ...initial })).toBe(false);
    expect(isDirty(initial, { ...initial, title: 'x' })).toBe(true);
    expect(isDirty(initial, { ...initial, required: true })).toBe(true);
    expect(isDirty(initial, changeType(initial, 'short_text'))).toBe(true);
  });

  it('ignores the client row keys', () => {
    const initial = blankDraft();
    const renamed = {
      ...initial,
      options: initial.options.map((o) => ({ ...o, key: `${o.key}-x` })),
    };
    expect(isDirty(initial, renamed)).toBe(false);
  });
});

describe('validateDraft', () => {
  it('requires a title', () => {
    const errors = validateDraft({ ...blankDraft(), type: 'short_text', title: '  ' });
    expect(errors.title).toEqual({ key: 'errors.titleRequired' });
    expect(hasErrors(errors)).toBe(true);
  });

  it('caps the title at 120 and the help text at 300 code points', () => {
    const ok = validateDraft({
      ...blankDraft(),
      type: 'short_text',
      title: '😀'.repeat(120),
      helpText: '😀'.repeat(300),
    });
    expect(hasErrors(ok)).toBe(false);
    const bad = validateDraft({
      ...blankDraft(),
      type: 'short_text',
      title: '😀'.repeat(121),
      helpText: '😀'.repeat(301),
    });
    expect(bad.title).toEqual({ key: 'errors.tooLong', values: { max: 120 } });
    expect(bad.helpText).toEqual({ key: 'errors.tooLong', values: { max: 300 } });
  });

  it('is clean for a typed title', () => {
    expect(hasErrors(validateDraft({ ...blankDraft(), type: 'email', title: 'E-mail' }))).toBe(
      false,
    );
  });
});

describe('serverFieldError', () => {
  it('maps the codes a field can come back with and nothing else', () => {
    expect(serverFieldError('title', 'required')).toEqual({ key: 'errors.titleRequired' });
    expect(serverFieldError('title', 'too_long')).toEqual({
      key: 'errors.tooLong',
      values: { max: 120 },
    });
    expect(serverFieldError('helpText', 'too_long')).toEqual({
      key: 'errors.tooLong',
      values: { max: 300 },
    });
    expect(serverFieldError('helpText', 'required')).toBeNull();
    expect(serverFieldError('title', 'invalid')).toBeNull();
  });
});

const row = (key: string, label: string, id?: string): OptionDraft =>
  id === undefined ? { key, label } : { key, label, id };

describe('validateOptions (D-592, UI-D-571)', () => {
  it('is clean for two or more distinct, filled rows', () => {
    expect(validateOptions([row('a', 'Instagram'), row('b', 'Indicação')])).toBeUndefined();
  });

  it('flags fewer than two rows', () => {
    expect(validateOptions([row('a', 'Só uma')])?.issues).toEqual(['min']);
    expect(validateOptions([])?.issues).toEqual(['min']);
  });

  it('flags an empty or whitespace row and marks it', () => {
    const errors = validateOptions([row('a', 'Instagram'), row('b', '   ')]);
    expect(errors?.issues).toEqual(['empty']);
    expect(errors?.rows).toEqual({ b: 'empty' });
  });

  it('flags a repeat after trimming, accents kept and pt-BR lower case, and marks both rows', () => {
    const errors = validateOptions([row('a', 'Indicação'), row('b', '  INDICAÇÃO ')]);
    expect(errors?.issues).toEqual(['duplicate']);
    expect(errors?.rows).toEqual({ a: 'duplicate', b: 'duplicate' });
    // a different accent is a different label
    expect(validateOptions([row('a', 'Indicacao'), row('b', 'Indicação')])).toBeUndefined();
  });

  it('flags more than 20 rows, "Outro" not counted', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => row(`k${i}`, `Opção ${i}`));
    expect(validateOptions(twenty)).toBeUndefined();
    expect(validateOptions([...twenty, row('x', 'Mais uma')])?.issues).toEqual(['max']);
  });

  it('lists every sentence that applies, in the order shown', () => {
    expect(validateOptions([row('a', ''), row('b', 'x'), row('c', 'x')])?.issues).toEqual([
      'empty',
      'duplicate',
    ]);
  });
});

describe('validateDraft: options and limits', () => {
  const choice = (options: OptionDraft[]) => ({
    ...blankDraft(),
    type: 'single_choice' as const,
    title: 'Origem',
    options,
  });

  it('reports the options errors of a choice draft only', () => {
    expect(validateDraft(choice([row('a', ''), row('b', '')])).options?.issues).toEqual(['empty']);
    expect(
      validateDraft({ ...choice([row('a', '')]), type: 'short_text' }).options,
    ).toBeUndefined();
  });

  it('reports a number text that is not a number and a minimum above the maximum', () => {
    const base = { ...blankDraft(), type: 'number' as const, title: 'Idade' };
    expect(validateDraft({ ...base, min: 'abc' }).min).toEqual({ key: 'errors.numberInvalid' });
    expect(validateDraft({ ...base, max: '1,2,3' }).max).toEqual({ key: 'errors.numberInvalid' });
    expect(validateDraft({ ...base, min: '10', max: '2' }).limits).toEqual({
      key: 'limits.errNumber',
    });
    expect(hasErrors(validateDraft({ ...base, min: '2', max: '2' }))).toBe(false);
    expect(hasErrors(validateDraft({ ...base, min: '0,5', max: '1.000' }))).toBe(false);
  });

  it('reports a date minimum after the maximum', () => {
    const base = { ...blankDraft(), type: 'date' as const, title: 'Início' };
    expect(validateDraft({ ...base, min: '2026-12-31', max: '2026-01-01' }).limits).toEqual({
      key: 'limits.errDate',
    });
    expect(hasErrors(validateDraft({ ...base, min: '2026-01-01', max: '2026-01-01' }))).toBe(false);
    expect(hasErrors(validateDraft({ ...base, min: '2026-01-01' }))).toBe(false);
  });
});

describe('the option rows as pure moves', () => {
  const rows = [row('a', 'A', 'id-a'), row('b', 'B'), row('c', 'C')];

  it('adds an empty row without an id at the end', () => {
    const next = addOptionRow(rows);
    expect(next.options).toHaveLength(4);
    expect(next.options[3]).toEqual({ key: next.key, label: '' });
    expect(rows).toHaveLength(3);
  });

  it('removes a row but never below two', () => {
    expect(removeOptionRow(rows, 'b').map((o) => o.key)).toEqual(['a', 'c']);
    const two = [row('a', 'A'), row('b', 'B')];
    expect(removeOptionRow(two, 'a')).toEqual(two);
  });

  it('moves a row one place and leaves the edges alone', () => {
    expect(moveOptionRow(rows, 'b', -1).map((o) => o.key)).toEqual(['b', 'a', 'c']);
    expect(moveOptionRow(rows, 'b', 1).map((o) => o.key)).toEqual(['a', 'c', 'b']);
    expect(moveOptionRow(rows, 'a', -1).map((o) => o.key)).toEqual(['a', 'b', 'c']);
    expect(moveOptionRow(rows, 'c', 1).map((o) => o.key)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the server id when a stored option is moved or renamed', () => {
    const moved = moveOptionRow(rows, 'a', 1);
    expect(moved.find((o) => o.key === 'a')?.id).toBe('id-a');
    const renamed = renameOptionRow(rows, 'a', 'Novo nome');
    expect(renamed[0]).toEqual({ key: 'a', id: 'id-a', label: 'Novo nome' });
  });
});

describe('reopeningOf (D-585, UI-D-576)', () => {
  const optional = { id: 'q1', required: false };
  const required = { id: 'q2', required: true };

  it('a new required question reopens the form; an optional one does not', () => {
    expect(reopeningOf('create', { required: true }, null)).toEqual({
      change: 'create_required',
      kind: 'add',
    });
    expect(reopeningOf('create', { required: false }, null)).toBeNull();
  });

  it('an optional question turned required reopens it, naming the question', () => {
    expect(reopeningOf('edit', { required: true }, optional)).toEqual({
      change: 'make_required',
      kind: 'make',
      questionId: 'q1',
    });
  });

  it('a question that was already required, or that stays optional, reopens nothing', () => {
    expect(reopeningOf('edit', { required: true }, required)).toBeNull();
    expect(reopeningOf('edit', { required: false }, optional)).toBeNull();
    expect(reopeningOf('edit', { required: false }, required)).toBeNull();
  });

  it('a required replacement reopens it, naming the question it replaces', () => {
    expect(reopeningOf('replace', { required: true }, required)).toEqual({
      change: 'replace',
      kind: 'replace',
      questionId: 'q2',
    });
    expect(reopeningOf('replace', { required: false }, required)).toBeNull();
  });
});

describe('server refusals placed on the options and the limits', () => {
  it('maps the codes with a single place and nothing else', () => {
    expect(serverOptionsErrors('required')).toEqual({ issues: ['empty'], rows: {} });
    expect(serverOptionsErrors('limit_reached')).toEqual({ issues: ['max'], rows: {} });
    expect(serverOptionsErrors('invalid')).toBeNull();
    expect(serverLimitsError('number', 'out_of_range')).toEqual({ key: 'limits.errNumber' });
    expect(serverLimitsError('date', 'out_of_range')).toEqual({ key: 'limits.errDate' });
    expect(serverLimitsError('number', 'invalid')).toBeNull();
  });
});
